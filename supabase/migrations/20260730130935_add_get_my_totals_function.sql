-- A signed-in user's own lifetime aggregates, derived from growth_events —
-- backs cloud-sync.js's fetchCloudTotals() cross-device reconciliation.
--
-- Deliberately SECURITY INVOKER (the default — no `security definer` here):
-- a user aggregating only their own rows is already exactly what RLS on
-- growth_events/reading_sessions allows, so there's no need for this
-- function to run with elevated privileges the way get_leaderboard() does.
create or replace function public.get_my_totals()
returns table (
  total_gp numeric,
  total_sessions bigint,
  total_pages_turned bigint,
  total_focus_minutes bigint,
  focus_sessions_completed bigint
)
language sql
stable
set search_path = public
as $$
  select
    coalesce((select sum(growth_value) from public.growth_events where user_id = (select auth.uid())), 0) as total_gp,
    (select count(*) from public.reading_sessions where user_id = (select auth.uid())) as total_sessions,
    coalesce((select sum(pages_read) from public.growth_events where user_id = (select auth.uid()) and growth_type = 'pages'), 0) as total_pages_turned,
    coalesce((select sum(time_spent_seconds) from public.growth_events where user_id = (select auth.uid()) and growth_type = 'focus'), 0) / 60 as total_focus_minutes,
    (select count(*) from public.growth_events where user_id = (select auth.uid()) and growth_type = 'focus') as focus_sessions_completed;
$$;

revoke execute on function public.get_my_totals() from public, anon;
grant execute on function public.get_my_totals() to authenticated;
