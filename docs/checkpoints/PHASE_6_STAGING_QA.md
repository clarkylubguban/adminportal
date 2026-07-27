# Phase 6 Staging QA

Date: 2026-07-27

## Phase 6B Credentialed QA Addendum

Test timestamp: 2026-07-27 Asia/Manila

| Item | Result |
| --- | --- |
| Phase 6B starting commit | `ddba7ce0f9802736d25f701ff481d16a7bdf5b5d` |
| Phase 6B tested app commit | `ddba7ce0f9802736d25f701ff481d16a7bdf5b5d` |
| Phase 6B tested deployment | `dpl_CU5muBgwtQ2pyZLsADissqeYyMN6` |
| Phase 6B staging URL | `https://adminportal-staging.vercel.app` |
| Browser session availability | BLOCKED - the only available Codex in-app browser profile opened staging at the login screen, and there were no prepared open tabs to claim. |
| Account roles found in staging DB | Owner only. No Admin or Staff rows exist in `public.admin_users` at Phase 6B check time. |
| Credentials/tokens/cookies handling | PASS - no passwords, tokens, cookies, or session credentials were requested, inspected, printed, logged, committed, or documented. |

Confirmed Admin Portal role rows at Phase 6B check time:

| Role | Count | Notes |
| --- | ---: | --- |
| owner | 2 | Both rows exist in Auth and `public.admin_users`; both active and email-confirmed. |
| admin | 0 | Blocks Admin credentialed QA. |
| staff | 0 | Blocks Staff and two-session Work Chat QA. |

Phase 6B live credentialed QA status:

| Phase | Status | Result |
| --- | --- | --- |
| Phase A - Work Chat two-session QA | BLOCKED | Requires authenticated Owner and Staff sessions. Only available browser profile showed the login page; no Staff profile exists in staging DB. |
| Phase B - Mentions | BLOCKED | Requires a real synthetic Staff account/session and Owner session. No Staff profile exists. |
| Phase C - Attachments | BLOCKED | Requires authenticated Work Chat session to prepare/upload/send files and verify signed URLs against real linked attachments. |
| Phase D - Order Threads | BLOCKED | Requires authenticated Admin Portal session and synthetic confirmed order interaction. |
| Phase E - Disabled User | BLOCKED | Requires synthetic Staff account/session. No Staff profile exists; no real Owner accounts were disabled. |
| Phase F - Role and Permission QA | BLOCKED | Owner/Admin/Staff browser sessions were not available; Admin and Staff rows are absent. Anonymous Work Chat API/table probes passed. |
| Phase G - Full Authenticated Visual QA | BLOCKED | Requires authenticated staging UI access across roles. The available browser profile is logged out. |
| Phase H - Workflow Regression via UI | BLOCKED | Requires authenticated staging UI access. Automated non-credentialed regressions passed again. |
| Phase I - Security Follow-up | PASS with attachment caveat | RLS/grants/RPC/storage/realtime checks passed. Anonymous bucket list returned HTTP 200 with body `[]` and exposed no object names. Actual anonymous object access against a real QA attachment remains BLOCKED because no authenticated attachment could be created. |

Phase 6B security follow-up:

| Check | Status | Evidence |
| --- | --- | --- |
| RLS on all Work Chat tables | PASS | RLS remains enabled for channels, messages, mentions, reads, attachments, and prepared attachments. |
| Authenticated browser has no direct writes | PASS | `authenticated` has SELECT only on Work Chat tables; write grants remain service-role only. |
| Service-role-only Work Chat RPCs | PASS | `work_chat_send_message` and `work_chat_mark_read` EXECUTE grants remain service-role only. |
| Private `work-chat-files` bucket | PASS | Bucket is private with 10 MB file size limit and expected allowed MIME types. |
| Messages and mentions in Realtime publication | PASS | `work_chat_messages` and `work_chat_mentions` remain in `supabase_realtime`. |
| Anonymous Work Chat API access | PASS | Anonymous `/api/work-chat/bootstrap` returned HTTP 401. |
| Anonymous direct chat table read | PASS | Anonymous `work_chat_messages` REST SELECT returned HTTP 401/permission denied. |
| Anonymous bucket list probe | PASS | `storage/v1/object/list/work-chat-files` returned HTTP 200 with body `[]`; no object names or storage paths were exposed. |
| Anonymous object access against real QA attachment | BLOCKED | No real QA attachment exists and authenticated attachment creation was blocked by missing sessions. |

Phase 6B automated regression rerun:

| Command | Status |
| --- | --- |
| `npm.cmd run build` | PASS |
| `node .\scripts\test-work-chat-mvp.mjs` | PASS |
| `node .\scripts\test-overview-dashboard.mjs` | PASS |
| `node .\scripts\test-workboard-ui.mjs` | PASS |
| `node .\scripts\test-my-tasks-ui.mjs` | PASS |
| `node .\scripts\test-task-api.mjs` | PASS |
| `node .\scripts\test-task-service.mjs` | PASS |
| `node .\scripts\test-task-dispatch.mjs` | PASS |
| `node .\scripts\test-task-gateway-http.mjs` | PASS |
| `node .\scripts\test-workboard-http.mjs` | PASS |
| `node .\scripts\test-my-tasks-http.mjs` | PASS |
| `node .\scripts\test-workboard-browser.mjs` | PASS |
| `node .\scripts\test-my-tasks-browser.mjs` | PASS |
| `git diff --check` | PASS |

Phase 6B screenshots path:

| Script | Path |
| --- | --- |
| Workboard browser QA | `C:\tmp\trry-admin-staging\qa-screens\phase-11-workboard` |
| My Tasks browser QA | `C:\tmp\trry-admin-staging\qa-screens\phase-10-1-my-tasks` |

Phase 6B defects found and fixes:

| Item | Status | Notes |
| --- | --- | --- |
| Application defects found | NOT APPLICABLE | No reproducible app defect could be confirmed because credentialed live QA was blocked before feature interaction. |
| Code fixes | NOT APPLICABLE | No code changes were made. |
| Documentation update | PASS | This Phase 6B addendum records the fresh deployment, role/session blocker, automated test rerun, and security follow-up. |

Phase 6B production-readiness recommendation: NOT APPROVED FOR PHASE 7

Reason: critical credentialed QA remains BLOCKED. The Phase 6B premise says authenticated Owner/Admin/Staff sessions are prepared, but from this Codex environment no prepared browser tabs are available, the only browser profile is logged out, and staging `public.admin_users` contains no Admin or Staff rows. Production remained untouched.

## Environment

| Item | Result |
| --- | --- |
| Starting commit | `d661e5278d5d8cfb2518069fd222530465491078` |
| Final tested app commit | `d661e5278d5d8cfb2518069fd222530465491078` |
| Branch | `staging` |
| Vercel project | `adminportal-staging` |
| Staging Vercel deployment ID | `dpl_Ff7sS62pNqimhyBjoAkyb6eAnj5m` |
| Staging Vercel URL | `https://adminportal-staging.vercel.app` |
| Staging Supabase project | `trry-admin-staging` |
| Staging Supabase ref | `fszkypwovpdthqfobxrk` |
| Production Supabase access | NOT APPLICABLE - not accessed |
| Production deployment | NOT APPLICABLE - not deployed |

## Account Setup

| Test | Status | Notes |
| --- | --- | --- |
| Confirm active synthetic Owner account in Supabase Auth and `public.admin_users` | PASS | Existing staging Owner `clarkylubguban+trry-admin-staging@gmail.com` exists in Auth and `admin_users`, is email-confirmed, active, and marked by email/display name as staging. |
| Confirm active synthetic Staff account in Supabase Auth and `public.admin_users` | BLOCKED | No Staff row exists in `public.admin_users`. Direct Auth user insert and Auth password update were rejected by the Supabase connector. Public signup to create synthetic accounts returned HTTP 429 rate limit. |
| Create missing staging Staff account safely | BLOCKED | Requires a usable Owner session through the app invite flow, Supabase Auth Admin API access, or signup rate-limit reset. No production credentials were copied or used. |
| Do not print passwords/tokens | PASS | No passwords or tokens are recorded in this report. |

Confirmed active Admin Portal rows at checkpoint time:

| Email | Role | Active | Auth row |
| --- | --- | --- | --- |
| `clarkylubguban@gmail.com` | owner | true | present |
| `clarkylubguban+trry-admin-staging@gmail.com` | owner | true | present |

## Work Chat Two-Session QA

| Test | Status | Notes |
| --- | --- | --- |
| Owner opens Work Chat in authenticated browser session | BLOCKED | No usable synthetic Owner credentials/session available to automation. |
| Staff opens Work Chat in separate authenticated browser session | BLOCKED | No usable synthetic Staff account exists. |
| Owner sends GENERAL text message | BLOCKED | Requires authenticated two-session setup. |
| Staff receives message through Realtime without refresh | BLOCKED | Requires authenticated two-session setup. |
| Message appears exactly once for Staff | BLOCKED | Requires authenticated two-session setup. |
| Staff sends reply | BLOCKED | Requires authenticated two-session setup. |
| Owner receives reply exactly once | BLOCKED | Requires authenticated two-session setup. |

## Realtime Results

| Test | Status | Notes |
| --- | --- | --- |
| Browser Realtime message delivery | BLOCKED | Credentialed two-session browser QA could not run. |
| Realtime publication includes `work_chat_messages` | PASS | `public.work_chat_messages` is in `supabase_realtime`. |
| Realtime publication includes `work_chat_mentions` | PASS | `public.work_chat_mentions` is in `supabase_realtime`. |

## Unread Results

| Test | Status | Notes |
| --- | --- | --- |
| Staff global unread increments after Owner sends while Staff is on FRONT DESK | BLOCKED | Requires authenticated two-session setup. |
| GENERAL unread increments | BLOCKED | Requires authenticated two-session setup. |
| Staff own sent messages do not increment Staff unread | BLOCKED | Requires authenticated two-session setup. |
| Opening GENERAL marks only visible messages read | BLOCKED | Requires authenticated two-session setup. |
| Later message remains unread until opened | BLOCKED | Requires authenticated two-session setup. |

## Mention Results

| Test | Status | Notes |
| --- | --- | --- |
| Owner selects real Staff through mention suggestions | BLOCKED | No Staff account exists. |
| Staff Mentions badge increments | BLOCKED | Requires authenticated two-session setup. |
| Mentions view shows sender, timestamp, channel, excerpt | BLOCKED | Requires authenticated two-session setup. |
| Opening source message updates mention/read state | BLOCKED | Requires authenticated two-session setup. |
| Owner cannot read/mark Staff-only mention rows as Staff | BLOCKED | Requires Staff account/session. |

## Attachment Results

| Test | Status | Notes |
| --- | --- | --- |
| JPG or PNG upload succeeds and sends | BLOCKED | Requires authenticated Work Chat session. |
| PDF upload succeeds and sends | BLOCKED | Requires authenticated Work Chat session. |
| File metadata is displayed | BLOCKED | Requires authenticated Work Chat session. |
| Active Owner/Staff can open through signed URL | BLOCKED | Requires authenticated Work Chat sessions. |
| Anonymous private file access fails | BLOCKED | No private QA file could be created without authenticated upload. |
| Storage path is not displayed publicly | BLOCKED | Requires sent attachment UI/API result. |
| HTML/SVG/executable/empty/>10 MB rejected | BLOCKED | Requires authenticated attachment prepare endpoint. Static API code enforces MIME and size limits, but live credentialed rejection testing was blocked. |

## Order-Thread Results

| Test | Status | Notes |
| --- | --- | --- |
| Open valid staging TRRY order | BLOCKED | Requires authenticated Admin Portal session. |
| OPEN ORDER THREAD opens Work Chat drawer | BLOCKED | Requires authenticated Admin Portal session. |
| One ORDER channel is created | BLOCKED | Requires authenticated Work Chat order-thread API. |
| Reopening same order returns same channel/no duplicate | BLOCKED | Requires authenticated Work Chat order-thread API. |
| No order/payment/production field changes | BLOCKED | Credentialed order-thread action could not run. |
| No Odoo SO required | BLOCKED | Credentialed order-thread action could not run. Static API only requires `ops_inquiries.status = 'won'`. |

## Visual QA

| Area | Desktop | Tablet | 390px Mobile | Notes |
| --- | --- | --- | --- | --- |
| Overview | BLOCKED | BLOCKED | BLOCKED | Authenticated staging page unavailable. |
| Inquiries | BLOCKED | BLOCKED | BLOCKED | Authenticated staging page unavailable. |
| Orders | BLOCKED | BLOCKED | BLOCKED | Authenticated staging page unavailable. |
| Production | BLOCKED | BLOCKED | BLOCKED | Authenticated staging page unavailable. |
| Workboard | PASS | NOT APPLICABLE | PASS | Automated local browser QA passed and wrote screenshots to `qa-screens/phase-11-workboard`. |
| My Tasks | PASS | NOT APPLICABLE | PASS | Automated local browser QA passed and wrote screenshots to `qa-screens/phase-10-1-my-tasks`. |
| Calendar | BLOCKED | BLOCKED | BLOCKED | Authenticated staging page unavailable. |
| Settings / Staff Access | BLOCKED | BLOCKED | BLOCKED | Authenticated staging page unavailable. |
| Inquiry drawer | BLOCKED | BLOCKED | BLOCKED | Authenticated staging page unavailable. |
| Order drawer | BLOCKED | BLOCKED | BLOCKED | Authenticated staging page unavailable. |
| Task drawer | PASS | NOT APPLICABLE | PASS | Covered by Workboard/My Tasks browser scripts. |
| Work Chat | BLOCKED | BLOCKED | BLOCKED | Requires authenticated staging Work Chat session. |

Visual checklist:

| Test | Status | Notes |
| --- | --- | --- |
| No page-level horizontal overflow | BLOCKED | Full authenticated staging sweep blocked. Local Workboard/My Tasks scripts passed. |
| No drawer horizontal overflow | BLOCKED | Full authenticated staging sweep blocked. |
| No clipped labels | BLOCKED | Full authenticated staging sweep blocked. |
| No sticky-footer overlap | BLOCKED | Full authenticated staging sweep blocked. |
| Work Chat desktop drawer approximately 360-400px | PASS | Static Work Chat verification asserts `width: min(400px, 100vw)`. Live visual blocked. |
| Work Chat mobile usable full-screen sheet | BLOCKED | Requires authenticated mobile Work Chat session. |
| Composer remains usable | BLOCKED | Requires authenticated Work Chat session. |
| Attachments removable before sending | BLOCKED | Requires authenticated Work Chat session. |
| Close/back controls remain visible | BLOCKED | Requires authenticated Work Chat session. |
| Floating launcher does not block primary page actions | BLOCKED | Requires authenticated staging sweep. |

## Workflow QA

| Test | Status | Notes |
| --- | --- | --- |
| Quote badges match actual inquiry state | BLOCKED | Requires authenticated staging data/UI inspection. |
| Owner assignment saves | BLOCKED | Requires authenticated staging session. |
| Follow-up scheduling saves | BLOCKED | Requires authenticated staging session. |
| Clear follow-up works | BLOCKED | Requires authenticated staging session. |
| Follow-up event note saves | BLOCKED | Requires authenticated staging session. |
| Notes and History display saved events | BLOCKED | Requires authenticated staging session. |
| Customer cannot see internal follow-up notes | BLOCKED | Requires customer portal/session check. |
| Workboard columns exactly TO DO / IN PROGRESS / COMPLETED | PASS | `test-workboard-ui.mjs` and `test-workboard-browser.mjs` passed. |
| FOR_REVIEW appears as WAITING FOR REVIEW inside IN PROGRESS | PASS | Covered by Workboard UI/browser scripts. |
| NEEDS_REVISION appears inside IN PROGRESS | PASS | Covered by Workboard UI/browser scripts. |
| DONE only appears in COMPLETED | PASS | Covered by Workboard UI/browser scripts. |
| Drafts and Cancelled remain supporting views | PASS | Covered by Workboard UI scripts. |
| Task actions still use protected commands | PASS | Covered by task API/service/dispatch/gateway scripts. |
| Monthly chart uses actual `createdAt` | PASS | `test-overview-dashboard.mjs` passed. |
| Recent inquiries use actual creation order | PASS | `test-overview-dashboard.mjs` passed. |
| Phase 2 quote badges remain consistent | PASS | `test-overview-dashboard.mjs` passed. |
| Task load errors do not break Overview | PASS | `test-overview-dashboard.mjs` passed. |
| Orders page loads | BLOCKED | Requires authenticated staging session. |
| Production page loads | BLOCKED | Requires authenticated staging session. |
| Order thread does not alter workflow | BLOCKED | Requires authenticated order-thread action. |
| Existing payment and production rules unchanged | PASS | No code/schema changes were made during QA; automated task/overview regressions passed. |

## Permission QA

| Actor | Status | Notes |
| --- | --- | --- |
| Owner full permitted Admin visibility | BLOCKED | Requires usable Owner login/session. |
| Admin existing scope preserved | BLOCKED | No Admin test account/session available. |
| Staff My Tasks only for assignments | BLOCKED | No Staff account/session available. |
| Staff Work Chat access allowed | BLOCKED | No Staff account/session available. |
| Staff no manager-only task data/actions | PASS | Automated task API/service projection tests passed. Live Staff UI blocked. |
| Staff no customer access | BLOCKED | No Staff account/session available. |
| Disabled user cannot use Admin or Work Chat | BLOCKED | No synthetic Staff account available to disable/re-auth. |
| Anonymous/customer cannot read chat tables | PASS | Anonymous REST `work_chat_messages` SELECT and INSERT returned HTTP 401. |
| Anonymous/customer cannot call Work Chat APIs | PASS | Anonymous `/api/work-chat/bootstrap` returned HTTP 401. |
| Anonymous/customer cannot access private files | BLOCKED | No private QA attachment could be created for direct URL testing. Bucket is private and no work-chat storage policy exists. |
| Customer WebApp has no Work Chat UI/data | BLOCKED | Customer portal QA not run in this worktree/session. |

## Security Checks

| Check | Status | Evidence |
| --- | --- | --- |
| Work Chat tables have RLS enabled | PASS | RLS enabled on channels, messages, mentions, reads, attachments, and prepared attachments. |
| Policies match active Owner/Admin/Staff access | PASS | Work Chat SELECT policies require `work_chat_active_admin_user(auth.uid())`; mentions/read/prepared rows are user-scoped. |
| Authenticated browser users have no direct chat-table writes | PASS | `authenticated` has SELECT only; INSERT/UPDATE/DELETE grants are service-role only. |
| Message/read writes go through server APIs/RPC | PASS | API uses `work_chat_send_message` and `work_chat_mark_read`; authenticated role has no table-write grants. |
| `work_chat_send_message` is service-role only | PASS | Function EXECUTE grant only to `service_role`. |
| `work_chat_mark_read` is service-role only | PASS | Function EXECUTE grant only to `service_role`. |
| Bucket is private | PASS | `storage.buckets.public = false` for `work-chat-files`. |
| Realtime publication includes messages and mentions | PASS | Both tables are in `supabase_realtime`. |
| No public listing policy exists for `work-chat-files` | PASS | No `storage.objects` policy targets `work-chat-files`; existing storage policies are for `catalog-images` only. |
| Pending payment migration remains untouched | PASS | No migration files were modified during Phase 6 QA. |

Storage note: anonymous `storage/v1/object/list/work-chat-files` returned HTTP 200 during probing, but direct database policy inspection shows no `work-chat-files` public listing policy and the bucket is private. The bucket had no QA objects because attachment upload was blocked by missing authenticated accounts.

## Final Row Counts

| Table | Row count |
| --- | ---: |
| `work_chat_channels` | 3 |
| `work_chat_messages` | 0 |
| `work_chat_mentions` | 0 |
| `work_chat_channel_reads` | 0 |
| `work_chat_attachments` | 0 |
| `work_chat_prepared_attachments` | 0 |

Synthetic QA records: none were created in Work Chat tables because authenticated two-session QA was blocked before message/attachment/order-thread actions could run.

## Automated Regression

| Command | Status | Result |
| --- | --- | --- |
| `npm.cmd run build` | PASS | Build validation passed; static build created in `dist`. |
| `node --check` for changed JS/API files | NOT APPLICABLE | No JS/API files changed during this QA phase. |
| `node .\scripts\test-work-chat-mvp.mjs` | PASS | Work Chat MVP static verification passed. |
| `node .\scripts\test-overview-dashboard.mjs` | PASS | Overview dashboard fixtures passed. |
| `node .\scripts\test-workboard-ui.mjs` | PASS | Workboard frontend contracts passed. |
| `node .\scripts\test-my-tasks-ui.mjs` | PASS | My Tasks frontend contracts passed. |
| `node .\scripts\test-task-api.mjs` | PASS | 18 task API suites passed. |
| `node .\scripts\test-task-service.mjs` | PASS | Task service tests passed. |
| `node .\scripts\test-task-dispatch.mjs` | PASS | 18 task URLs preserved with safe 404/405 responses. |
| `node .\scripts\test-task-gateway-http.mjs` | PASS | 19 local HTTP task gateway URLs preserved. |
| `node .\scripts\test-workboard-http.mjs` | PASS | Workboard local HTTP route and hidden manager task API dispatch passed. |
| `node .\scripts\test-my-tasks-http.mjs` | PASS | My Tasks local HTTP route and hidden task API dispatch passed. |
| `node .\scripts\test-workboard-browser.mjs` | PASS | Desktop/mobile Workboard browser QA passed. |
| `node .\scripts\test-my-tasks-browser.mjs` | PASS | Desktop/mobile My Tasks browser QA passed. |
| `git diff --check` | PASS | No whitespace errors. |

## Defects Found and Fixes

No application code defects were fixed in this QA pass.

Operational blockers found:

| Blocker | Status | Notes |
| --- | --- | --- |
| Missing usable synthetic Staff account | BLOCKED | No Staff exists in `admin_users`; Auth creation through public signup is rate-limited and direct Auth insertion is disallowed by connector guardrails. |
| Missing usable synthetic Owner credentials/session | BLOCKED | Existing Owner rows are present, but no usable password/session was available to automation; Auth password update is disallowed by connector guardrails. |

## Remaining Blockers

| Item | Status | Required before approval |
| --- | --- | --- |
| Create/confirm usable synthetic Owner and Staff credentials in staging only | BLOCKED | Use Supabase Auth Admin API/dashboard or existing Owner invite flow. |
| Run authenticated Owner/Staff Work Chat two-session QA | BLOCKED | Requires the accounts above. |
| Run live Work Chat unread, mention, attachment, order-thread, disabled-user QA | BLOCKED | Requires the accounts above. |
| Run full authenticated visual QA across all requested pages/drawers/viewports | BLOCKED | Requires the accounts above. |
| Run live workflow and permission QA for Owner/Admin/Staff/customer/disabled actors | BLOCKED | Requires the accounts above and customer/admin sessions where applicable. |

## Production-Readiness Recommendation

NOT APPROVED FOR PHASE 7

Reason: critical authenticated staging QA items are BLOCKED. Automated regression and database security metadata are passing, but Phase 6 cannot be approved until the synthetic account blocker is resolved and the live two-session Work Chat, permissions, attachment, order-thread, disabled-user, visual, and workflow checks are completed.
