-- Facebook Inbox F9.8A reply-window ingestion authority.
-- The Messenger reply window is derived only from real customer inbound
-- messages. Outbound echoes, delivery/read receipts, and staff replies must not
-- renew or shorten the window.

do $$
begin
  if to_regclass('public.inbox_conversations') is null then
    raise exception using errcode = '42P01', message = 'INBOX_CONVERSATIONS_REQUIRED';
  end if;

  if to_regclass('public.inbox_messages') is null then
    raise exception using errcode = '42P01', message = 'INBOX_MESSAGES_REQUIRED';
  end if;

  if to_regprocedure('public.reserve_inbox_reply(uuid,uuid,text,text,timestamptz)') is null then
    raise exception using errcode = '42883', message = 'RESERVE_INBOX_REPLY_REQUIRED';
  end if;
end;
$$;

create or replace function public.inbox_touch_conversation_from_message()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  is_customer_inbound boolean;
begin
  is_customer_inbound := new.direction = 'inbound'
    and coalesce(new.is_echo, false) = false;

  update public.inbox_conversations conversation
  set
    state = case
      when is_customer_inbound and conversation.state <> 'closed'
        then 'needs_reply'
      else conversation.state
    end,
    last_message_at = greatest(
      coalesce(conversation.last_message_at, new.sent_at),
      new.sent_at
    ),
    last_inbound_at = case
      when is_customer_inbound
        then greatest(coalesce(conversation.last_inbound_at, new.sent_at), new.sent_at)
      else conversation.last_inbound_at
    end,
    last_outbound_at = case
      when new.direction = 'outbound'
        then greatest(coalesce(conversation.last_outbound_at, new.sent_at), new.sent_at)
      else conversation.last_outbound_at
    end,
    reply_window_expires_at = case
      when is_customer_inbound
        then greatest(
          coalesce(conversation.reply_window_expires_at, new.sent_at + interval '24 hours'),
          new.sent_at + interval '24 hours'
        )
      else conversation.reply_window_expires_at
    end
  where conversation.id = new.conversation_id;

  return new;
end;
$$;

drop trigger if exists inbox_messages_touch_conversation on public.inbox_messages;
create trigger inbox_messages_touch_conversation
after insert on public.inbox_messages
for each row execute function public.inbox_touch_conversation_from_message();

with latest_customer_inbound as (
  select
    message.conversation_id,
    max(message.sent_at) as latest_inbound_at
  from public.inbox_messages message
  where message.direction = 'inbound'
    and coalesce(message.is_echo, false) = false
    and message.sent_at is not null
  group by message.conversation_id
)
update public.inbox_conversations conversation
set
  last_inbound_at = greatest(
    coalesce(conversation.last_inbound_at, latest.latest_inbound_at),
    latest.latest_inbound_at
  ),
  last_message_at = greatest(
    coalesce(conversation.last_message_at, latest.latest_inbound_at),
    latest.latest_inbound_at
  ),
  reply_window_expires_at = greatest(
    coalesce(conversation.reply_window_expires_at, latest.latest_inbound_at + interval '24 hours'),
    latest.latest_inbound_at + interval '24 hours'
  )
from latest_customer_inbound latest
where conversation.id = latest.conversation_id
  and (
    conversation.last_inbound_at is null
    or conversation.last_inbound_at < latest.latest_inbound_at
    or conversation.last_message_at is null
    or conversation.last_message_at < latest.latest_inbound_at
    or conversation.reply_window_expires_at is null
    or conversation.reply_window_expires_at < latest.latest_inbound_at + interval '24 hours'
  );
