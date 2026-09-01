# OS-BASELINE-1A Main-Only Commit Audit

Date: 2026-08-30

Comparison:

- Production authority: `origin/codex/mcvg1-grouped-sidebar-reconcile` at `aa483f0cc053d37dfa1fe86ca9cafdf7478aa7ee`
- Old GitHub main: `origin/main` at `ca170a1c74615f9c1683bccfd26bded24f08c41d`
- Merge base: `1585ec333df72c8f1553e9ae5eaaae035c219e80`
- Main-only count: 53
- Production-only count: 108

## Classification Table

| # | SHA | Subject | Affected subsystem | Classification | Evidence / reason | Intended reconciliation action |
|---:|---|---|---|---|---|---|
| 1 | `f94484e55e219b788d797e413346f900eb4ce98c` | Clean inquiry drawer follow-up UI | Inquiries UI | `SUPERSEDED` | Production branch contains later inquiry drawer simplification, native-order handoff, production/QC drawer, and grouped-sidebar UI work. | Do not replay patch; retain production UI authority. |
| 2 | `bd5db676c7f941bfc94b5443a75865c43835057a` | Recover latest admin UI baseline | Inquiries/payments/tasks UI and API | `CONFLICTING` | Adds old `api/inquiries/[id]/payments.js` and payment workflow migration while production has newer native order/payment architecture and E5/EAN8/catalog work. | Cherry-pick no files; mine only for manual payment evidence if future regression appears. |
| 3 | `3406da7b197a0ef10243b573f965c241071f34bb` | Complete inquiry follow-up recording flow | Inquiry follow-ups | `SUPERSEDED` | Follow-up events exist in recovered migration history and later production inquiry flow is authoritative. | No replay. |
| 4 | `38763e8b74fb9da13dd706e639b81e071b4e885b` | Document Phase 0 staging checkpoint | Documentation | `OBSOLETE` | Historical staging checkpoint for old lineage. | Do not carry into baseline except through this audit. |
| 5 | `e28ddf6e79efb6c3b8037b7112653ab3bc9f7cd8` | Polish admin foundation and inquiry drawer | Inquiries UI | `SUPERSEDED` | Later production branch rebuilt the canonical shell/sidebar and inquiry surfaces. | No replay. |
| 6 | `fc14c6f2a6b2fd8839a1250da6aa4ac8e09be4c2` | Unify quote status badges | Inquiries UI | `SUPERSEDED` | Later production inquiry/native order status authority supersedes badge-only polish. | No replay. |
| 7 | `facbc8e91d70b67fbfe129a59bc2b3a67090a50f` | Simplify Workboard Kanban | Tasks/Workboard | `SUPERSEDED` | Production branch contains Phase 8 task domain and grouped sidebar reconciliation. | No replay. |
| 8 | `05d13d99526a4e51f7b3000962685c70fff0321b` | Build professional Overview dashboard | Overview UI | `SUPERSEDED` | Production branch contains later dashboard and module navigation density changes. | No replay. |
| 9 | `446074ce8d081fcfad8b6b4c36ef64002411719c` | Add secure Work Chat foundation | Work Chat | `CONFLICTING` | Main adds Work Chat API, schema, and route rewrites; production baseline has current Facebook Inbox architecture instead. | Park Work Chat; do not merge into OS-BASELINE-1. |
| 10 | `d661e5278d5d8cfb2518069fd222530465491078` | Build Work Chat interface | Work Chat UI | `CONFLICTING` | Depends on Work Chat foundation that is outside current production Inbox authority. | Park with Work Chat. |
| 11 | `ddba7ce0f9802736d25f701ff481d16a7bdf5b5d` | Document Phase 6 staging QA | Documentation | `OBSOLETE` | Old QA artifact for unpromoted lineage. | Do not replay. |
| 12 | `f14922bab18bc372141bb5c8f9d2f30cd8c9beec` | Complete Phase 6 credentialed QA | Documentation | `OBSOLETE` | Old QA artifact. | Do not replay. |
| 13 | `1dcc0647f838521622743fb5e75a9caf0e31461a` | Document Phase 6C credentialed QA blocker | Documentation | `OBSOLETE` | Old blocker note superseded by production acceptance. | Do not replay. |
| 14 | `d0a3861963c47bf4bcf42ba00691a8cc55ad8ccb` | Complete programmatic Phase 6 QA | Documentation | `OBSOLETE` | Old QA artifact. | Do not replay. |
| 15 | `0b89693650438f25a69dc6a4e8468093dc2ad2ea` | Document Phase 6E credentialed QA blockers | Documentation | `OBSOLETE` | Old QA artifact. | Do not replay. |
| 16 | `b2086e45066781c462ef2fb707b51ede42922116` | Complete Phase 6 authenticated staging QA | Documentation | `OBSOLETE` | Old QA artifact. | Do not replay. |
| 17 | `218079f38c01a1a0cbde2b4633f7c0765a9038b3` | Prepare Phase 7 production release | Payment/inquiry release prep | `OBSOLETE` | Release prep for old main lineage; production has newer deployed lineage. | Do not replay. |
| 18 | `9f72707b6ee0819fe2de99fac6cb244a5193ce8c` | Remove Odoo dependency before production release | Odoo removal | `SUPERSEDED` | Production branch later explicitly removes active Odoo order authority and preserves native order authority. | Do not replay; preserve production no-Odoo behavior. |
| 19 | `c31da4a153c9cdeb76e2dff8f053b04ac2d16b63` | Fix Work Chat launcher binding | Work Chat UI | `CONFLICTING` | Depends on parked Work Chat. | Park. |
| 20 | `b5d10ec85a691052032e22abedcba805bd402d1b` | Document Phase 7D.1 hotfix smoke | Documentation | `OBSOLETE` | Old smoke note. | Do not replay. |
| 21 | `1ef7c174f008bb56f577fef522473e9d5d070df9` | Document Phase 7E production acceptance blocker | Documentation | `OBSOLETE` | Old blocker note. | Do not replay. |
| 22 | `8378be49a2307b136e96966aba5039ccc9708fc4` | Document Phase 7E credential blocker | Documentation | `OBSOLETE` | Old blocker note. | Do not replay. |
| 23 | `c2ade33d4fad7e070cf8988fda4d34fa41734689` | Document Phase 7E production acceptance blockers | Documentation | `OBSOLETE` | Old blocker note. | Do not replay. |
| 24 | `52099c1b1891219b842b154512eae766762ad3a3` | Prepare production task domain enablement | Task domain migration | `SUPERSEDED` | Production branch contains newer Phase 8 task-domain migrations and direct revoke of `task_domain_enabled()`. | Do not replay old enablement. |
| 25 | `83c1b29f9f0c8b1612312129bfda259abde3e454` | Complete Phase 7 production acceptance | Documentation | `OBSOLETE` | Old acceptance artifact. | Do not replay. |
| 26 | `993e3013c685d2f9f4854c3f9bb9517437a9b24b` | Build Pay at Shop admin workflow | Pay-at-Shop | `SUPERSEDED` | Production current payment flow and native order guards supersede this old workflow. | Do not replay; preserve current payment flow. |
| 27 | `1ea8f1651ab93293f80fabab380c9ad3fb37f9db` | Load Pay at Shop history in inquiry drawers | Pay-at-Shop UI | `SUPERSEDED` | Old drawer/history behavior superseded by production inquiry/payment flow. | Do not replay. |
| 28 | `cbe87ac7cc971264d8317498eafd9ce441a1bd42` | Separate shop and online payment schema readiness | Payment schema readiness | `SUPERSEDED` | Production has later payment confirmation/readiness handling and native payment guard. | Do not replay. |
| 29 | `5212a5e893565ef553c6c89c60c910c85196d929` | Show Pay at Shop in inquiry details | Pay-at-Shop UI | `SUPERSEDED` | Current production payment UI is authoritative. | Do not replay. |
| 30 | `48f18050a43156bf0ac7276381c091929f97b58f` | Center shop payment confirmation overlay | Payment UI | `SUPERSEDED` | Old overlay polish superseded by production payment/inquiry UI. | Do not replay. |
| 31 | `d9047658f8b04bd406e020f04a82fb4b43031115` | Document Phase 8A staging QA | Documentation | `OBSOLETE` | Old QA artifact. | Do not replay. |
| 32 | `8d71713111c1f4434af6af3a8c53b00d2e77017e` | Prepare Pay at Shop production release | Documentation | `OBSOLETE` | Old release prep. | Do not replay. |
| 33 | `a3f474ff80340127a669641195fa0b15674bcb94` | Document Phase 8C credential blocker | Documentation | `OBSOLETE` | Old blocker note. | Do not replay. |
| 34 | `9c923a154a29e42bdc5144f882a790f9758b12f0` | Document Phase 8C QA account blocker | Documentation | `OBSOLETE` | Old blocker note. | Do not replay. |
| 35 | `3c70215d0a8281ed45bb7b75ef3ce8fa8e174dad` | Complete Phase 8C production release | Documentation | `OBSOLETE` | Old production-release note not canonical. | Do not replay. |
| 36 | `d81f19475a1ce0dc07c6341e1ea7b1ba2c5add45` | Build Order Details drawer | Order drawer | `CONFLICTING` | Adds legacy order-details API/UI while production branch has newer native Orders drawer/status authority. | Do not replay; manually compare only if a specific UX gap is reported. |
| 37 | `4b40dc84a0db195f73ea64791ced06386a9d901a` | Document Phase 8D.1 staging QA | Documentation | `OBSOLETE` | Old QA artifact. | Do not replay. |
| 38 | `78badbd0917e070270fd2f9ca199ef54e2188c47` | Build Production Job drawer | Production drawer | `CONFLICTING` | Adds old production-job API/UI that conflicts with current Production/QC drawer stack. | Do not replay. |
| 39 | `621cf1924e86a0658a9726f64abc6fb449d8eb2e` | Document Phase 8D.2 staging QA | Documentation | `OBSOLETE` | Old QA artifact. | Do not replay. |
| 40 | `f91d4657d66224b2f5f4685bf52bec982935a7f2` | Prepare drawer production release | Documentation | `OBSOLETE` | Old release prep. | Do not replay. |
| 41 | `a7da022fbc1a9d9e92c571f49462dcefd16dff95` | Fix Order Drawer production schema compatibility | Order drawer | `CONFLICTING` | Depends on old order-details drawer. | Do not replay. |
| 42 | `c61024c00fc4b8a3704cdfe4d04e2dde53f9f2c6` | Build online payment review workflow | Payment review | `CONFLICTING` | Adds separate payment-review API/UI; production branch has current native payment guard and payment confirmation flow. | Park; do not duplicate payment engine. |
| 43 | `406ed28b75807f422016577ea2eb671b6aaa9310` | Fix payment review stale version handling | Payment review | `CONFLICTING` | Depends on parked payment-review workflow. | Park. |
| 44 | `00121d900e678b8d95f9692009bff489b7e7caa8` | Support admin down payment confirmations | Payment confirmations | `SUPERSEDED` | Production contains down-payment/payment guard lineage and current flow. | Do not replay. |
| 45 | `1f7f5c65f1210c2b064b22590ba0c591a2fde5e2` | Finalize inquiry drawer payment UI | Payment UX | `SUPERSEDED` | Production current inquiry/payment UI is later authority. | Do not replay. |
| 46 | `d5f7161797b831ab9ba1fe0cb663e2d5bdbf2d24` | Fix inquiry drawer payment states and refresh | Payment UX | `SUPERSEDED` | Later production payment guard/read model supersedes state refresh behavior. | Do not replay. |
| 47 | `22bd31ba5764ee65ab16ea87054d7fb3d609cd64` | Deduplicate full payment drawer summary | Payment UX | `SUPERSEDED` | Production current UI is authority. | Do not replay. |
| 48 | `b4782542295371f22bfaf298bc1795ad39cfce1b` | Fix final inquiry drawer payment UI bugs | Payment UX | `SUPERSEDED` | Production current UI is authority. | Do not replay. |
| 49 | `1512f4aeae58ea8bc0ae629782f33dbfabd4d803` | Finalize Admin payment and inquiry table polish | Payment/Inquiries UI | `SUPERSEDED` | Production current UI is authority. | Do not replay. |
| 50 | `a2f80ca5cd44d1f658004f266450a6be0b9dce92` | Document Admin payment production release preparation | Documentation/scripts | `OBSOLETE` | Old release rehearsal documentation and script. | Do not replay. |
| 51 | `49b0233991109f3db868694c3b5cb741e050c628` | Fix receipt upload preparation compatibility | Receipt upload | `REQUIRED` | Addresses customer receipt upload compatibility; this is a narrow compatibility concern that should be preserved without reviving old payment-review engine. | Reconcile as documentation-backed requirement for the current payment flow; no code replay unless current flow lacks the compatibility. |
| 52 | `918f2180419efe596e997bb052234eabacc4ada1` | Align payment receipt eligibility with customer tracking | Receipt eligibility | `REQUIRED` | Related to receipt compatibility and eligibility; valid requirement independent of old UI shell. | Preserve as acceptance requirement for current payment flow. |
| 53 | `ca170a1c74615f9c1683bccfd26bded24f08c41d` | Clean up admin payment review section | Payment-review UX | `CONFLICTING` | Final polish on parked payment-review UI; not safe to replay over production payment architecture. | Park with payment-review lineage. |

## Reconciliation Summary

No main-only code patch should be directly replayed into OS-BASELINE-1. The only required main-only intent is receipt upload / receipt eligibility compatibility, and it must be reconciled against the production payment flow without introducing the old payment-review subsystem or duplicate order/payment engines.

## Receipt Compatibility Decision

Commits `49b0233991109f3db868694c3b5cb741e050c628` and `918f2180419efe596e997bb052234eabacc4ada1` contain valid receipt compatibility and customer-tracking eligibility intent. They are not replayed as code in OS-BASELINE-1A because their concrete implementation depends on the old main-only online payment-review route (`api/inquiries/[id]/payments.js`) and related UI.

The production baseline does not use that route. Its active authority is the current order-owned payment confirmation flow (`api/inquiries/[id]/payment-confirmations.js`, `api/_lib/paymentConfirmation.js`) and the native order/payment guard tests, which explicitly retain Messenger receipt review instead of in-app customer receipt upload. Reintroducing the main-only upload route would create a duplicate payment engine and conflict with production authority.

The preserved requirement is therefore: any future customer receipt upload phase must support the compatibility and eligibility intent from these two commits while being implemented against the current production payment-confirmation architecture, not by reviving the parked payment-review subsystem.
