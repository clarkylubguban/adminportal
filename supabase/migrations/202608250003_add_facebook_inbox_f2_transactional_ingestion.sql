-- Facebook / Meta Inbox F2.1 transactional receive-only ingestion.
-- Keeps webhook acknowledgement synchronous, but reduces server-side DB work to
-- one service-role RPC call per normalized webhook batch.

create or replace function public.ingest_meta_messenger_events(
  events jsonb,
  received_at timestamptz default now(),
  object_type text default 'page'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  event jsonb;
  event_key text;
  event_type text;
  page_id text;
  customer_psid text;
  should_process boolean;
  event_time timestamptz;
  webhook_id uuid;
  page_connection_id uuid;
  contact_id uuid;
  inserted_contact_id uuid;
  identity_id uuid;
  conversation_id uuid;
  message_id uuid;
  message_payload jsonb;
  delivery_payload jsonb;
  attachment jsonb;
  processed_count integer := 0;
  duplicate_count integer := 0;
  ignored_count integer := 0;
begin
  if events is null or jsonb_typeof(events) <> 'array' then
    raise exception using
      errcode = '22023',
      message = 'META_INGEST_EVENTS_ARRAY_REQUIRED';
  end if;

  for event in select value from jsonb_array_elements(events)
  loop
    if jsonb_typeof(event) <> 'object' then
      raise exception using
        errcode = '22023',
        message = 'META_INGEST_EVENT_OBJECT_REQUIRED';
    end if;

    event_key := nullif(btrim(event->>'eventKey'), '');
    event_type := coalesce(nullif(btrim(event->>'eventType'), ''), 'unknown');
    page_id := nullif(btrim(event->>'pageId'), '');
    customer_psid := nullif(btrim(event->>'customerPsid'), '');
    should_process := coalesce((event->>'shouldProcess')::boolean, false);
    event_time := coalesce(nullif(event->>'eventTime', '')::timestamptz, received_at);
    webhook_id := null;
    page_connection_id := null;
    contact_id := null;
    inserted_contact_id := null;
    identity_id := null;
    conversation_id := null;
    message_id := null;
    message_payload := event->'message';
    delivery_payload := event->'delivery';

    if event_key is null then
      raise exception using
        errcode = '22023',
        message = 'META_INGEST_EVENT_KEY_REQUIRED';
    end if;

    insert into public.meta_webhook_events (
      event_key,
      object_type,
      page_id,
      event_type,
      payload,
      processing_status,
      received_at
    )
    values (
      event_key,
      object_type,
      page_id,
      event_type,
      coalesce(event->'raw', '{}'::jsonb),
      case when should_process then 'received' else 'ignored' end,
      received_at
    )
    on conflict on constraint meta_webhook_events_key_unique do nothing
    returning id into webhook_id;

    if webhook_id is null then
      duplicate_count := duplicate_count + 1;
      continue;
    end if;

    if not should_process then
      ignored_count := ignored_count + 1;
      continue;
    end if;

    insert into public.meta_page_connections (page_id, status, last_webhook_at)
    values (page_id, 'testing', received_at)
    on conflict on constraint meta_page_connections_page_id_unique do update
    set last_webhook_at = greatest(
      coalesce(public.meta_page_connections.last_webhook_at, excluded.last_webhook_at),
      excluded.last_webhook_at
    )
    returning id into page_connection_id;

    if customer_psid is not null then
      select identity.id, identity.contact_id
      into identity_id, contact_id
      from public.inbox_channel_identities identity
      where identity.page_connection_id = page_connection_id
        and identity.channel = 'facebook_messenger'
        and identity.external_user_id = customer_psid
      limit 1;

      if identity_id is null then
        insert into public.inbox_contacts (display_name, metadata)
        values (nullif(event->>'customerDisplayName', ''), '{}'::jsonb)
        returning id into inserted_contact_id;

        insert into public.inbox_channel_identities (
          contact_id,
          page_connection_id,
          channel,
          external_user_id,
          display_name,
          last_seen_at,
          metadata
        )
        values (
          inserted_contact_id,
          page_connection_id,
          'facebook_messenger',
          customer_psid,
          nullif(event->>'customerDisplayName', ''),
          event_time,
          '{}'::jsonb
        )
        on conflict on constraint inbox_channel_identities_unique do nothing
        returning id, contact_id into identity_id, contact_id;

        if identity_id is null then
          select identity.id, identity.contact_id
          into identity_id, contact_id
          from public.inbox_channel_identities identity
          where identity.page_connection_id = page_connection_id
            and identity.channel = 'facebook_messenger'
            and identity.external_user_id = customer_psid
          limit 1;

          delete from public.inbox_contacts contact
          where contact.id = inserted_contact_id
            and not exists (
              select 1
              from public.inbox_channel_identities identity
              where identity.contact_id = contact.id
            );
        end if;
      else
        update public.inbox_channel_identities identity
        set
          display_name = coalesce(nullif(event->>'customerDisplayName', ''), identity.display_name),
          last_seen_at = greatest(coalesce(identity.last_seen_at, event_time), event_time)
        where identity.id = identity_id;
      end if;

      select conversation.id
      into conversation_id
      from public.inbox_conversations conversation
      where conversation.channel_identity_id = identity_id
        and conversation.state <> 'closed'
      limit 1;

      if conversation_id is null then
        insert into public.inbox_conversations (
          channel_identity_id,
          state,
          last_message_at,
          entry_source,
          referral_ref,
          ad_id,
          ad_name,
          campaign_id,
          campaign_name,
          metadata
        )
        values (
          identity_id,
          coalesce(nullif(event->>'conversationState', ''), 'needs_reply'),
          case when message_payload is not null and jsonb_typeof(message_payload) = 'object' then event_time else null end,
          nullif(event#>>'{referralAttribution,entrySource}', ''),
          nullif(event#>>'{referralAttribution,ref}', ''),
          nullif(event#>>'{referralAttribution,adId}', ''),
          nullif(event#>>'{referralAttribution,adName}', ''),
          nullif(event#>>'{referralAttribution,campaignId}', ''),
          nullif(event#>>'{referralAttribution,campaignName}', ''),
          case
            when event->'referralAttribution' is not null
              then jsonb_build_object('referral', event#>'{referralAttribution,raw}')
            else '{}'::jsonb
          end
        )
        on conflict do nothing
        returning id into conversation_id;

        if conversation_id is null then
          select conversation.id
          into conversation_id
          from public.inbox_conversations conversation
          where conversation.channel_identity_id = identity_id
            and conversation.state <> 'closed'
          limit 1;
        end if;
      end if;

      update public.inbox_conversations conversation
      set
        state = coalesce(nullif(event->>'conversationState', ''), conversation.state),
        last_message_at = case
          when message_payload is not null and jsonb_typeof(message_payload) = 'object'
            then greatest(coalesce(conversation.last_message_at, event_time), event_time)
          else conversation.last_message_at
        end,
        entry_source = coalesce(nullif(event#>>'{referralAttribution,entrySource}', ''), conversation.entry_source),
        referral_ref = coalesce(nullif(event#>>'{referralAttribution,ref}', ''), conversation.referral_ref),
        ad_id = coalesce(nullif(event#>>'{referralAttribution,adId}', ''), conversation.ad_id),
        ad_name = coalesce(nullif(event#>>'{referralAttribution,adName}', ''), conversation.ad_name),
        campaign_id = coalesce(nullif(event#>>'{referralAttribution,campaignId}', ''), conversation.campaign_id),
        campaign_name = coalesce(nullif(event#>>'{referralAttribution,campaignName}', ''), conversation.campaign_name),
        metadata = case
          when event->'referralAttribution' is not null
            then coalesce(conversation.metadata, '{}'::jsonb)
              || jsonb_build_object('referral', event#>'{referralAttribution,raw}')
          else conversation.metadata
        end
      where conversation.id = conversation_id;

      if message_payload is not null and jsonb_typeof(message_payload) = 'object' then
        insert into public.inbox_messages (
          conversation_id,
          webhook_event_id,
          external_message_id,
          direction,
          message_type,
          body,
          sender_external_id,
          is_echo,
          sent_at,
          metadata
        )
        values (
          conversation_id,
          webhook_id,
          nullif(message_payload->>'externalMessageId', ''),
          coalesce(nullif(message_payload->>'direction', ''), 'inbound'),
          coalesce(nullif(message_payload->>'messageType', ''), 'text'),
          nullif(message_payload->>'body', ''),
          nullif(message_payload->>'senderExternalId', ''),
          coalesce((message_payload->>'isEcho')::boolean, false),
          event_time,
          coalesce(message_payload->'metadata', '{}'::jsonb)
        )
        on conflict (provider, external_message_id) where external_message_id is not null do nothing
        returning id into message_id;

        if message_id is not null then
          for attachment in
            select value
            from jsonb_array_elements(coalesce(event->'attachments', '[]'::jsonb))
          loop
            insert into public.inbox_attachments (
              message_id,
              external_attachment_id,
              attachment_type,
              source_url,
              original_filename,
              mime_type,
              ingestion_status,
              metadata
            )
            values (
              message_id,
              nullif(attachment->>'externalAttachmentId', ''),
              coalesce(nullif(attachment->>'attachmentType', ''), 'unknown'),
              nullif(attachment->>'sourceUrl', ''),
              nullif(attachment->>'originalFilename', ''),
              nullif(attachment->>'mimeType', ''),
              'pending',
              coalesce(attachment->'metadata', '{}'::jsonb)
            );
          end loop;
        end if;
      end if;

      if delivery_payload is not null
         and jsonb_typeof(delivery_payload) = 'object'
         and jsonb_typeof(delivery_payload->'messageIds') = 'array' then
        update public.inbox_messages message
        set delivered_at = greatest(coalesce(message.delivered_at, event_time), event_time)
        where message.conversation_id = conversation_id
          and message.external_message_id in (
            select value #>> '{}'
            from jsonb_array_elements(delivery_payload->'messageIds')
          );
      end if;

      if coalesce((event->>'read')::boolean, false) then
        update public.inbox_messages message
        set read_at = greatest(coalesce(message.read_at, event_time), event_time)
        where message.conversation_id = conversation_id
          and message.direction = 'outbound';
      end if;
    end if;

    update public.meta_webhook_events webhook
    set
      processing_status = 'processed',
      processed_at = received_at,
      last_error_summary = null
    where webhook.id = webhook_id;

    processed_count := processed_count + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'processed', processed_count,
    'duplicates', duplicate_count,
    'ignored', ignored_count
  );
end;
$$;

revoke all on function public.ingest_meta_messenger_events(jsonb, timestamptz, text)
  from public, anon, authenticated;

grant execute on function public.ingest_meta_messenger_events(jsonb, timestamptz, text)
  to service_role;
