-- Phase 8.7 Auto Plan Today.
-- Quick Direction is optional in the Owner command, but remains immutable once
-- the planning request is created.

alter table public.planning_requests
  drop constraint if exists planning_requests_direction_check;

alter table public.planning_requests
  add constraint planning_requests_direction_check
    check (length(trim(quick_direction)) between 0 and 2000);
;
