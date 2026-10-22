-- ============================================================================
-- YBY RenewAudit — Customer Feedback Ledger Schema Update (G7)
-- Target Project: jqwwpbupreecmdkvmtyc (Mumbai ap-south-1)
-- Migration: 20261021000001_feedback_contact_name_company.sql
-- Standards: SOC 2 Type II Privacy Isolation, Least Privilege RLS
-- Scope: Add optional contact_name and company_name with strict consent guard
-- ============================================================================

BEGIN;

-- 1. Idempotently add new contact fields as nullable columns
ALTER TABLE public.feedbacks
    ADD COLUMN IF NOT EXISTS contact_name VARCHAR(128),
    ADD COLUMN IF NOT EXISTS company_name VARCHAR(128);

-- 2. Verify and enforce consent_contact column invariants: NOT NULL + DEFAULT false
ALTER TABLE public.feedbacks
    ALTER COLUMN consent_contact SET NOT NULL,
    ALTER COLUMN consent_contact SET DEFAULT false;

-- 3. Orphan Remediation (Pre-flight Data Sanitation):
-- Ensures any historical or test row with consent_contact = false has zero contact PII
UPDATE public.feedbacks
SET contact_email = NULL,
    contact_name = NULL,
    company_name = NULL
WHERE consent_contact = false
  AND (contact_email IS NOT NULL OR contact_name IS NOT NULL OR company_name IS NOT NULL);

-- 4. Pattern-based legacy constraint retirement & idempotency cleanup
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT con.conname
        FROM pg_constraint con
        INNER JOIN pg_class rel ON rel.oid = con.conrelid
        INNER JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
        WHERE nsp.nspname = 'public'
          AND rel.relname = 'feedbacks'
          AND con.contype = 'c'
          AND con.conname IN (
              'chk_email_requires_consent',
              'chk_contact_info_requires_consent',
              'chk_contact_name_length',
              'chk_company_name_length'
          )
    ) LOOP
        EXECUTE 'ALTER TABLE public.feedbacks DROP CONSTRAINT ' || quote_ident(r.conname);
    END LOOP;
END $$;

-- Explicit drops for standard idempotency
ALTER TABLE public.feedbacks
    DROP CONSTRAINT IF EXISTS chk_email_requires_consent,
    DROP CONSTRAINT IF EXISTS chk_contact_info_requires_consent,
    DROP CONSTRAINT IF EXISTS chk_contact_name_length,
    DROP CONSTRAINT IF EXISTS chk_company_name_length;

-- 5. Add column-level integrity check constraints (non-empty trimmed text up to 128 chars)
ALTER TABLE public.feedbacks
    ADD CONSTRAINT chk_contact_name_length
        CHECK (contact_name IS NULL OR (char_length(trim(contact_name)) > 0 AND char_length(contact_name) <= 128)),
    ADD CONSTRAINT chk_company_name_length
        CHECK (company_name IS NULL OR (char_length(trim(company_name)) > 0 AND char_length(company_name) <= 128));

-- 6. Add unified contact info consent constraint
-- Invariants Enforced:
-- A. When consent_contact = false: All contact fields MUST be NULL (strict privacy guard).
-- B. When consent_contact = true: contact_email IS NOT NULL and matches valid email regex.
--    contact_name and company_name are optional enrichments.
ALTER TABLE public.feedbacks
    ADD CONSTRAINT chk_contact_info_requires_consent
        CHECK (
            (
                consent_contact = false AND
                contact_email IS NULL AND
                contact_name IS NULL AND
                company_name IS NULL
            ) OR (
                consent_contact = true AND
                contact_email IS NOT NULL AND
                contact_email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
            )
        );

COMMIT;
