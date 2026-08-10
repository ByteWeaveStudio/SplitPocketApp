-- Follow-up to 20260806120000_privilege_hardening.sql.
--
-- That migration narrowed the membership helpers with
--
--     revoke execute on function ... from public;
--     grant  execute on function ... to authenticated, service_role;
--
-- but `from public` only drops the implicit PUBLIC grant. Supabase also hands
-- out an *explicit* execute grant to anon (and authenticated, and
-- service_role) on functions in public, and an explicit grant is not touched
-- by revoking from PUBLIC. So anon kept EXECUTE and the intended narrowing
-- never took effect:
--
--     is_group_member  postgres=X/postgres anon=X/postgres authenticated=X/postgres ...
--                                          ^^^^^^^^^^^^^^
--
-- The two-argument rewrite in that migration means an anonymous caller gets
-- NULL rather than a useful answer (auth.uid() is null, so the "am I inside
-- this group too?" arm can never be true), so nothing leaks today. The grant
-- is still worth removing: it is the difference between "safe because the
-- role cannot call this" and "safe because the body happens to return NULL",
-- and only the first survives someone editing the body later.

revoke execute on function public.is_group_member(uuid, uuid) from anon;
revoke execute on function public.is_group_owner(uuid) from anon;
revoke execute on function public.shares_group_with(uuid) from anon;

-- The trigger functions are never called directly -- they run as part of a
-- write, under the table owner's rights, not the caller's. Publishing them as
-- callable RPC endpoints just widens the surface for no benefit.
revoke execute on function public.enforce_split_total() from public, anon, authenticated;
revoke execute on function public.enforce_group_expense_currency() from public, anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;
