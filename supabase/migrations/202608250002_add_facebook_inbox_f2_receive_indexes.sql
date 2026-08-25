-- Facebook / Meta Inbox F2 receive-only performance cleanup.
-- Covers F1 actor/user foreign keys identified by Supabase advisor.

create index if not exists inbox_conversations_owner_user_id_idx
  on public.inbox_conversations (owner_user_id)
  where owner_user_id is not null;

create index if not exists inbox_messages_sender_user_id_idx
  on public.inbox_messages (sender_user_id)
  where sender_user_id is not null;

create index if not exists inbox_conversation_notes_created_by_user_id_idx
  on public.inbox_conversation_notes (created_by_user_id);

create index if not exists inbox_conversation_events_actor_user_id_idx
  on public.inbox_conversation_events (actor_user_id)
  where actor_user_id is not null;

create index if not exists inbox_inquiry_links_converted_by_user_id_idx
  on public.inbox_inquiry_links (converted_by_user_id);
