-- Milestone 3: Row Level Security.
--
-- Clients hit these tables directly only for reads and simple owned-row
-- writes; multi-row business logic (splits, settlements, invites) goes
-- through the FastAPI backend, whose service-role key bypasses RLS after
-- verifying the caller's JWT. Policies below are the floor that makes the
-- database safe even if the publishable key is abused.
--
-- Membership checks live in SECURITY DEFINER helpers: group_members policies
-- that queried group_members directly would recurse infinitely.

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
  );
$$;

create or replace function public.is_group_owner(target_group_id uuid)
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
      and gm.user_id = auth.uid()
      and gm.role = 'owner'
  );
$$;

create or replace function public.shares_group_with(other_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.group_members mine
    join public.group_members theirs on theirs.group_id = mine.group_id
    where mine.user_id = auth.uid()
      and theirs.user_id = other_user_id
  );
$$;

-- ---------------------------------------------------------------------------
-- currencies: read-only reference data
-- ---------------------------------------------------------------------------

alter table public.currencies enable row level security;

create policy "currencies are readable by signed-in users"
  on public.currencies for select
  to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- profiles: yours, plus people you share a group with
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;

create policy "profiles: own or shared-group members"
  on public.profiles for select
  to authenticated
  using (id = (select auth.uid()) or public.shares_group_with(id));

create policy "profiles: update own"
  on public.profiles for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- No insert/delete policies: the auth trigger creates rows and the
-- auth.users cascade removes them.

-- ---------------------------------------------------------------------------
-- categories: built-in defaults (user_id null) plus your own
-- ---------------------------------------------------------------------------

alter table public.categories enable row level security;

create policy "categories: defaults and own"
  on public.categories for select
  to authenticated
  using (user_id is null or user_id = (select auth.uid()));

create policy "categories: insert own"
  on public.categories for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy "categories: update own"
  on public.categories for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "categories: delete own"
  on public.categories for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- groups
-- ---------------------------------------------------------------------------

alter table public.groups enable row level security;

-- created_by covers the moment between creating a group and inserting the
-- creator's own membership row.
create policy "groups: members and creator"
  on public.groups for select
  to authenticated
  using (public.is_group_member(id) or created_by = (select auth.uid()));

create policy "groups: create as self"
  on public.groups for insert
  to authenticated
  with check (created_by = (select auth.uid()));

create policy "groups: owners update"
  on public.groups for update
  to authenticated
  using (public.is_group_owner(id))
  with check (public.is_group_owner(id));

create policy "groups: owners delete"
  on public.groups for delete
  to authenticated
  using (public.is_group_owner(id));

-- ---------------------------------------------------------------------------
-- group_members
-- ---------------------------------------------------------------------------

alter table public.group_members enable row level security;

create policy "group_members: visible to members"
  on public.group_members for select
  to authenticated
  using (public.is_group_member(group_id));

-- Only the bootstrap case: a group's creator adds themself as owner.
-- Inviting other members is backend business logic (service role).
create policy "group_members: creator joins own group as owner"
  on public.group_members for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and role = 'owner'
    and exists (
      select 1 from public.groups g
      where g.id = group_id and g.created_by = (select auth.uid())
    )
  );

create policy "group_members: owners update roles"
  on public.group_members for update
  to authenticated
  using (public.is_group_owner(group_id))
  with check (public.is_group_owner(group_id));

create policy "group_members: leave or owner removes"
  on public.group_members for delete
  to authenticated
  using (user_id = (select auth.uid()) or public.is_group_owner(group_id));

-- ---------------------------------------------------------------------------
-- expenses
-- ---------------------------------------------------------------------------

alter table public.expenses enable row level security;

create policy "expenses: own or group"
  on public.expenses for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or (group_id is not null and public.is_group_member(group_id))
  );

create policy "expenses: create own, in own groups"
  on public.expenses for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and (group_id is null or public.is_group_member(group_id))
  );

create policy "expenses: creator updates"
  on public.expenses for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (group_id is null or public.is_group_member(group_id))
  );

create policy "expenses: creator deletes"
  on public.expenses for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- expense_splits: visibility rides on the parent expense's RLS
-- ---------------------------------------------------------------------------

alter table public.expense_splits enable row level security;

create policy "expense_splits: visible with parent expense"
  on public.expense_splits for select
  to authenticated
  using (
    exists (select 1 from public.expenses e where e.id = expense_id)
  );

create policy "expense_splits: expense creator inserts"
  on public.expense_splits for insert
  to authenticated
  with check (
    exists (
      select 1 from public.expenses e
      where e.id = expense_id and e.user_id = (select auth.uid())
    )
  );

create policy "expense_splits: expense creator updates"
  on public.expense_splits for update
  to authenticated
  using (
    exists (
      select 1 from public.expenses e
      where e.id = expense_id and e.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.expenses e
      where e.id = expense_id and e.user_id = (select auth.uid())
    )
  );

create policy "expense_splits: expense creator deletes"
  on public.expense_splits for delete
  to authenticated
  using (
    exists (
      select 1 from public.expenses e
      where e.id = expense_id and e.user_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- settlements
-- ---------------------------------------------------------------------------

alter table public.settlements enable row level security;

create policy "settlements: visible to group members"
  on public.settlements for select
  to authenticated
  using (public.is_group_member(group_id));

create policy "settlements: involved member records"
  on public.settlements for insert
  to authenticated
  with check (
    (select auth.uid()) in (from_user_id, to_user_id)
    and public.is_group_member(group_id, from_user_id)
    and public.is_group_member(group_id, to_user_id)
  );

create policy "settlements: involved party deletes"
  on public.settlements for delete
  to authenticated
  using ((select auth.uid()) in (from_user_id, to_user_id));

-- No update policy: correct a settlement by deleting and re-recording it.

-- ---------------------------------------------------------------------------
-- budgets: strictly personal
-- ---------------------------------------------------------------------------

alter table public.budgets enable row level security;

create policy "budgets: select own"
  on public.budgets for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "budgets: insert own"
  on public.budgets for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy "budgets: update own"
  on public.budgets for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "budgets: delete own"
  on public.budgets for delete
  to authenticated
  using (user_id = (select auth.uid()));
