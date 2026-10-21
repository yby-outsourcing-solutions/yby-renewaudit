-- ============================================================================
-- YBY RenewAudit — Customer Feedback Ledger Migration (v1.0)
-- Target Project: jqwwpbupreecmdkvmtyc (Mumbai ap-south-1)
-- Standards: SOC 2 Type II Isolation, Least Privilege RLS, Zero Audit/PII Storage
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.feedbacks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rating SMALLINT NOT NULL,
    comment TEXT,
    consent_contact BOOLEAN NOT NULL DEFAULT false,
    contact_email VARCHAR(255),
    ip_hash CHAR(64) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),

    -- Mathematical Constraints & Integrity Invariants
    CONSTRAINT chk_rating_range CHECK (rating >= 1 AND rating <= 5),
    CONSTRAINT chk_comment_length CHECK (comment IS NULL OR char_length(comment) <= 1000),
    CONSTRAINT chk_email_requires_consent CHECK (
        (consent_contact = false AND contact_email IS NULL) OR
        (consent_contact = true AND contact_email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')
    )
);

-- Indexing for sliding-window rate limiting & chronologically ordered review
CREATE INDEX IF NOT EXISTS idx_feedbacks_ip_rate ON public.feedbacks(ip_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedbacks_created_at ON public.feedbacks(created_at DESC);

-- Enable Row-Level Security (Strict Default-Deny)
ALTER TABLE public.feedbacks ENABLE ROW LEVEL SECURITY;

-- Strictly revoke all direct access from public/anon/authenticated roles
-- Web clients cannot query or modify feedbacks via Supabase REST/PostgREST
REVOKE ALL ON TABLE public.feedbacks FROM anon, authenticated;

COMMIT;
