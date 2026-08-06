-- Milestone 3: core schema.
-- Tables mirror frontend/src/types/domain.ts. Conventions:
--   - Monetary amounts are bigint in the currency's minor unit (cents, paise).
--   - Timestamps are timestamptz; expense/budget dates are plain dates.
--   - All user-owned rows cascade from profiles so deleting an auth user
--     removes their data (account-deletion UX refinements come post-MVP).

-- ---------------------------------------------------------------------------
-- currencies (reference data; seeded here because later defaults depend on it)
-- ---------------------------------------------------------------------------

create table public.currencies (
  code text primary key check (code ~ '^[A-Z]{3}$'),
  name text not null,
  symbol text not null,
  decimal_digits smallint not null default 2 check (decimal_digits between 0 and 4)
);

comment on table public.currencies is 'ISO 4217 currencies available in pickers; mirrors frontend/src/lib/currencies.ts';

insert into public.currencies (code, symbol, name, decimal_digits) values
  ('USD', '$', 'US Dollar', 2),
  ('EUR', '€', 'Euro', 2),
  ('GBP', '£', 'British Pound', 2),
  ('INR', '₹', 'Indian Rupee', 2),
  ('JPY', '¥', 'Japanese Yen', 0),
  ('CNY', '¥', 'Chinese Yuan', 2),
  ('AUD', 'A$', 'Australian Dollar', 2),
  ('CAD', 'C$', 'Canadian Dollar', 2),
  ('SGD', 'S$', 'Singapore Dollar', 2),
  ('AED', 'د.إ', 'UAE Dirham', 2)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- profiles (1:1 with auth.users, created by trigger on signup)
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  avatar_url text,
  default_currency text not null default 'USD' references public.currencies (code),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is 'App-facing user data; auth.users is never exposed to clients.';

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Security definer: fires as supabase_auth_admin, which has no rights on
-- public tables, so the function must run with its owner's privileges.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.handle_user_email_updated()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = coalesce(new.email, '') where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_email_updated
  after update of email on auth.users
  for each row execute function public.handle_user_email_updated();

-- Accounts created during Milestone 2, before the trigger existed.
insert into public.profiles (id, email, full_name, avatar_url, created_at)
select
  id,
  coalesce(email, ''),
  coalesce(raw_user_meta_data ->> 'full_name', raw_user_meta_data ->> 'name'),
  raw_user_meta_data ->> 'avatar_url',
  created_at
from auth.users
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- categories (user_id null = built-in defaults shared by everyone)
-- ---------------------------------------------------------------------------

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 50),
  icon text not null default 'tag',
  created_at timestamptz not null default now()
);

comment on column public.categories.icon is 'Lucide icon name rendered in category pickers.';

create unique index categories_default_name_key
  on public.categories (lower(name)) where user_id is null;
create unique index categories_user_name_key
  on public.categories (user_id, lower(name)) where user_id is not null;

-- ---------------------------------------------------------------------------
-- groups & group_members
-- ---------------------------------------------------------------------------

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 80),
  description text,
  currency text not null references public.currencies (code),
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

create index groups_created_by_idx on public.groups (created_by);

create table public.group_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create index group_members_user_idx on public.group_members (user_id);

-- ---------------------------------------------------------------------------
-- expenses & expense_splits
-- ---------------------------------------------------------------------------

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  -- Creator, and the payer for group expenses.
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- Null = personal expense; set = belongs to a group.
  group_id uuid references public.groups (id) on delete cascade,
  category_id uuid references public.categories (id) on delete set null,
  description text not null check (length(trim(description)) between 1 and 200),
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null references public.currencies (code),
  date date not null,
  kind text not null default 'expense' check (kind in ('expense', 'income')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Income is personal-only; groups track shared spending.
  constraint income_is_personal check (kind = 'expense' or group_id is null)
);

create index expenses_user_date_idx on public.expenses (user_id, date desc);
create index expenses_group_idx on public.expenses (group_id) where group_id is not null;
create index expenses_category_idx on public.expenses (category_id);

create trigger expenses_set_updated_at
  before update on public.expenses
  for each row execute function public.set_updated_at();

create table public.expense_splits (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- What this member owes toward the expense, in minor units.
  owed_minor bigint not null check (owed_minor >= 0),
  -- Basis points (1/100 of a percent) when method is 'percentage'.
  share_basis_points integer check (share_basis_points between 0 and 10000),
  method text not null check (method in ('equal', 'custom', 'percentage')),
  unique (expense_id, user_id)
);

create index expense_splits_user_idx on public.expense_splits (user_id);

-- ---------------------------------------------------------------------------
-- settlements
-- ---------------------------------------------------------------------------

create table public.settlements (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  from_user_id uuid not null references public.profiles (id) on delete cascade,
  to_user_id uuid not null references public.profiles (id) on delete cascade,
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null references public.currencies (code),
  note text,
  settled_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint settlement_parties_differ check (from_user_id <> to_user_id)
);

create index settlements_group_idx on public.settlements (group_id);
create index settlements_from_user_idx on public.settlements (from_user_id);
create index settlements_to_user_idx on public.settlements (to_user_id);

-- ---------------------------------------------------------------------------
-- budgets (category_id null = overall budget)
-- ---------------------------------------------------------------------------

create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  category_id uuid references public.categories (id) on delete cascade,
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null references public.currencies (code),
  period text not null default 'monthly' check (period in ('monthly')),
  starts_on date not null,
  created_at timestamptz not null default now()
);

-- One budget per user/category/period; nulls collapse to a sentinel so
-- "overall" is also unique.
create unique index budgets_user_category_period_key
  on public.budgets (user_id, coalesce(category_id, '00000000-0000-0000-0000-000000000000'::uuid), period);

-- ---------------------------------------------------------------------------
-- realtime: publish tables the app will subscribe to (M5/M7)
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.groups,
      public.group_members,
      public.expenses,
      public.expense_splits,
      public.settlements;
  end if;
end;
$$;
