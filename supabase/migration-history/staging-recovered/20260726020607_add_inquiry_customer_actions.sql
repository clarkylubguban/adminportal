alter table public.ops_inquiries
  add column if not exists quoted_amount numeric,
  add column if not exists amount_due numeric,
  add column if not exists quote_status text,
  add column if not exists quote_approved_at timestamptz,
  add column if not exists quote_change_request text,
  add column if not exists quote_breakdown text,
  add column if not exists quote_notes text,
  add column if not exists quote_valid_until date,
  add column if not exists artwork_status text,
  add column if not exists artwork_url text,
  add column if not exists artwork_approved_at timestamptz,
  add column if not exists artwork_revision_request text,
  add column if not exists payment_status text,
  add column if not exists payment_label text,
  add column if not exists payment_instructions text,
  add column if not exists payment_proof_path text,
  add column if not exists payment_proof_submitted_at timestamptz,
  add column if not exists payment_confirmed_at timestamptz,
  add column if not exists payment_confirmed_amount numeric;

alter table public.ops_inquiries
  drop constraint if exists ops_inquiries_quoted_amount_check,
  drop constraint if exists ops_inquiries_amount_due_check,
  drop constraint if exists ops_inquiries_payment_confirmed_amount_check,
  drop constraint if exists ops_inquiries_quote_status_check,
  drop constraint if exists ops_inquiries_artwork_status_check,
  drop constraint if exists ops_inquiries_payment_status_check;

alter table public.ops_inquiries
  add constraint ops_inquiries_quoted_amount_check
    check (quoted_amount is null or quoted_amount >= 0),
  add constraint ops_inquiries_amount_due_check
    check (amount_due is null or amount_due >= 0),
  add constraint ops_inquiries_payment_confirmed_amount_check
    check (payment_confirmed_amount is null or payment_confirmed_amount >= 0),
  add constraint ops_inquiries_quote_status_check
    check (
      quote_status is null
      or quote_status in ('pending', 'ready', 'approved', 'changes_requested')
    ),
  add constraint ops_inquiries_artwork_status_check
    check (
      artwork_status is null
      or artwork_status in (
        'missing',
        'submitted',
        'under_review',
        'approval_required',
        'approved',
        'revision_requested'
      )
    ),
  add constraint ops_inquiries_payment_status_check
    check (
      payment_status is null
      or payment_status in (
        'not_required',
        'required',
        'proof_submitted',
        'under_review',
        'confirmed'
      )
    );

comment on column public.ops_inquiries.quote_status is
  'Customer quote sub-status. Does not replace the internal inquiry pipeline status.';
comment on column public.ops_inquiries.artwork_status is
  'Customer artwork-review sub-status. Does not authorize production by itself.';
comment on column public.ops_inquiries.payment_status is
  'Customer payment sub-status. Only authorized TRRY staff may set confirmed.';
comment on column public.ops_inquiries.artwork_url is
  'Private Storage path or customer-provided artwork link; never a public bucket URL.';
comment on column public.ops_inquiries.payment_proof_path is
  'Private Storage path for customer payment proof; never a public bucket URL.';;
