alter table public.ops_inquiries
  add column if not exists quote_published_at timestamptz,
  add column if not exists payment_review_note text,
  add column if not exists payment_rejected_at timestamptz;

comment on column public.ops_inquiries.quote_published_at is
  'When the current quote was published for customer review.';
comment on column public.ops_inquiries.payment_review_note is
  'Internal staff note recorded while reviewing or returning a payment proof.';
comment on column public.ops_inquiries.payment_rejected_at is
  'When staff most recently requested a replacement payment proof.';;
