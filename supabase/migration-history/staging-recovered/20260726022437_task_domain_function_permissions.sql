revoke all on function public.task_assert_enabled() from public, anon, authenticated, service_role;
revoke all on function public.task_current_actor() from public, anon, authenticated, service_role;
revoke all on function public.task_require_idempotency_key(text) from public, anon, authenticated, service_role;
revoke all on function public.task_active_user_role(uuid) from public, anon, authenticated, service_role;
revoke all on function public.task_assert_assignment(text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.task_assert_reviewer(uuid) from public, anon, authenticated, service_role;
revoke all on function public.task_idempotency_replay(uuid, text[], text) from public, anon, authenticated, service_role;
revoke all on function public.task_assert_replay_fingerprint(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.task_write_event(uuid, text, uuid, text, text, text, jsonb, text, text, boolean) from public, anon, authenticated, service_role;
revoke all on function public.task_command_result(uuid, uuid, text, boolean) from public, anon, authenticated, service_role;

revoke all on function public.task_create(text, text, text, text, text, text, uuid, uuid, boolean, date, timestamptz, timestamptz, timestamptz, text, text, text, text) from public, anon, service_role;
revoke all on function public.task_update_draft(uuid, bigint, text, text, text, uuid, uuid, boolean, date, timestamptz, timestamptz, timestamptz, text, text) from public, anon, service_role;
revoke all on function public.task_assign(uuid, bigint, uuid, text) from public, anon, service_role;
revoke all on function public.task_approve_draft(uuid, bigint, text) from public, anon, service_role;
revoke all on function public.task_start_work(uuid, bigint, text) from public, anon, service_role;
revoke all on function public.task_submit_for_review(uuid, bigint, text, text, text) from public, anon, service_role;
revoke all on function public.task_submit_without_time(uuid, bigint, text, text, text) from public, anon, service_role;
revoke all on function public.task_request_revision(uuid, bigint, text, text) from public, anon, service_role;
revoke all on function public.task_start_revision(uuid, bigint, text) from public, anon, service_role;
revoke all on function public.task_approve_work(uuid, bigint, text, text) from public, anon, service_role;
revoke all on function public.task_cancel(uuid, bigint, text, text) from public, anon, service_role;
revoke all on function public.task_reopen(uuid, bigint, text, text) from public, anon, service_role;
revoke all on function public.task_correct_time_entry(uuid, uuid, bigint, timestamptz, timestamptz, text, text) from public, anon, service_role;
revoke all on function public.task_archive(uuid, bigint, text) from public, anon, service_role;

grant execute on function public.task_create(text, text, text, text, text, text, uuid, uuid, boolean, date, timestamptz, timestamptz, timestamptz, text, text, text, text) to authenticated;
grant execute on function public.task_update_draft(uuid, bigint, text, text, text, uuid, uuid, boolean, date, timestamptz, timestamptz, timestamptz, text, text) to authenticated;
grant execute on function public.task_assign(uuid, bigint, uuid, text) to authenticated;
grant execute on function public.task_approve_draft(uuid, bigint, text) to authenticated;
grant execute on function public.task_start_work(uuid, bigint, text) to authenticated;
grant execute on function public.task_submit_for_review(uuid, bigint, text, text, text) to authenticated;
grant execute on function public.task_submit_without_time(uuid, bigint, text, text, text) to authenticated;
grant execute on function public.task_request_revision(uuid, bigint, text, text) to authenticated;
grant execute on function public.task_start_revision(uuid, bigint, text) to authenticated;
grant execute on function public.task_approve_work(uuid, bigint, text, text) to authenticated;
grant execute on function public.task_cancel(uuid, bigint, text, text) to authenticated;
grant execute on function public.task_reopen(uuid, bigint, text, text) to authenticated;
grant execute on function public.task_correct_time_entry(uuid, uuid, bigint, timestamptz, timestamptz, text, text) to authenticated;
grant execute on function public.task_archive(uuid, bigint, text) to authenticated;

comment on function public.task_create(text, text, text, text, text, text, uuid, uuid, boolean, date, timestamptz, timestamptz, timestamptz, text, text, text, text) is
  'Creates a hidden DRAFT task. This function performs no source-system mutation.';;
