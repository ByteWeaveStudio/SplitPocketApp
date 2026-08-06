-- Milestone 4: privilege hardening.
--
-- RLS answers "which rows?" but never "which columns?", and Supabase's default
-- grants hand anon and authenticated full DML on every table in public. Those
-- two facts together let a signed-in client rewrite columns the policies were
-- never meant to expose: profiles.email (which the invite lookup trusts to
-- resolve an address to an account), group_members.user_id, groups.created_by,
-- and expenses.group_id.
--
-- This migration adds the layer that can express "only this column may change"
-- -- column privileges -- and moves the remaining multi-row money writes onto
-- the backend, which is where 20260804090100_rls_policies.sql already says
-- splits, settlements, and invites belong.
--
-- Policies that lose their last privilege are dropped rather than left in
-- place: a policy that can never fire reads like a working control.

-- ---------------------------------------------------------------------------
-- profiles: identity columns are server-owned
-- ---------------------------------------------------------------------------

-- email mirrors auth.users and is the key the invite flow resolves against.
-- The rest of the row is the user's to edit.
revoke update on public.profiles from anon, authenticated;
grant update (full_name, avatar_url, default_currency) on public.profiles to authenticated;

-- Duplicate addresses would make the invite lookup ambiguous (it takes the
-- first row Postgres happens to return). Report the offenders rather than
-- failing with a bare unique-violation.
do $$
declare
  duplicates text;
begin
  select string_agg(email, ', ')
    into duplicates
    from (
      select lower(email) as email
      from public.profiles
      group by lower(email)
      having count(*) > 1
    ) d;

  if duplicates is not null then
    raise exception 'Duplicate profile emails must be resolved first: %', duplicates;
  end if;
end;
$$;

create unique index if not exists profiles_email_lower_key
  on public.profiles (lower(email));

-- ---------------------------------------------------------------------------
-- groups: created_by and currency are load-bearing
-- ---------------------------------------------------------------------------

-- "groups: owners update" was unscoped, so an owner could rewrite created_by
-- -- which the member-bootstrap policy trusted -- or currency, retroactively
-- re-denominating every amount_minor already stored against the group.
-- No client code updates this table; group edits belong on the API.
revoke update on public.groups from anon, authenticated;
drop policy if exists "groups: owners update" on public.groups;

-- ---------------------------------------------------------------------------
-- group_members: membership is decided by the backend
-- ---------------------------------------------------------------------------

-- "owners update roles" could not restrict itself to the role column, so an
-- owner could repoint user_id (part of the primary key) at any uuid, pulling a
-- stranger into the group and exposing their profile through shares_group_with.
-- Demote-then-remove was likewise reachable, which the API forbids.
--
-- Inserts and deletes go through the API too: it holds the rules this table
-- cannot express, like "the last owner can't walk out of a group".
revoke insert, update, delete on public.group_members from anon, authenticated;
drop policy if exists "group_members: creator joins own group as owner" on public.group_members;
drop policy if exists "group_members: owners update roles" on public.group_members;
drop policy if exists "group_members: leave or owner removes" on public.group_members;

-- ---------------------------------------------------------------------------
-- expenses: a row cannot change owner or move between groups
-- ---------------------------------------------------------------------------

-- The UPDATE policy checked membership of the *new* group, so a member of two
-- groups could re-home an expense from one to the other, carrying splits that
-- name non-members of the destination. currency stays writable because personal
-- expenses set it freely; group expenses are pinned by trigger below.
revoke update on public.expenses from anon, authenticated;
grant update (category_id, description, amount_minor, currency, date, kind, notes)
  on public.expenses to authenticated;

-- ---------------------------------------------------------------------------
-- expense_splits: who owes what is never client-writable
-- ---------------------------------------------------------------------------

-- The insert policy required only that you created the parent expense, and
-- nothing tied sum(owed_minor) to expenses.amount_minor -- so a member could
-- post a 1-unit expense and attach an arbitrary debt to anyone. Splits are
-- computed by the backend (app/services/splits.py), which is the only writer.
revoke insert, update, delete on public.expense_splits from anon, authenticated;
drop policy if exists "expense_splits: expense creator inserts" on public.expense_splits;
drop policy if exists "expense_splits: expense creator updates" on public.expense_splits;
drop policy if exists "expense_splits: expense creator deletes" on public.expense_splits;

-- ---------------------------------------------------------------------------
-- settlements: recorded by the API, still deletable by either party
-- ---------------------------------------------------------------------------

-- Direct inserts bypassed the group-currency pin the API applies. The client
-- already records settlements through POST /groups/{id}/settlements; only the
-- select and delete policies are exercised from the browser.
revoke insert on public.settlements from anon, authenticated;
drop policy if exists "settlements: involved member records" on public.settlements;

-- ---------------------------------------------------------------------------
-- is_group_member: answer about others only to people already inside
-- ---------------------------------------------------------------------------

-- PostgREST publishes every function in public as an RPC endpoint, and the
-- policies need EXECUTE on this one, so it cannot simply be revoked. The
-- two-argument form let any signed-in user ask "is user U in group G?" about
-- groups they have nothing to do with, mapping the membership graph from the
-- outside. Same signature (policies keep working), narrower answer.
create or replace function public.is_group_member(
  target_group_id uuid,
  target_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.group_members gm
    where gm.group_id = target_group_id
      and gm.user_id = target_user_id
  )
  and (
    target_user_id = (select auth.uid())
    or exists (
      select 1
      from public.group_members me
      where me.group_id = target_group_id
        and me.user_id = (select auth.uid())
    )
  );
$$;

-- Functions are granted to PUBLIC by default, so revoking from anon alone
-- changes nothing -- the grant has to come off PUBLIC and go back to the roles
-- whose policies actually evaluate these.
revoke execute on function public.is_group_member(uuid, uuid) from public;
revoke execute on function public.is_group_owner(uuid) from public;
revoke execute on function public.shares_group_with(uuid) from public;

grant execute on function public.is_group_member(uuid, uuid) to authenticated, service_role;
grant execute on function public.is_group_owner(uuid) to authenticated, service_role;
grant execute on function public.shares_group_with(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Ledger integrity
-- ---------------------------------------------------------------------------

-- Pin a group expense to its group's currency. compute_net sums amount_minor
-- currency-blind, so a JPY row in a USD group silently credits its payer.
create or replace function public.enforce_group_expense_currency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  group_currency text;
begin
  if new.group_id is null then
    return new;
  end if;

  select g.currency into group_currency
    from public.groups g
   where g.id = new.group_id;

  if new.currency is distinct from group_currency then
    raise exception 'Group expenses must use the group currency (%), not %.',
      group_currency, new.currency
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger expenses_group_currency
  before insert or update on public.expenses
  for each row execute function public.enforce_group_expense_currency();

-- A group expense's splits must account for exactly its amount. Deferred so
-- the backend can delete and re-insert a whole split set inside one
-- transaction (app/api/routes/groups.py::update_group_expense); the check runs
-- once at commit, against the final state.
create or replace function public.enforce_split_total()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_expense uuid;
  expense_amount bigint;
  expense_group uuid;
  split_total bigint;
begin
  -- Branch on the table before touching a field: plpgsql resolves a row
  -- reference against the real row type, so naming old.expense_id in an
  -- expression that also runs on public.expenses fails there even when that
  -- arm is not the one taken.
  if tg_table_name = 'expenses' then
    target_expense := new.id;
  elsif tg_op = 'DELETE' then
    target_expense := old.expense_id;
  else
    target_expense := new.expense_id;
  end if;

  select e.amount_minor, e.group_id
    into expense_amount, expense_group
    from public.expenses e
   where e.id = target_expense;

  -- Parent already gone (expense deleted, splits cascaded), or personal:
  -- personal expenses carry no splits.
  if not found or expense_group is null then
    return null;
  end if;

  select coalesce(sum(s.owed_minor), 0)
    into split_total
    from public.expense_splits s
   where s.expense_id = target_expense;

  if split_total <> expense_amount then
    raise exception 'Splits for expense % total % but the expense is %.',
      target_expense, split_total, expense_amount
      using errcode = 'check_violation';
  end if;

  return null;
end;
$$;

create constraint trigger expense_splits_total
  after insert or update or delete on public.expense_splits
  deferrable initially deferred
  for each row execute function public.enforce_split_total();

create constraint trigger expenses_split_total
  after insert or update on public.expenses
  deferrable initially deferred
  for each row execute function public.enforce_split_total();

-- Triggers only police new writes. Anything already inconsistent stays that
-- way until someone edits it, at which point the write fails -- so surface it
-- now instead of at the user's next save.
do $$
declare
  broken text;
begin
  select string_agg(id::text, ', ')
    into broken
    from (
      select e.id
      from public.expenses e
      left join public.expense_splits s on s.expense_id = e.id
      where e.group_id is not null
      group by e.id, e.amount_minor
      having coalesce(sum(s.owed_minor), 0) <> e.amount_minor
    ) d;

  if broken is not null then
    raise warning 'Group expenses whose splits do not reconcile: %', broken;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- set_updated_at: pin search_path like the other trigger functions
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;
