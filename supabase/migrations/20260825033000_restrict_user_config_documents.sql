-- Bound generic document storage to the three records synchronized by this client.

alter table public.user_config_documents
  drop constraint if exists user_config_document_supported_key;

alter table public.user_config_documents
  add constraint user_config_document_supported_key
  check (document_key in ('favorites', 'recents', 'preferences'))
  not valid;

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
     or p_document_key not in ('favorites', 'recents', 'preferences') then
    raise check_violation using message = 'unsupported document key';
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

revoke all on function public.upsert_user_config_document(text, jsonb, bigint, boolean)
  from public, anon;
grant execute on function public.upsert_user_config_document(text, jsonb, bigint, boolean)
  to authenticated;

comment on constraint user_config_document_supported_key on public.user_config_documents is
  'Limits each user to the three bounded synchronization documents supported by Earth Radio.';
