-- Схема новостей ВЕКТОРА.
-- В подключённом проекте Supabase таблица и функции уже созданы.
-- Этот файл оставлен в архиве как резервная инструкция для повторной настройки.

create table if not exists public.news_posts (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  source_id text,
  category text not null check (category in ('school', 'esports', 'education')),
  title text not null,
  summary text,
  content text,
  url text,
  image_url text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  unique (source, source_id)
);

create index if not exists news_posts_status_created_idx
  on public.news_posts (status, created_at desc);
create index if not exists news_posts_approved_published_idx
  on public.news_posts (published_at desc, created_at desc)
  where status = 'approved';

alter table public.news_posts enable row level security;
revoke all on table public.news_posts from anon, authenticated;
grant select on table public.news_posts to anon, authenticated;
grant select, insert, update, delete on table public.news_posts to service_role;
drop policy if exists news_posts_public_read_approved on public.news_posts;
create policy news_posts_public_read_approved on public.news_posts
  for select to anon, authenticated using (status = 'approved');

create or replace function public.get_latest_news()
returns setof public.news_posts
language sql
stable
security invoker
set search_path = ''
as $$
  select * from public.news_posts
  where status = 'approved'
  order by published_at desc nulls last, created_at desc
  limit 30;
$$;
revoke all on function public.get_latest_news() from public;
grant execute on function public.get_latest_news() to anon, authenticated;

create or replace function public.approve_news_post(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  found_id uuid;
begin
  update public.news_posts
  set status = 'approved', published_at = now(), reviewed_at = now()
  where id = p_id and status = 'pending'
  returning id into found_id;
  if found_id is null then return false; end if;
  delete from public.news_posts
  where status = 'approved'
    and id not in (
      select id from public.news_posts
      where status = 'approved'
      order by published_at desc nulls last, created_at desc
      limit 30
    );
  return true;
end;
$$;
revoke all on function public.approve_news_post(uuid) from public;
grant execute on function public.approve_news_post(uuid) to service_role;
