-- v2: deeper splits.
--
-- v1 could answer "we split this equally / by these amounts / by these
-- percentages, and I paid". Three things people actually do at a table were
-- unreachable:
--
--   1. Someone else paid. expenses.user_id is both the creator and, per
--      app/services/balances.py, the payer -- so recording a dinner your
--      flatmate paid for meant asking them to open the app.
--   2. Shares, not amounts. "Two of us, one of them, split three ways" is a
--      weight, and expressing it as percentages forces the user to do the
--      arithmetic the app exists to do (33.33 / 33.33 / 33.34 does not even
--      add to 100).
--   3. Itemization. A restaurant bill is not one amount split one way; it is
--      a list of things, each shared by a different subset.
--
-- expense_splits stays the single source of truth for balances: everything
-- below either feeds it (items) or annotates it (share_units). compute_net
-- and simplify_debts are untouched.

-- ---------------------------------------------------------------------------
-- expenses.paid_by: who put the money down, as distinct from who typed it in
-- ---------------------------------------------------------------------------

alter table public.expenses
  add column if not exists paid_by uuid references public.profiles (id);

comment on column public.expenses.paid_by is
  'Who actually paid. Distinct from user_id (who recorded it); balances are computed against this column.';

-- Narrow expenses_split_total (20260806120000) to the column it actually
-- guards. It compares sum(expense_splits.owed_minor) against
-- expenses.amount_minor, so a change to any other column cannot break it --
-- yet as written every UPDATE queued a deferred check.
--
-- That has one immediate consequence and one lasting one. Immediately: the
-- backfill below is an UPDATE, and its pending trigger events make the
-- following ALTER TABLE fail with "cannot ALTER TABLE because it has pending
-- trigger events". Lastingly: every edit to a description or a date was paying
-- for a re-count of that expense's splits at commit.
--
-- INSERT still fires unconditionally -- a new group expense with no splits at
-- all is exactly what the check exists to catch.
drop trigger if exists expenses_split_total on public.expenses;
create constraint trigger expenses_split_total
  after insert or update of amount_minor on public.expenses
  deferrable initially deferred
  for each row execute function public.enforce_split_total();

-- Every v1 row was paid by its creator, which is exactly what the old code
-- assumed, so the backfill is the identity.
--
-- updated_at is suppressed across it: this is a schema change, not somebody
-- editing their expenses, and letting the touch trigger fire would stamp the
-- migration's timestamp onto every row in the table. Re-enabled immediately
-- after; a failure anywhere in this migration rolls the whole thing back,
-- trigger state included.
alter table public.expenses disable trigger expenses_set_updated_at;
update public.expenses set paid_by = user_id where paid_by is null;
alter table public.expenses enable trigger expenses_set_updated_at;

-- BEFORE triggers run before NOT NULL is checked, so enforce_expense_payer
-- below can fill the column for client inserts that never mention it.
alter table public.expenses alter column paid_by set not null;

create index if not exists expenses_paid_by_idx on public.expenses (paid_by);

-- Two rules the column type cannot state:
--   - a group expense can only be paid by a member of that group, or the
--     payer's net moves in a group they are not in and no one can settle it;
--   - a personal expense is paid by its owner, full stop -- there is no one
--     else in a personal ledger, and allowing otherwise would let a client
--     credit a stranger through a row RLS considers strictly its own.
create or replace function public.enforce_expense_payer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.paid_by is null then
    new.paid_by := new.user_id;
  end if;

  if new.group_id is null then
    if new.paid_by <> new.user_id then
      raise exception 'A personal expense is paid by its owner.'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if not exists (
    select 1 from public.group_members m
     where m.group_id = new.group_id and m.user_id = new.paid_by
  ) then
    raise exception 'The payer must be a member of the group.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_expense_payer() from public, anon, authenticated;

drop trigger if exists expenses_enforce_payer on public.expenses;
create trigger expenses_enforce_payer
  before insert or update on public.expenses
  for each row execute function public.enforce_expense_payer();

-- 20260806120000 already took column-level control of UPDATE on this table for
-- exactly this reason; INSERT was left table-wide because every column was
-- either checked by a policy or harmless. paid_by is neither: the insert
-- policy only constrains user_id, so a table-wide grant would let a client
-- name any group member as the payer of an expense they invented. Splits are
-- computed by the backend; so is the payer.
revoke insert on public.expenses from anon, authenticated;
grant insert (
  id, user_id, group_id, category_id, description,
  amount_minor, currency, date, kind, notes
) on public.expenses to authenticated;

-- ---------------------------------------------------------------------------
-- expense_splits: two more methods, and the weight behind a shares split
-- ---------------------------------------------------------------------------

alter table public.expense_splits
  add column if not exists share_units integer
    check (share_units is null or share_units > 0);

comment on column public.expense_splits.share_units is
  'Weight for method = ''shares'' (2 units = twice the share). Null for every other method.';

-- Postgres names an inline column check <table>_<column>_check, but a database
-- restored from a dump written by an older pg_dump can differ; look the
-- constraint up by what it constrains rather than by what it is called.
do $$
declare
  constraint_name text;
begin
  select con.conname
    into constraint_name
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
   where con.contype = 'c'
     and nsp.nspname = 'public'
     and rel.relname = 'expense_splits'
     and pg_get_constraintdef(con.oid) like '%percentage%'
   limit 1;

  if constraint_name is not null then
    execute format(
      'alter table public.expense_splits drop constraint %I', constraint_name
    );
  end if;
end;
$$;

alter table public.expense_splits
  add constraint expense_splits_method_check
  check (method in ('equal', 'custom', 'percentage', 'shares', 'itemized'));

-- ---------------------------------------------------------------------------
-- expense_items: the line items behind an itemized split
-- ---------------------------------------------------------------------------

-- Items are a derivation record, not a second ledger. The backend turns
-- (item amount, item participants) into ordinary expense_splits rows, and the
-- deferred expense_splits_total trigger from 20260806120000 still guarantees
-- those reconcile against the expense. Reading balances never touches these
-- tables; only the edit screen does.

create table if not exists public.expense_items (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses (id) on delete cascade,
  description text not null check (length(trim(description)) between 1 and 120),
  amount_minor bigint not null check (amount_minor > 0),
  -- Display order, so re-saving an expense doesn't shuffle the bill.
  position smallint not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists expense_items_expense_idx on public.expense_items (expense_id);

create table if not exists public.expense_item_shares (
  item_id uuid not null references public.expense_items (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  primary key (item_id, user_id)
);

create index if not exists expense_item_shares_user_idx on public.expense_item_shares (user_id);

alter table public.expense_items enable row level security;
alter table public.expense_item_shares enable row level security;

-- Same shape as "expense_splits: visible with parent expense": the subquery is
-- itself subject to the expenses policy, so visibility rides on the parent.
create policy "expense_items: visible with parent expense"
  on public.expense_items for select
  to authenticated
  using (exists (select 1 from public.expenses e where e.id = expense_id));

create policy "expense_item_shares: visible with parent item"
  on public.expense_item_shares for select
  to authenticated
  using (exists (select 1 from public.expense_items i where i.id = item_id));

-- Who owes what is never client-writable (20260806120000). Items decide
-- exactly that, one plate at a time.
revoke all on public.expense_items from anon, authenticated;
revoke all on public.expense_item_shares from anon, authenticated;
grant select on public.expense_items to authenticated;
grant select on public.expense_item_shares to authenticated;

-- ---------------------------------------------------------------------------
-- split_presets: "the usual", saved per group
-- ---------------------------------------------------------------------------

-- Product principle 2 is "fewest taps to log an expense". A flat of four where
-- one person is away half the month re-enters the same participant set and the
-- same weights every time; a preset is that set, named.
create table if not exists public.split_presets (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 40),
  method text not null check (method in ('equal', 'custom', 'percentage', 'shares')),
  -- [{"userId": "...", "owedMinor": 1, "shareBasisPoints": 1, "shareUnits": 1}]
  -- Shape is enforced by the API's Pydantic models; the column stores the
  -- participant list verbatim so a preset survives changes to the split forms.
  participants jsonb not null,
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create unique index if not exists split_presets_group_name_key
  on public.split_presets (group_id, lower(name));

alter table public.split_presets enable row level security;

create policy "split_presets: visible to group members"
  on public.split_presets for select
  to authenticated
  using (public.is_group_member(group_id));

-- Written through the API so the participant list can be validated against
-- current membership before it is stored.
revoke all on public.split_presets from anon, authenticated;
grant select on public.split_presets to authenticated;

-- ---------------------------------------------------------------------------
-- realtime
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.expense_items,
      public.expense_item_shares;
  end if;
end;
$$;
