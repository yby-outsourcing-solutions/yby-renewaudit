-- ============================================================================
-- YBY RenewAudit — Authoritative Production Database Migration (v2.0)
-- Target Project: yby-renewaudit-db (Mumbai ap-south-1)
-- Standards: PCI-DSS SAQ A, SOC 2 Type II Isolation, Least Privilege RLS
-- ============================================================================

BEGIN;

-- 1. Recurring Subscriptions Table
-- Parent entity for automated monthly / annual recurring billing
CREATE TABLE IF NOT EXISTS public.subscriptions (
    subscription_id VARCHAR(64) PRIMARY KEY,       -- Razorpay sub_xxxx
    customer_id VARCHAR(64),                        -- Razorpay cust_xxxx
    customer_email VARCHAR(255) NOT NULL,
    plan_type VARCHAR(32) NOT NULL,                -- PROFESSIONAL_MONTHLY, ANNUAL_PROFESSIONAL
    status VARCHAR(32) NOT NULL DEFAULT 'created', -- created, authenticated, active, pending, halted, cancelled, completed
    current_cycle_start TIMESTAMPTZ,
    current_cycle_end TIMESTAMPTZ,
    charge_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Authoritative Licenses Table
-- Authoritative commercial registry; zero contract, PII or findings stored here
CREATE TABLE IF NOT EXISTS public.licenses (
    license_key VARCHAR(32) PRIMARY KEY,           -- YBY-SINGLE-XXXX-XXXX / YBY-PRO-XXXX-XXXX
    plan_type VARCHAR(32) NOT NULL,                -- FREE_FIRST_AUDIT, SINGLE_AUDIT, PROFESSIONAL_MONTHLY, ANNUAL_PROFESSIONAL
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',  -- ACTIVE, EXPIRED, QUOTA_EXHAUSTED, SINGLE_AUDIT_ALREADY_CONSUMED, SUSPENDED
    audits_allowed INT NOT NULL,
    audits_used INT NOT NULL DEFAULT 0,
    audits_reserved INT NOT NULL DEFAULT 0,
    max_devices INT NOT NULL DEFAULT 1,
    bound_device_hash VARCHAR(64),                 -- SHA-256 fingerprint bound on first activation
    subscription_id VARCHAR(64) REFERENCES public.subscriptions(subscription_id) ON DELETE SET NULL,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT chk_quota_ceiling CHECK (audits_used + audits_reserved <= audits_allowed),
    CONSTRAINT chk_quota_positive CHECK (audits_used >= 0 AND audits_reserved >= 0)
);

-- 3. Commercial Orders Table
-- Tracks one-time purchases and ties checkout claim secrets to provisioned licenses
CREATE TABLE IF NOT EXISTS public.orders (
    order_id VARCHAR(64) PRIMARY KEY,              -- Razorpay order_xxxx
    receipt_id VARCHAR(64) NOT NULL UNIQUE,        -- Internal rcpt_xxxx
    plan_type VARCHAR(32) NOT NULL,
    amount_inr_paise INT NOT NULL,                 -- Exactly 299900 (₹2,999) for Single Audit
    currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    status VARCHAR(32) NOT NULL DEFAULT 'created', -- created, paid, failed, expired
    customer_email VARCHAR(255),
    claim_token_hash CHAR(64) NOT NULL,            -- SHA-256 hash of 256-bit unguessable fulfillment secret
    license_key VARCHAR(32) REFERENCES public.licenses(license_key) ON DELETE SET NULL,
    payment_id VARCHAR(64),
    fulfilled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Immutable Payment Events Ledger
-- Strict idempotency & replay protection; prevents double-crediting
CREATE TABLE IF NOT EXISTS public.payment_events (
    event_id VARCHAR(64) PRIMARY KEY,              -- Razorpay evt_xxxx
    event_type VARCHAR(64) NOT NULL,               -- order.paid, payment.captured, subscription.charged
    payment_id VARCHAR(64),
    order_id VARCHAR(64) REFERENCES public.orders(order_id) ON DELETE SET NULL,
    subscription_id VARCHAR(64) REFERENCES public.subscriptions(subscription_id) ON DELETE SET NULL,
    license_key VARCHAR(32) REFERENCES public.licenses(license_key) ON DELETE SET NULL,
    amount_inr_paise INT,
    currency VARCHAR(3) DEFAULT 'INR',
    payload_hash CHAR(64) NOT NULL,                -- SHA-256 of raw webhook body
    processed_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Quota Leases Table
-- Governs Gate 0 15-minute lease lifecycle: AVAILABLE -> ACTIVE -> COMMITTED / RELEASED / EXPIRED
CREATE TABLE IF NOT EXISTS public.quota_leases (
    reservation_id VARCHAR(64) PRIMARY KEY,        -- Cryptographically random: RES-<uuidv4>
    license_key VARCHAR(32) NOT NULL REFERENCES public.licenses(license_key) ON DELETE CASCADE,
    device_hash VARCHAR(64) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',  -- ACTIVE, COMMITTED, RELEASED, EXPIRED
    lease_expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    CONSTRAINT chk_lease_status CHECK (status IN ('ACTIVE', 'COMMITTED', 'RELEASED', 'EXPIRED'))
);

-- 6. Performance & Integrity Indexes
CREATE INDEX IF NOT EXISTS idx_licenses_subscription ON public.licenses(subscription_id);
CREATE INDEX IF NOT EXISTS idx_licenses_device ON public.licenses(bound_device_hash);
CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_claim_hash ON public.orders(claim_token_hash);
CREATE INDEX IF NOT EXISTS idx_quota_leases_lookup ON public.quota_leases(reservation_id, license_key, device_hash, status);
CREATE INDEX IF NOT EXISTS idx_quota_leases_expiry ON public.quota_leases(lease_expires_at);

-- 7. LEAST PRIVILEGE: Enable Row-Level Security (RLS) on all 5 tables
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.licenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quota_leases ENABLE ROW LEVEL SECURITY;

-- 8. ZERO PUBLIC / ANON GRANTS
-- Strictly revoke all permissions from public/anon/authenticated roles
-- Web clients cannot query or modify these tables via the Supabase REST/PostgREST endpoint
REVOKE ALL ON TABLE public.subscriptions FROM anon, authenticated;
REVOKE ALL ON TABLE public.licenses FROM anon, authenticated;
REVOKE ALL ON TABLE public.orders FROM anon, authenticated;
REVOKE ALL ON TABLE public.payment_events FROM anon, authenticated;
REVOKE ALL ON TABLE public.quota_leases FROM anon, authenticated;

COMMIT;
