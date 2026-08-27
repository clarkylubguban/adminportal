-- Facebook / Meta Inbox F5 Inbox -> Inquiry bridge.
-- Additive only. Conversion is server-authoritative and keeps ops_inquiries
-- as the canonical Inquiry record.

do $$
begin
  if to_regclass('public.ops_inquiries') is null then
    raise exception using errcode = '42P01', message = 'OPS_INQUIRIES_REQUIRED';
  end if;

  if to_regclass('public.inbox_conversations') is null then
    raise exception using errcode = '42P01', message = 'INBOX_CONVERSATIONS_REQUIRED';
  end if;

  if to_regclass('public.inbox_inquiry_links') is null then
    raise exception using errcode = '42P01', message = 'INBOX_INQUIRY_LINKS_REQUIRED';
  end if;

  if to_regclass('public.admin_actions') is null then
    raise exception using errcode = '42P01', message = 'PEOPLE_ACCESS_ACTIONS_REQUIRED';
  end if;

  if to_regclass('public.admin_role_action_permissions') is null then
    raise exception using errcode = '42P01', message = 'PEOPLE_ACCESS_ACTION_PERMISSIONS_REQUIRED';
  end if;

  if to_regprocedure('public.inbox_f4_user_can_access_module(uuid,text)') is null then
    raise exception using errcode = '42883', message = 'INBOX_F4_MODULE_ACCESS_FUNCTION_REQUIRED';
  end if;

  if to_regprocedure('public.inbox_f4_user_has_action(uuid,text)') is null then
    raise exception using errcode = '42883', message = 'INBOX_F4_ACTION_ACCESS_FUNCTION_REQUIRED';
  end if;

  if to_regprocedure('public.inbox_f4_conversation_payload(uuid)') is null then
    raise exception using errcode = '42883', message = 'INBOX_F4_CONVERSATION_PAYLOAD_REQUIRED';
  end if;
end;
$$;

insert into public.admin_actions (action_key, name, is_protected)
values ('inbox_convert_to_inquiry', 'Convert Inbox conversation to Inquiry', true)
on conflict (action_key) do update
set name = excluded.name,
    is_protected = excluded.is_protected;

insert into public.admin_role_action_permissions (role_key, action_key, can_perform)
values
  ('owner_admin', 'inbox_convert_to_inquiry', true),
  ('admin_operations', 'inbox_convert_to_inquiry', true),
  ('cashier_front_desk', 'inbox_convert_to_inquiry', false),
  ('production_staff', 'inbox_convert_to_inquiry', false),
  ('staff', 'inbox_convert_to_inquiry', false),
  ('viewer', 'inbox_convert_to_inquiry', false)
on conflict (role_key, action_key) do update
set can_perform = excluded.can_perform;

create or replace function public.inbox_f5_inquiry_payload(p_inquiry public.ops_inquiries)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select case
    when p_inquiry.id is null then null::jsonb
    else jsonb_build_object(
      'id', p_inquiry.id,
      'customer', p_inquiry.customer_name,
      'customerName', p_inquiry.customer_name,
      'contact', p_inquiry.contact,
      'company', p_inquiry.company,
      'channel', p_inquiry.channel,
      'productDesc', p_inquiry.product_desc,
      'source', p_inquiry.source,
      'message', p_inquiry.message,
      'priority', p_inquiry.priority,
      'status', p_inquiry.status,
      'next', p_inquiry.next_action,
      'ownerUserId', p_inquiry.owner_user_id,
      'assignedUserId', p_inquiry.assigned_user_id,
      'createdAt', p_inquiry.created_at,
      'updatedAt', p_inquiry.updated_at
    )
  end
$$;

create or replace function public.convert_inbox_conversation_to_inquiry(
  p_conversation_id uuid,
  p_actor_user_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  conversation_row public.inbox_conversations%rowtype;
  identity_row public.inbox_channel_identities%rowtype;
  contact_row public.inbox_contacts%rowtype;
  latest_message_row public.inbox_messages%rowtype;
  existing_link public.inbox_inquiry_links%rowtype;
  inquiry_row public.ops_inquiries%rowtype;
  clean_idempotency_key text := btrim(coalesce(p_idempotency_key, ''));
  inquiry_id text;
  inquiry_message text;
  attempt integer := 0;
  event_idempotency_key text;
begin
  if p_actor_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'ADMIN_REQUIRED');
  end if;

  if length(clean_idempotency_key) not between 8 and 240 then
    return jsonb_build_object('ok', false, 'error', 'IDEMPOTENCY_KEY_REQUIRED');
  end if;

  if not public.inbox_f4_user_can_access_module(p_actor_user_id, 'inbox') then
    return jsonb_build_object('ok', false, 'error', 'INBOX_ACCESS_DENIED');
  end if;

  if not public.inbox_f4_user_has_action(p_actor_user_id, 'inbox_convert_to_inquiry') then
    return jsonb_build_object('ok', false, 'error', 'INBOX_CONVERT_TO_INQUIRY_DENIED');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_conversation_id::text, 0));

  select * into conversation_row
  from public.inbox_conversations
  where id = p_conversation_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'CONVERSATION_NOT_FOUND');
  end if;

  select * into existing_link
  from public.inbox_inquiry_links
  where idempotency_key = clean_idempotency_key;

  if found then
    if existing_link.conversation_id <> p_conversation_id then
      return jsonb_build_object('ok', false, 'error', 'IDEMPOTENCY_KEY_CONFLICT');
    end if;

    select * into inquiry_row
    from public.ops_inquiries
    where id = existing_link.inquiry_id;

    return jsonb_build_object(
      'ok', true,
      'replay', true,
      'inquiry', public.inbox_f5_inquiry_payload(inquiry_row),
      'conversation', public.inbox_f4_conversation_payload(p_conversation_id)
    );
  end if;

  select * into existing_link
  from public.inbox_inquiry_links
  where conversation_id = p_conversation_id;

  if found then
    select * into inquiry_row
    from public.ops_inquiries
    where id = existing_link.inquiry_id;

    return jsonb_build_object(
      'ok', true,
      'replay', true,
      'inquiry', public.inbox_f5_inquiry_payload(inquiry_row),
      'conversation', public.inbox_f4_conversation_payload(p_conversation_id)
    );
  end if;

  if conversation_row.state = 'closed' then
    return jsonb_build_object('ok', false, 'error', 'CONVERSATION_CLOSED');
  end if;

  select * into identity_row
  from public.inbox_channel_identities
  where id = conversation_row.channel_identity_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'CHANNEL_IDENTITY_NOT_FOUND');
  end if;

  select * into contact_row
  from public.inbox_contacts
  where id = identity_row.contact_id;

  select * into latest_message_row
  from public.inbox_messages
  where conversation_id = p_conversation_id
    and direction = 'inbound'
  order by sent_at desc nulls last, created_at desc
  limit 1;

  inquiry_message := concat_ws(E'\n',
    'Facebook Messenger conversation converted from Inbox.',
    case when latest_message_row.body is not null and btrim(latest_message_row.body) <> ''
      then 'Latest customer message: ' || btrim(latest_message_row.body)
      else null
    end,
    case when conversation_row.referral_ref is not null and btrim(conversation_row.referral_ref) <> ''
      then 'Referral: ' || btrim(conversation_row.referral_ref)
      else null
    end,
    case when conversation_row.campaign_name is not null and btrim(conversation_row.campaign_name) <> ''
      then 'Campaign: ' || btrim(conversation_row.campaign_name)
      else null
    end,
    case when conversation_row.ad_name is not null and btrim(conversation_row.ad_name) <> ''
      then 'Ad: ' || btrim(conversation_row.ad_name)
      else null
    end
  );

  loop
    inquiry_id := 'TRY-' || to_char(clock_timestamp() + make_interval(secs => attempt), 'YYYYMMDDHH24MISS');
    exit when not exists (select 1 from public.ops_inquiries where id = inquiry_id);
    attempt := attempt + 1;
    if attempt > 60 then
      return jsonb_build_object('ok', false, 'error', 'INQUIRY_ID_GENERATION_FAILED');
    end if;
  end loop;

  insert into public.ops_inquiries (
    id,
    customer_name,
    contact,
    company,
    channel,
    product_desc,
    source,
    message,
    priority,
    status,
    next_action,
    owner_user_id,
    assigned_user_id
  )
  values (
    inquiry_id,
    coalesce(nullif(btrim(contact_row.display_name), ''), nullif(btrim(identity_row.display_name), ''), 'Facebook customer'),
    coalesce(nullif(btrim(contact_row.primary_phone), ''), nullif(btrim(contact_row.primary_email), ''), nullif(btrim(identity_row.external_username), ''), 'Messenger'),
    nullif(btrim(contact_row.company_name), ''),
    'Facebook Messenger',
    coalesce(nullif(left(btrim(latest_message_row.body), 500), ''), 'Messenger conversation'),
    'FB',
    inquiry_message,
    'normal',
    'new',
    'Review inquiry',
    conversation_row.owner_user_id,
    conversation_row.owner_user_id
  )
  returning * into inquiry_row;

  insert into public.inbox_inquiry_links (
    conversation_id,
    inquiry_id,
    converted_by_user_id,
    idempotency_key,
    metadata
  )
  values (
    p_conversation_id,
    inquiry_row.id,
    p_actor_user_id,
    clean_idempotency_key,
    jsonb_build_object(
      'source', 'facebook_messenger',
      'channelIdentityId', conversation_row.channel_identity_id,
      'latestMessageId', latest_message_row.id
    )
  )
  returning * into existing_link;

  update public.inbox_conversations
  set state = 'converted',
      snoozed_until = null,
      closed_at = null
  where id = p_conversation_id
  returning * into conversation_row;

  event_idempotency_key := left(clean_idempotency_key, 220) || ':converted';
  insert into public.inbox_conversation_events (
    conversation_id,
    event_type,
    actor_user_id,
    actor_kind,
    payload,
    idempotency_key
  )
  values (
    p_conversation_id,
    'inquiry_converted',
    p_actor_user_id,
    'user',
    jsonb_build_object('inquiryId', inquiry_row.id),
    event_idempotency_key
  )
  on conflict do nothing;

  return jsonb_build_object(
    'ok', true,
    'replay', false,
    'inquiry', public.inbox_f5_inquiry_payload(inquiry_row),
    'conversation', public.inbox_f4_conversation_payload(p_conversation_id)
  );
exception
  when unique_violation then
    select * into existing_link
    from public.inbox_inquiry_links
    where conversation_id = p_conversation_id
       or idempotency_key = clean_idempotency_key
    order by case when conversation_id = p_conversation_id then 0 else 1 end
    limit 1;

    if found and existing_link.conversation_id = p_conversation_id then
      select * into inquiry_row from public.ops_inquiries where id = existing_link.inquiry_id;
      return jsonb_build_object(
        'ok', true,
        'replay', true,
        'inquiry', public.inbox_f5_inquiry_payload(inquiry_row),
        'conversation', public.inbox_f4_conversation_payload(p_conversation_id)
      );
    end if;

    return jsonb_build_object('ok', false, 'error', 'IDEMPOTENCY_KEY_CONFLICT');
end;
$$;

revoke all on function public.convert_inbox_conversation_to_inquiry(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.inbox_f5_inquiry_payload(public.ops_inquiries) from public, anon, authenticated;
grant execute on function public.convert_inbox_conversation_to_inquiry(uuid, uuid, text) to service_role;
grant execute on function public.inbox_f5_inquiry_payload(public.ops_inquiries) to service_role;
