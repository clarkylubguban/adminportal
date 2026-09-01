-- Phase 8.8 staging repair follow-up: remove the legacy draft update overload.
--
-- The legacy 14-argument function did not accept source-record edits and did
-- not normalize AI/Daily draft assignment to null. Keeping it callable would
-- weaken the locked AI draft activation architecture.

drop function if exists public.task_update_draft(uuid, bigint, text, text, text, uuid, uuid, boolean, date, timestamptz, timestamptz, timestamptz, text, text);

-- Rollback SQL:
-- Re-apply public.task_update_draft(uuid, bigint, text, text, text, uuid, uuid,
-- boolean, date, timestamptz, timestamptz, timestamptz, text, text) from
-- supabase/migrations/202607250002_create_task_domain_functions.sql.
