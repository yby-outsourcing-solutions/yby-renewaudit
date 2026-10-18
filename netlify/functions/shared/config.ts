// netlify/functions/shared/config.ts - Production Server Configuration & Security Guards

export interface PlanPricing {
  planType: "SINGLE_AUDIT" | "PROFESSIONAL_MONTHLY" | "ANNUAL_PROFESSIONAL";
  amountPaise: number;
  auditsAllowed: number;
  isSubscription: boolean;
  cycleDays?: number;
}

export const AUTHORITATIVE_PLANS: Record<string, PlanPricing> = {
  SINGLE_AUDIT: {
    planType: "SINGLE_AUDIT",
    amountPaise: 299900, // ₹2,999
    auditsAllowed: 1,
    isSubscription: false
  },
  PROFESSIONAL_MONTHLY: {
    planType: "PROFESSIONAL_MONTHLY",
    amountPaise: 499900, // ₹4,999/mo
    auditsAllowed: 5,
    isSubscription: true,
    cycleDays: 30
  },
  ANNUAL_PROFESSIONAL: {
    planType: "ANNUAL_PROFESSIONAL",
    amountPaise: 4999000, // ₹49,990/yr
    auditsAllowed: 60,
    isSubscription: true,
    cycleDays: 365
  }
};

export function getServerConfig() {
  const env = process.env.RAZORPAY_ENV || "test";
  const keyId = process.env.RAZORPAY_KEY_ID?.trim().replace(/^["']|["']$/g, "");
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim().replace(/^["']|["']$/g, "");
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET?.trim().replace(/^["']|["']$/g, "");

  const isLiveKey = Boolean(keyId?.startsWith("rzp_live_"));
  const effectiveEnv = isLiveKey ? "live" : env;

  // Strict Test Mode Guard: Live mode requires explicit flag OR genuine rzp_live credentials
  if (effectiveEnv !== "test" && !process.env.ALLOW_LIVE_PAYMENTS && !isLiveKey) {
    throw new Error("SECURITY_GUARD: Live payment processing is disabled by policy. Set RAZORPAY_ENV=test or provide rzp_live credentials.");
  }

  if (!keyId || !keySecret) {
    throw new Error("Missing server Razorpay credentials: RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are required.");
  }

  if (effectiveEnv === "test" && !keyId.startsWith("rzp_test_") && !isLiveKey) {
    throw new Error("CONFIGURATION_ERROR: Test mode active but key_id does not start with rzp_test_");
  }

  return {
    env: effectiveEnv,
    keyId,
    keySecret,
    webhookSecret: webhookSecret || "SERVER_HMAC_TEST_WEBHOOK_SECRET"
  };
}
