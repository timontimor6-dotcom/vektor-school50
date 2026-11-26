-- Вставьте весь этот SQL в Supabase → SQL Editor → New query → Run.
-- Создаёт общее голосование за школу №50 или филиал №50.
-- Один голос на UUID браузера (не является защитой от обхода через другой браузер/устройство).

create table if not exists public.cs2_poll_votes (
  voter_id uuid primary key,
  team text not null check (team in ('school', 'branch')),
  created_at timestamptz not null default now()
);

alter table public.cs2_poll_votes enable row level security;

-- Запрещаем прямое чтение/запись таблицы с клиентского сайта.
revoke all on table public.cs2_poll_votes from anon, authenticated;

create or replace function public.submit_cs2_vote(p_voter_id uuid, p_team text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_count integer;
begin
  if p_team not in ('school', 'branch') then
    raise exception 'Invalid team';
  end if;

  insert into public.cs2_poll_votes (voter_id, team)
  values (p_voter_id, p_team)
  on conflict (voter_id) do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count = 1;
end;
$$;

create or replace function public.has_cs2_voted(p_voter_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.cs2_poll_votes
    where voter_id = p_voter_id
  );
$$;

create or replace function public.get_cs2_results()
returns table(team text, votes bigint)
language sql
security definer
set search_path = ''
as $$
  select choices.team, count(v.team)::bigint as votes
  from (values ('school'::text), ('branch'::text)) as choices(team)
  left join public.cs2_poll_votes v on v.team = choices.team
  group by choices.team
  order by choices.team;
$$;

revoke all on function public.submit_cs2_vote(uuid, text) from public;
revoke all on function public.has_cs2_voted(uuid) from public;
revoke all on function public.get_cs2_results() from public;

grant execute on function public.submit_cs2_vote(uuid, text) to anon, authenticated;
grant execute on function public.has_cs2_voted(uuid) to anon, authenticated;
grant execute on function public.get_cs2_results() to anon, authenticated;
