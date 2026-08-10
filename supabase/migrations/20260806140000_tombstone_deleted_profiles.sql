-- Make account deletion possible again, without corrupting the ledger.
--
-- 20260804090000_core_schema.sql hung profiles.id off auth.users with ON
-- DELETE CASCADE, and expenses/expense_splits off profiles the same way. So
-- deleting an auth user tore out the person's splits while leaving the group
-- expenses that referenced them. Before 20260806120000 that silently
-- unbalanced every affected group -- compute_net would sum splits that no
-- longer covered the expense. Since 20260806120000 the deferred
-- expense_splits_total trigger catches it at commit and the delete fails
-- outright:
--
--     ERROR: Splits for expense e... total 3000 but the expense is 6000.
--
-- The trigger is right; the cascade was always wrong. A shared expense is a
-- record of what several people agreed, and one of them closing their account
-- does not change what the others owed that night.
--
-- So: keep the row, drop the person. The profile survives as a tombstone --
-- no name, no email, no avatar -- and every split, expense, settlement and
-- membership that points at it stays valid. Balances stay correct, group
-- history stays readable, and auth.users is free to delete.

alter table public.profiles
  add column if not exists deleted_at timestamptz;

comment on column public.profiles.deleted_at is
  'Set when the underlying auth user was deleted. The row is retained so group ledgers stay balanced; it is no longer a sign-in-able account.';

-- The cascade is what forced the choice between "lose the account" and "lose
-- the ledger". Drop it by name-independent lookup: the constraint is
-- autonamed, and an environment restored from a dump may differ.
do $$
declare
  fk_name text;
begin
  select con.conname
    into fk_name
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    join pg_class fref on fref.oid = con.confrelid
    join pg_namespace fnsp on fnsp.oid = fref.relnamespace
   where con.contype = 'f'
     and nsp.nspname = 'public' and rel.relname = 'profiles'
     and fnsp.nspname = 'auth' and fref.relname = 'users'
   limit 1;

  if fk_name is not null then
    execute format('alter table public.profiles drop constraint %I', fk_name);
  end if;
end;
$$;

-- Runs as supabase_auth_admin (which holds no rights on public), so it has to
-- carry its owner's privileges -- same reasoning as handle_new_user.
create or replace function public.tombstone_deleted_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- profiles_email_lower_key (added in 20260806120000) is unique, so the
  -- placeholder has to be unique too. .invalid is reserved by RFC 2606 and can
  -- never be a deliverable address, so this can't collide with a real signup
  -- or be used to claim someone's identity through the invite lookup.
  update public.profiles
     set email       = 'deleted+' || old.id::text || '@deleted.invalid',
         full_name   = null,
         avatar_url  = null,
         deleted_at  = pg_catalog.now()
   where id = old.id
     and deleted_at is null;

  return old;
end;
$$;

revoke execute on function public.tombstone_deleted_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_deleted on auth.users;
create trigger on_auth_user_deleted
  after delete on auth.users
  for each row execute function public.tombstone_deleted_user();

-- Anyone already deleted under the old cascade is gone from profiles entirely,
-- which means their group expenses may already be short a split. Surface them
-- rather than letting the next edit of one of those expenses fail.
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
    raise warning 'Group expenses left unbalanced by an earlier account deletion: %', broken;
  end if;
end;
$$;
