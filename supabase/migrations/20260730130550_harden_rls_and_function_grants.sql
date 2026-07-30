-- Security/performance hardening pass on the initial schema:
--
-- 1. handle_new_user() is SECURITY DEFINER and only ever needs to run as the
--    auth.users insert trigger — it was never meant to be callable directly
--    via RPC. Revoke EXECUTE from every client-facing role.
-- 2. get_leaderboard() is intentionally SECURITY DEFINER (it aggregates
--    across all users, which RLS alone can't express), but only
--    "authenticated" should be able to call it — drop the implicit
--    public/anon grant Postgres adds by default.
-- 3. Every RLS policy compared column = auth.uid() directly, which Postgres
--    re-evaluates auth.uid() once per row scanned. Wrapping it as
--    (select auth.uid()) lets the planner treat it as a stable
--    once-per-query subquery instead — same result, much cheaper on larger
--    tables.

revoke execute on function public.handle_new_user() from public, anon, authenticated;

revoke execute on function public.get_leaderboard(integer) from public, anon;
grant execute on function public.get_leaderboard(integer) to authenticated;

drop policy "profiles are viewable by owner" on public.profiles;
drop policy "profiles are updatable by owner" on public.profiles;
create policy "profiles are viewable by owner" on public.profiles
  for select using ((select auth.uid()) = id);
create policy "profiles are updatable by owner" on public.profiles
  for update using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

drop policy "documents are managed by owner" on public.documents;
create policy "documents are managed by owner" on public.documents
  for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy "reading sessions are managed by owner" on public.reading_sessions;
create policy "reading sessions are managed by owner" on public.reading_sessions
  for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy "growth events are viewable by owner" on public.growth_events;
drop policy "growth events are insertable by owner" on public.growth_events;
create policy "growth events are viewable by owner" on public.growth_events
  for select using ((select auth.uid()) = user_id);
create policy "growth events are insertable by owner" on public.growth_events
  for insert with check ((select auth.uid()) = user_id);
