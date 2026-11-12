begin;

create extension if not exists pgtap with schema extensions;

select plan(45);

select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.user_config_documents'::regclass),
  'adding Passport preserves forced row-level security');
select ok((select prosecdef and proconfig @> array['search_path=""'] from pg_proc
    where oid = 'public.upsert_user_config_document(text,jsonb,bigint,boolean)'::regprocedure)
  and not has_function_privilege('anon', 'public.upsert_user_config_document(text,jsonb,bigint,boolean)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.upsert_user_config_document(text,jsonb,bigint,boolean)', 'EXECUTE'),
  'the bounded privileged RPC keeps its empty search path and authenticated-only grant');

select ok(
  to_regprocedure('public.rls_auto_enable()') is null
    or not has_function_privilege('anon', 'public.rls_auto_enable()', 'EXECUTE'),
  'anonymous users cannot execute the automatic RLS trigger function'
);

select ok(
  to_regprocedure('public.rls_auto_enable()') is null
    or not has_function_privilege('authenticated', 'public.rls_auto_enable()', 'EXECUTE'),
  'authenticated users cannot execute the automatic RLS trigger function'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
) values
  (
    '11111111-1111-4111-8111-111111111111',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'alice@example.test', '',
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"display_name":"Alice"}'::jsonb
  ),
  (
    '22222222-2222-4222-8222-222222222222',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'bob@example.test', '',
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"display_name":"Bob"}'::jsonb
  );

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select is(
  (select count(*)::integer from public.profiles),
  1,
  'a user can read only their own profile'
);

select is(
  (select display_name from public.profiles),
  'Alice',
  'signup trigger safely copies the display name'
);

select is(
  (select count(*)::integer from public.user_preferences),
  1,
  'signup trigger creates one private preferences row'
);

insert into public.favorite_stations (
  user_id, station_id, station_name, country_code, stream_url
) values (
  '11111111-1111-4111-8111-111111111111',
  'station-a', 'Station A', 'US', 'https://example.test/a'
);

select is(
  (select count(*)::integer from public.favorite_stations),
  1,
  'a user can add and read their own favorite'
);

select throws_ok(
  $$
    insert into public.favorite_stations (
      user_id, station_id, station_name, country_code, stream_url
    ) values (
      '22222222-2222-4222-8222-222222222222',
      'forged', 'Forged', 'US', 'https://example.test/forged'
    )
  $$,
  '42501',
  null,
  'a user cannot forge ownership on insert'
);

select lives_ok(
  $$
    update public.user_preferences
       set theme = 'dark'
     where user_id = '11111111-1111-4111-8111-111111111111'
  $$,
  'a user can update their own preferences'
);

select is(
  (select revision::integer from public.user_preferences),
  2,
  'preference updates increment the server revision'
);

select is(
  (
    select revision::integer
      from public.upsert_user_config_document(
        'preferences', '{"bass":2}'::jsonb, 0, false
      )
  ),
  1,
  'config RPC creates a document at revision one'
);

select is(
  (
    select revision::integer
      from public.upsert_user_config_document(
        'preferences', '{"bass":3}'::jsonb, 1, false
      )
  ),
  2,
  'config RPC accepts the current expected revision'
);

select is(
  (
    select count(*)::integer
      from public.upsert_user_config_document(
        'preferences', '{"bass":99}'::jsonb, 1, false
      )
  ),
  0,
  'config RPC rejects a stale expected revision'
);

select is(
  (select value ->> 'bass' from public.user_config_documents where document_key = 'preferences'),
  '3',
  'a rejected stale write does not change stored data'
);

select throws_ok(
  $$
    update public.user_config_documents
       set value = '{"bass":100}'::jsonb
     where document_key = 'preferences'
  $$,
  '42501',
  null,
  'direct config mutation is denied so revision checks cannot be bypassed'
);

select throws_ok(
  $$ select * from public.upsert_user_config_document('unsupported', '{}'::jsonb, 0, false) $$,
  '23514',
  'unsupported document key',
  'config RPC rejects keys outside the five synchronized documents'
);

select lives_ok(
  $$
    select * from public.upsert_user_config_document(
      'favorites', jsonb_build_object('payload', repeat('x', 70000)), 0, false
    )
  $$,
  'favorites accepts a valid document larger than the preferences limit'
);

select throws_ok(
  $$
    select * from public.upsert_user_config_document(
      'preferences', jsonb_build_object('payload', repeat('x', 70000)), 0, false
    )
  $$,
  '23514',
  'document exceeds supported size',
  'preferences retains a bounded document size'
);

select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);

select is((select revision::integer from public.upsert_user_config_document('songs', '{"version":1,"tracks":{}}'::jsonb, 0, false)),
  1, 'songs use the existing authenticated revision-checked document RPC');
select is((select count(*)::integer from public.upsert_user_config_document('songs', '{"version":1}'::jsonb, 99, false)),
  0, 'songs reject stale expected revisions');
select throws_ok($$ select * from public.upsert_user_config_document('songs', jsonb_build_object('payload', repeat('x', 1048576)), 1, false) $$,
  '23514', 'document exceeds supported size', 'songs are bounded to one MiB');
select lives_ok($$ select * from public.upsert_user_config_document('songs', jsonb_build_object('payload', repeat('x', 70000)), 1, false) $$,
  'songs may exceed the smaller preferences limit');
select is((select count(*)::integer from public.upsert_user_config_document('songs', null, 2, true)), 1, 'songs support revision-checked deletion');
select ok((select value is null and deleted_at is not null from public.user_config_documents where document_key = 'songs'),
  'song deletion leaves a sync tombstone');

select is((select revision::integer from public.upsert_user_config_document('passport', '{"version":1,"countries":{},"cities":{}}'::jsonb, 0, false)),
  1, 'Passport uses the existing authenticated revision-checked RPC');
select is((select count(*)::integer from public.user_config_documents where document_key = 'passport'),
  1, 'the owner can read their Passport');
select is((select count(*)::integer from public.upsert_user_config_document('passport', '{}'::jsonb, 99, false)),
  0, 'Passport rejects stale expected revisions');
select throws_ok($$ select * from public.upsert_user_config_document('passport', jsonb_build_object('payload', repeat('x', 262144)), 1, false) $$,
  '23514', 'document exceeds supported size', 'Passport rejects values above 256 KiB');
select is((select revision::integer from public.upsert_user_config_document('passport', to_jsonb(repeat('한', 87380) || 'xx'), 1, false)),
  2, 'Passport accepts exactly 262144 serialized UTF-8 bytes');
select throws_ok($$ select * from public.upsert_user_config_document('passport', to_jsonb(repeat('한', 87380) || 'xxx'), 2, false) $$,
  '23514', 'document exceeds supported size', 'Passport rejects one byte above the serialized UTF-8 limit');
select throws_ok($$ update public.user_config_documents set value = '{}'::jsonb where document_key = 'passport' $$,
  '42501', null, 'direct Passport mutation cannot bypass revision checks');
select is((select count(*)::integer from public.upsert_user_config_document('passport', null, 2, true)),
  1, 'Passport supports revision-checked deletion');
select ok((select value is null and deleted_at is not null and revision = 3 from public.user_config_documents where document_key = 'passport'),
  'Passport deletion retains a revisioned tombstone');

select is(
  (select count(*)::integer from public.favorite_stations),
  0,
  'another user cannot read the first user favorites'
);

select is(
  (select count(*)::integer from public.user_config_documents where document_key not in ('songs', 'passport')),
  0,
  'another user cannot read the first user config documents'
);

delete from public.favorite_stations where station_id = 'station-a';

select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

select is((select count(*)::integer from public.user_config_documents where document_key = 'songs'), 0,
  'a different account cannot read the song document');
select is((select count(*)::integer from public.upsert_user_config_document('songs', '{"version":1}'::jsonb, 3, false)), 0,
  'a different account cannot update the song document using its known revision');
select is((select count(*)::integer from public.user_config_documents where document_key = 'passport'), 0,
  'a different account cannot read the Passport');
select is((select count(*)::integer from public.upsert_user_config_document('passport', '{}'::jsonb, 3, false)), 0,
  'a different account cannot update the Passport using its known revision');

select is(
  (select count(*)::integer from public.favorite_stations),
  1,
  'a cross-user delete affects no rows'
);

select set_config('request.jwt.claim.sub', '', true);
set local role anon;

select throws_ok(
  $$ select count(*) from public.profiles $$,
  '42501',
  null,
  'anonymous users cannot read profiles'
);

select throws_ok(
  $$ select count(*) from public.user_preferences $$,
  '42501',
  null,
  'anonymous users cannot read preferences'
);

select throws_ok(
  $$ select * from public.upsert_user_config_document('anonymous.write', '{}'::jsonb, 0, false) $$,
  '42501',
  null,
  'anonymous users cannot execute the config mutation RPC'
);
select throws_ok($$ select * from public.upsert_user_config_document('passport', '{}'::jsonb, 0, false) $$,
  '42501', null, 'anonymous users cannot execute Passport writes');

select * from finish();
rollback;
