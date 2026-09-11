# STLOLAB SW2 — Catalog and content

Date: 2026-09-11. Source implementation and bounded tests complete; deployed staging integration is not yet enabled or verified.

## Source identity

Repository: `clarkylubguban/adminportal`.
Worktree: `/workspace/scratch/f34feb0edc04/admin-stlolab-sw2`.
Branch: `codex/stlolab-sw2-catalog`.
Verified baseline: `2a7aa652b9e225c1418a0a17a1cfb028810ae2e6`, matching fetched origin/main and GitHub.
Target: STAGING ONLY. Production deployed: NO. Historical reference checkout remains unchanged.

## Changes

- Existing Master Catalog editor now owns STLOLAB collection, construction, care, model/size, fit-video and hero fields.
- Four chart templates: hoodie, shorts, regular tee and box tee. Each chart belongs to the specific product's `typed_config.stlolab.guide` and has an incrementing revision. This phase uses product-owned charts, not a new shared-guide registry. Reusing measurements across products requires verifying the same cut; automatic shared-guide assignment is not implemented.
- Measurement rows use actual variant sizes. Changing garment clears the draft chart; editing measurements removes confirmation. A chart cannot be confirmed with missing/invalid values. Unconfirmed numbers do not cross the catalog boundary.
- Existing material/GSM/fit fields are reused. Internal production notes and costs are excluded from the public response.
- Hero image, headline, description, button text and phone/desktop crop are independently editable. A featured product with a complete hero supplies the campaign; the button targets that product. If several qualify, product-code order resolves the first. Use one featured hero per release.
- New GET `/api/stlolab-catalog` endpoint supports exact product-code lookup and bounded pagination. It reads canonical products/variants/images using the existing server Supabase client and returns only approved storefront fields. Availability remains unknown, with no stock reservation or checkout.

## Staging configuration

Existing Vercel project verified: `adminportal-staging`, `prj_K0oDSa6r1MgAEpQMcl3mKVdJvtNI`, team `team_lLNAY28RJHud9QjW9vcIh7WO`. Existing domain: `adminportal-staging.vercel.app`.

Deploy this reviewed branch to the existing staging project, with its existing server credentials targeting `https://fszkypwovpdthqfobxrk.supabase.co`, then set server-only:

```dotenv
STLO_CATALOG_ENABLED=true
STLO_CATALOG_ENV=staging
```

The endpoint refuses every other database URL and all production modes. Do not use a production service key or alter the shared server factory to bypass this check. No Supabase schema/RLS changes, new projects or plan upgrades are required. No credentials or deployment settings were changed in this task.

The storefront consumes `https://adminportal-staging.vercel.app/api/stlolab-catalog` only after that deployment and endpoint have been verified. No server key is copied to the storefront.

Read-only staging check: 2 total products, **0 eligible STLOLAB products**. No products were relabeled, created or published. A live staging read is therefore expected to return an empty collection until real product data is prepared through the editor.

## Verification

- 10 catalog/content tests passed: eligibility, archived images/variants, private-field exclusion, centavo precision, guide confirmation and revision stability, hero safety, endpoint gating and error handling.
- Existing sales-channel validation: 24 assertions passed.
- Existing variant-reconciliation tests: 10 scenarios passed.
- Admin syntax and static build passed; generated tracked build files were restored to their baseline so the review contains source changes only.
- Producer → storefront decoder contract check passed using a synthetic product, without network writes.
- Source inspection confirmed staging columns and existing authenticated Admin RLS policies. No anonymous table grants were added.
- The editor UI has not been browser-tested in this phase; live endpoint-to-database runtime remains unverified until staging deployment/configuration.

## Release sequence

1. Review the Admin draft PR and deploy only to existing staging.
2. Configure the two flags and verify the endpoint returns the staging envelope and no private fields.
3. Prepare an owner-approved staging product, images and measured chart through the editor; test edit/save/reload and unpublish behavior.
4. Enable the separate V6 storefront's staging adapter, then verify the full read path.
5. Keep production and checkout gated for later phases. Update all Admin clients before authoring new storefront fields, since older editor bundles do not know those fields.

Supabase guidance consulted: https://supabase.com/docs/guides/database/postgres/row-level-security and https://supabase.com/changelog.md. The chosen boundary keeps service-role access server-side and preserves existing RLS/table grants.

The public catalog URL is rewritten through the existing assignment-users function to remain within the Hobby limit of 12 functions. Catalog dispatch returns only its allowlisted response; the admin assignment route retains authentication.
