-- Supabase -> SQL Editor -> New query -> 전체 붙여넣기 -> Run
-- 기존 피아노 설문과 충돌하지 않는 신규 테이블입니다.
create table if not exists public.music_survey_responses (
  id bigint generated always as identity primary key,
  genre text not null check (genre in ('classical', 'jazz')),
  agreement smallint not null check (agreement between 1 and 5),
  created_at timestamptz not null default now()
);

alter table public.music_survey_responses enable row level security;

-- 익명 이용자는 읽기/제출만 가능하도록 설정 (수정/삭제 불가)
revoke all on table public.music_survey_responses from anon, authenticated;
grant select, insert on table public.music_survey_responses to anon, authenticated;

drop policy if exists "Anyone can read survey responses" on public.music_survey_responses;
create policy "Anyone can read survey responses"
  on public.music_survey_responses
  for select to anon, authenticated
  using (true);

drop policy if exists "Anyone can submit survey responses" on public.music_survey_responses;
create policy "Anyone can submit survey responses"
  on public.music_survey_responses
  for insert to anon, authenticated
  with check (true);

-- 실시간 구독을 위한 Realtime 등록 (중복 실행 시에도 안전)
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'music_survey_responses'
  ) then
    alter publication supabase_realtime add table public.music_survey_responses;
  end if;
end $$;
