-- Earth Radio private user data and conflict-safe configuration sync.

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) between 1 and 80),
  avatar_url text check (avatar_url is null or char_length(avatar_url) <= 2048),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  theme text not null default 'system' check (theme in ('system', 'light', 'dark')),
  locale text not null default 'en' check (locale ~ '^[A-Za-z]{2,3}([_-][A-Za-z0-9]{2,8})*$'),
  volume numeric(4,3) not null default 0.800 check (volume between 0 and 1),
  autoplay boolean not null default false,
  metadata_enabled boolean not null default true,
  sync_enabled boolean not null default true,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.favorite_stations (
  user_id uuid not null references auth.users(id) on delete cascade,
  station_id text not null check (char_length(station_id) between 1 and 200),
  station_name text not null check (char_length(station_name) between 1 and 300),
  country_code text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  stream_url text not null check (char_length(stream_url) between 1 and 4096),
  favicon_url text check (favicon_url is null or char_length(favicon_url) <= 4096),
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, station_id)
);

create index favorite_stations_user_position_idx
  on public.favorite_stations (user_id, position, created_at);

create table public.recent_stations (
  user_id uuid not null references auth.users(id) on delete cascade,
  station_id text not null check (char_length(station_id) between 1 and 200),
  station_name text not null check (char_length(station_name) between 1 and 300),
  country_code text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  stream_url text not null check (char_length(stream_url) between 1 and 4096),
  play_count bigint not null default 1 check (play_count > 0),
  last_played_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, station_id)
);

create index recent_stations_user_last_played_idx
  on public.recent_stations (user_id, last_played_at desc);

create table public.country_preferences (
  user_id uuid not null references auth.users(id) on delete cascade,
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  is_expanded boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, country_code)
);

create table public.user_config_documents (
  user_id uuid not null references auth.users(id) on delete cascade,
  document_key text not null
    check (document_key ~ '^[a-z][a-z0-9_.-]{0,127}$'),
  value jsonb,
  revision bigint not null default 1 check (revision > 0),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, document_key),
  constraint user_config_document_value_size
    check (value is null or octet_length(value::text) <= 65536),
  constraint user_config_document_tombstone
    check (
      (deleted_at is null and value is not null)
      or (deleted_at is not null and value is null)
    )
);

create index user_config_documents_sync_idx
  on public.user_config_documents (user_id, updated_at, document_key);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.bump_preferences_revision()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.revision := old.revision + 1;
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger preferences_bump_revision
before update on public.user_preferences
for each row execute function public.bump_preferences_revision();

create trigger favorite_stations_set_updated_at
before update on public.favorite_stations
for each row execute function public.set_updated_at();

create trigger recent_stations_set_updated_at
before update on public.recent_stations
for each row execute function public.set_updated_at();

create trigger country_preferences_set_updated_at
before update on public.country_preferences
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_name text;
  requested_avatar text;
begin
  requested_name := coalesce(
    new.raw_user_meta_data ->> 'display_name',
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'name'
  );
  requested_avatar := coalesce(
    new.raw_user_meta_data ->> 'avatar_url',
    new.raw_user_meta_data ->> 'picture'
  );

  insert into public.profiles (user_id, display_name, avatar_url)
  values (
    new.id,
    nullif(left(trim(requested_name), 80), ''),
    case when char_length(requested_avatar) <= 2048 then requested_avatar end
  )
  on conflict (user_id) do nothing;

  insert into public.user_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.upsert_user_config_document(
  p_document_key text,
  p_value jsonb,
  p_expected_revision bigint,
  p_delete boolean default false
)
returns setof public.user_config_documents
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
begin
  if caller_id is null then
    raise insufficient_privilege using message = 'authentication required';
  end if;

  if p_document_key is null
     or p_document_key !~ '^[a-z][a-z0-9_.-]{0,127}$' then
    raise check_violation using message = 'invalid document key';
  end if;

  if p_expected_revision < 0 then
    raise check_violation using message = 'expected revision must be non-negative';
  end if;

  if not p_delete and p_value is null then
    raise check_violation using message = 'a live document requires a value';
  end if;

  if p_value is not null and octet_length(p_value::text) > 65536 then
    raise check_violation using message = 'document exceeds 64 KiB';
  end if;

  if p_expected_revision = 0 then
    return query
      insert into public.user_config_documents (
        user_id, document_key, value, revision, deleted_at
      ) values (
        caller_id,
        p_document_key,
        case when p_delete then null else p_value end,
        1,
        case when p_delete then now() else null end
      )
      on conflict (user_id, document_key) do nothing
      returning *;
    return;
  end if;

  return query
    update public.user_config_documents
       set value = case when p_delete then null else p_value end,
           revision = public.user_config_documents.revision + 1,
           deleted_at = case when p_delete then now() else null end,
           updated_at = now()
     where user_id = caller_id
       and document_key = p_document_key
       and revision = p_expected_revision
    returning *;
end;
$$;

alter table public.profiles enable row level security;
alter table public.profiles force row level security;
alter table public.user_preferences enable row level security;
alter table public.user_preferences force row level security;
alter table public.favorite_stations enable row level security;
alter table public.favorite_stations force row level security;
alter table public.recent_stations enable row level security;
alter table public.recent_stations force row level security;
alter table public.country_preferences enable row level security;
alter table public.country_preferences force row level security;
alter table public.user_config_documents enable row level security;
alter table public.user_config_documents force row level security;

create policy profiles_select_own
on public.profiles for select to authenticated
using ((select auth.uid()) = user_id);

create policy profiles_update_own
on public.profiles for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy preferences_select_own
on public.user_preferences for select to authenticated
using ((select auth.uid()) = user_id);

create policy preferences_insert_own
on public.user_preferences for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy preferences_update_own
on public.user_preferences for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy favorites_select_own
on public.favorite_stations for select to authenticated
using ((select auth.uid()) = user_id);

create policy favorites_insert_own
on public.favorite_stations for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy favorites_update_own
on public.favorite_stations for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy favorites_delete_own
on public.favorite_stations for delete to authenticated
using ((select auth.uid()) = user_id);

create policy recent_select_own
on public.recent_stations for select to authenticated
using ((select auth.uid()) = user_id);

create policy recent_insert_own
on public.recent_stations for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy recent_update_own
on public.recent_stations for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy recent_delete_own
on public.recent_stations for delete to authenticated
using ((select auth.uid()) = user_id);

create policy countries_select_own
on public.country_preferences for select to authenticated
using ((select auth.uid()) = user_id);

create policy countries_insert_own
on public.country_preferences for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy countries_update_own
on public.country_preferences for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy countries_delete_own
on public.country_preferences for delete to authenticated
using ((select auth.uid()) = user_id);

create policy config_documents_select_own
on public.user_config_documents for select to authenticated
using ((select auth.uid()) = user_id);

revoke all on public.profiles from public, anon, authenticated;
revoke all on public.user_preferences from public, anon, authenticated;
revoke all on public.favorite_stations from public, anon, authenticated;
revoke all on public.recent_stations from public, anon, authenticated;
revoke all on public.country_preferences from public, anon, authenticated;
revoke all on public.user_config_documents from public, anon, authenticated;

grant select, update on public.profiles to authenticated;
grant select, insert, update on public.user_preferences to authenticated;
grant select, insert, update, delete on public.favorite_stations to authenticated;
grant select, insert, update, delete on public.recent_stations to authenticated;
grant select, insert, update, delete on public.country_preferences to authenticated;
grant select on public.user_config_documents to authenticated;

revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.bump_preferences_revision() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.upsert_user_config_document(text, jsonb, bigint, boolean)
  from public, anon;
grant execute on function public.upsert_user_config_document(text, jsonb, bigint, boolean)
  to authenticated;

comment on function public.upsert_user_config_document(text, jsonb, bigint, boolean) is
  'Atomic compare-and-swap for private user configuration. Returns zero rows on revision conflict.';
