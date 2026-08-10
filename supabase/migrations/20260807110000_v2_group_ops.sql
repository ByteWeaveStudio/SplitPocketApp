-- v2: running a group, not just splitting in one.
--
-- v1 could create a group and add people by the email they signed up with.
-- Everything else a shared ledger needs over time was missing: a way in for
-- someone who has not signed up yet, a record of who changed what, somewhere
-- to say "this was the taxi, not the hotel", and a way to hand over ownership
-- before leaving.
--
-- All four are backend-written. The pattern from 20260806120000 holds: clients
-- read these tables under RLS and write nothing directly, because every write
-- here also has to produce an activity row, and a client that could skip that
-- step could edit a group's history silently.

-- ---------------------------------------------------------------------------
-- group_invites: a link, not an address
-- ---------------------------------------------------------------------------

-- add_member resolves an email against auth.users, which means the person has
-- to already have an account -- the exact moment a group forms is the moment
-- most of them do not. An invite link inverts it: the group is created first
-- and the link survives signup.
create table if not exists public.group_invites (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  -- Only the SHA-256 of the token is stored. The link is a bearer credential:
  -- whoever holds it joins the group, so a database dump must not be a set of
  -- working invitations. The backend hashes on the way in and compares
  -- hashes; the plaintext exists exactly once, in the response that created it.
  token_hash text not null unique,
  created_by uuid not null references public.profiles (id) on delete cascade,
  -- Not nullable: an invite link with no expiry is a permanent back door into
  -- a group, and nobody ever remembers to revoke one.
  expires_at timestamptz not null,
  -- Null = unlimited within the expiry window.
  max_uses integer check (max_uses is null or max_uses > 0),
  uses integer not null default 0 check (uses >= 0),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists group_invites_group_idx on public.group_invites (group_id);

alter table public.group_invites enable row level security;

-- Members see their group's invites so owners can review and revoke them. The
-- row carries a hash, not a token, so this is not a way to read a live link.
create policy "group_invites: visible to group members"
  on public.group_invites for select
  to authenticated
  using (public.is_group_member(group_id));

revoke all on public.group_invites from anon, authenticated;
grant select on public.group_invites to authenticated;

-- ---------------------------------------------------------------------------
-- group_activity: what happened, in order
-- ---------------------------------------------------------------------------

create table if not exists public.group_activity (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  -- Null once the actor's account is gone. The event still happened.
  actor_id uuid references public.profiles (id) on delete set null,
  kind text not null check (kind in (
    'group.created', 'group.renamed', 'group.archived', 'group.unarchived',
    'member.added', 'member.joined', 'member.removed', 'member.role_changed',
    'expense.added', 'expense.updated', 'expense.deleted',
    'settlement.recorded', 'settlement.deleted',
    'comment.added'
  )),
  -- Denormalized on purpose. Half of these events are about a row that no
  -- longer exists by the time anyone reads the feed -- "Priya deleted the
  -- hotel booking" cannot be rendered by joining to the deleted expense.
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists group_activity_group_created_idx
  on public.group_activity (group_id, created_at desc);

alter table public.group_activity enable row level security;

create policy "group_activity: visible to group members"
  on public.group_activity for select
  to authenticated
  using (public.is_group_member(group_id));

-- Append-only, and only from the backend: a feed a participant can edit is
-- not a record of anything.
revoke all on public.group_activity from anon, authenticated;
grant select on public.group_activity to authenticated;

-- ---------------------------------------------------------------------------
-- expense_comments: the argument about the bill, attached to the bill
-- ---------------------------------------------------------------------------

create table if not exists public.expense_comments (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (length(trim(body)) between 1 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists expense_comments_expense_idx
  on public.expense_comments (expense_id, created_at);

drop trigger if exists expense_comments_set_updated_at on public.expense_comments;
create trigger expense_comments_set_updated_at
  before update on public.expense_comments
  for each row execute function public.set_updated_at();

alter table public.expense_comments enable row level security;

create policy "expense_comments: visible with parent expense"
  on public.expense_comments for select
  to authenticated
  using (exists (select 1 from public.expenses e where e.id = expense_id));

-- Posting a comment also writes a group_activity row, so it goes through the
-- API like every other paired write.
revoke all on public.expense_comments from anon, authenticated;
grant select on public.expense_comments to authenticated;

-- ---------------------------------------------------------------------------
-- Deletes that have to leave a trace
-- ---------------------------------------------------------------------------

-- Group expenses and settlements were deletable straight from the browser.
-- Both change what other people owe, and neither could record that it
-- happened. Personal expenses are unaffected -- they are a single user's own
-- rows, they queue through the offline outbox, and there is no one to notify.
drop policy if exists "expenses: creator deletes" on public.expenses;
create policy "expenses: creator deletes personal"
  on public.expenses for delete
  to authenticated
  using (user_id = (select auth.uid()) and group_id is null);

revoke delete on public.settlements from anon, authenticated;
drop policy if exists "settlements: involved party deletes" on public.settlements;

-- ---------------------------------------------------------------------------
-- Backfill: groups that existed before the feed did
-- ---------------------------------------------------------------------------

-- An empty feed on an established group reads as "nothing has ever happened
-- here". Seed each group's creation so the timeline has a beginning.
insert into public.group_activity (group_id, actor_id, kind, detail, created_at)
select g.id, g.created_by, 'group.created',
       jsonb_build_object('groupName', g.name), g.created_at
from public.groups g
where not exists (
  select 1 from public.group_activity a
   where a.group_id = g.id and a.kind = 'group.created'
);

-- ---------------------------------------------------------------------------
-- realtime
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.group_activity,
      public.expense_comments;
  end if;
end;
$$;
