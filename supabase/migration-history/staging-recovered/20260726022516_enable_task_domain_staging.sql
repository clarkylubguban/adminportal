update public.task_feature_flags set enabled = true, updated_at = clock_timestamp() where feature = 'TASK_DOMAIN';;
