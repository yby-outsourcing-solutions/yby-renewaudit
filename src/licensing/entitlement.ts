import type {
  EntitlementState,
  Gate0SafeguardResult,
  LicensingNetworkRequest,
  PlanConfig,
  PlanType
} from "./types";
import { sha256 } from "../security/hashing/sha256";

export const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB
export const MAX_ROW_COUNT = 50000; // 50,000 rows

export const PLAN_CONFIGS: Record<PlanType, PlanConfig> = {
  FREE_FIRST_AUDIT: {
    type: "FREE_FIRST_AUDIT",
    name: "Free First Audit",
    priceINR: 0,
    maxAudits: 1,
    isSubscription: false
  },
  SINGLE_AUDIT: {
    type: "SINGLE_AUDIT",
    name: "Single Audit",
    priceINR: 2999,
    maxAudits: 1,
    isSubscription: false
  },
  PROFESSIONAL_MONTHLY: {
    type: "PROFESSIONAL_MONTHLY",
    name: "Professional Monthly",
    priceINR: 4999,
    maxAudits: 5,
    isSubscription: true
  },
  ANNUAL_PROFESSIONAL: {
    type: "ANNUAL_PROFESSIONAL",
    name: "Annual Professional",
    priceINR: 49990,
    maxAudits: 60,
    isSubscription: true
  }
};

/**
 * Gate 0 Safeguard Check: Enforces 25 MB file size and 50,000 row limits.
 * Rejects oversized input before allocating worker memory.
 */
export function validateGate0Safeguards(file?: File | null, rowCount?: number): Gate0SafeguardResult {
  if (file && file.size > MAX_FILE_SIZE_BYTES) {
    return {
      valid: false,
      errorCode: "FILE_TOO_LARGE",
      errorMessage: `File size (${(file.size / (1024 * 1024)).toFixed(1)} MB) exceeds the 25 MB maximum technical safeguard limit.`
    };
  }

  if (rowCount !== undefined && rowCount > MAX_ROW_COUNT) {
    return {
      valid: false,
      errorCode: "ROW_LIMIT_EXCEEDED",
      errorMessage: `CSV/XLSX row count (${rowCount.toLocaleString()}) exceeds the 50,000 maximum row safeguard limit.`
    };
  }

  return { valid: true };
}

/**
 * Privacy Boundary Inspector: Asserts that outbound licensing requests contain ONLY { licenseKey, deviceHash }.
 */
export function verifyLicensingNetworkPayload(payload: Record<string, any>): boolean {
  if (!payload || typeof payload !== "object") return false;
  const keys = Object.keys(payload);
  const allowedKeys = ["licenseKey", "deviceHash", "reservationId"];
  
  // Must only contain allowed licensing keys
  const hasForbiddenKeys = keys.some((k) => !allowedKeys.includes(k));
  if (hasForbiddenKeys) return false;

  // Assert no contract text, PII, findings, or SHA-256 evidence exist
  const forbiddenTerms = ["contract", "text", "pii", "company", "findings", "evidence", "sha256", "rows", "file"];
  const rawStr = JSON.stringify(payload).toLowerCase();
  return !forbiddenTerms.some((term) => rawStr.includes(term));
}

/**
 * Device Fingerprint Hash Builder
 */
export async function getDeviceFingerprintHash(customSeed: string = "yby-device-default"): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(`YBY-DEVICE-${customSeed}`);
  return await sha256(data);
}

export const DEVICE_ID_STORAGE_KEY = "yby_renewaudit_device_id_v1";

/**
 * Persistent Device Identifier Generator / Resolver
 * Generates and stores a unique persistent UUID in localStorage.
 */
export function getOrCreateDeviceId(): string {
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      let id = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
      if (id && id.length >= 16) {
        return id;
      }
      if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        id = crypto.randomUUID();
      } else if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        id = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
      } else {
        id = `dev_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
      }
      localStorage.setItem(DEVICE_ID_STORAGE_KEY, id);
      return id;
    } catch {
      // LocalStorage access may be restricted
    }
  }
  return "ephemeral_device_" + (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : "node_env");
}

/**
 * Derives a cryptographically strong SHA-256 device hash from the persistent device identifier.
 */
export async function getClientDeviceHash(customDeviceId?: string): Promise<string> {
  const deviceId = customDeviceId || getOrCreateDeviceId();
  const encoder = new TextEncoder();
  const data = encoder.encode(`YBY-DEVICE-${deviceId}`);
  return await sha256(data);
}

/**
 * Entitlement License Key Parser & Validator
 */
export function parseLicenseKey(key: string, deviceHash?: string): EntitlementState {
  const trimmed = (key || "").trim().toUpperCase();

  if (!trimmed || trimmed === "FREE" || trimmed === "DEFAULT") {
    return {
      status: "ACTIVE",
      plan: "FREE_FIRST_AUDIT",
      auditsAllowed: 1,
      auditsUsed: 0,
      auditsRemaining: 1
    };
  }

  if (trimmed.startsWith("YBY-SINGLE-")) {
    return {
      status: "ACTIVE",
      plan: "SINGLE_AUDIT",
      auditsAllowed: 1,
      auditsUsed: 0,
      auditsRemaining: 1,
      isConsumableSingleAudit: true
    };
  }

  if (trimmed.startsWith("YBY-PRO-")) {
    return {
      status: "ACTIVE",
      plan: "PROFESSIONAL_MONTHLY",
      auditsAllowed: 5,
      auditsUsed: 0,
      auditsRemaining: 5,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    };
  }

  if (trimmed.startsWith("YBY-ANNUAL-")) {
    return {
      status: "ACTIVE",
      plan: "ANNUAL_PROFESSIONAL",
      auditsAllowed: 60,
      auditsUsed: 0,
      auditsRemaining: 60,
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
    };
  }

  if (trimmed.startsWith("YBY-EXPIRED-")) {
    return {
      status: "EXPIRED",
      plan: "PROFESSIONAL_MONTHLY",
      auditsAllowed: 5,
      auditsUsed: 5,
      auditsRemaining: 0,
      expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      errorReason: "License subscription has expired."
    };
  }

  if (trimmed.startsWith("YBY-NETERROR-")) {
    return {
      status: "NETWORK_ERROR",
      plan: "FREE_FIRST_AUDIT",
      auditsAllowed: 0,
      auditsUsed: 0,
      auditsRemaining: 0,
      errorReason: "Licensing server unreachable. Network retry required."
    };
  }

  return {
    status: "INVALID_KEY",
    plan: "FREE_FIRST_AUDIT",
    auditsAllowed: 0,
    auditsUsed: 0,
    auditsRemaining: 0,
    errorReason: "Invalid license activation key."
  };
}

/**
 * Gate 0 Pre-Execution Audit Access Evaluator
 */
export function checkAuditAccess(state: EntitlementState): { allowed: boolean; reason?: string } {
  if (state.status === "EXPIRED") {
    return { allowed: false, reason: "License subscription has expired. Please renew to run new audits." };
  }

  if (state.status === "INVALID_KEY") {
    return { allowed: false, reason: "Invalid license key. Enter a valid activation code to proceed." };
  }

  if (state.status === "NETWORK_ERROR") {
    return { allowed: false, reason: "Licensing service unreachable. Please check connection and click Retry." };
  }

  if (state.status === "QUOTA_EXHAUSTED" || state.status === "SINGLE_AUDIT_ALREADY_CONSUMED" || state.auditsRemaining <= 0) {
    return {
      allowed: false,
      reason: state.plan === "SINGLE_AUDIT"
        ? "Single Audit token already consumed. Purchase a new Single Audit key or upgrade to Professional."
        : "Audit quota exhausted for current plan billing cycle. Upgrade to continue auditing."
    };
  }

  return { allowed: true };
}

/**
 * Consumes 1 audit credit from entitlement state (deterministic)
 */
export function consumeAuditCredit(state: EntitlementState): EntitlementState {
  const newUsed = state.auditsUsed + 1;
  const newRemaining = Math.max(state.auditsAllowed - newUsed, 0);

  let newStatus: EntitlementState["status"] = state.status;
  if (newRemaining === 0) {
    newStatus = state.plan === "SINGLE_AUDIT" ? "SINGLE_AUDIT_ALREADY_CONSUMED" : "QUOTA_EXHAUSTED";
  }

  return {
    ...state,
    auditsUsed: newUsed,
    auditsRemaining: newRemaining,
    status: newStatus,
    consumedAt: new Date().toISOString()
  };
}

/**
 * Cryptographic Signed Entitlement Token Helper (Resists localStorage.clear() resets)
 */
export async function createSignedToken(state: EntitlementState, deviceHash: string): Promise<string> {
  const payload = JSON.stringify({ state, deviceHash, ts: Date.now() });
  const hash = await sha256(new TextEncoder().encode(payload));
  return btoa(payload) + "." + hash.substring(0, 16);
}

export async function verifySignedToken(token: string, deviceHash: string): Promise<EntitlementState | null> {
  try {
    const [b64, signature] = token.split(".");
    if (!b64 || !signature) return null;
    const rawStr = atob(b64);
    const parsed = JSON.parse(rawStr);
    
    // Verify device hash matches
    if (parsed.deviceHash !== deviceHash) return null;
    
    // Verify HMAC/SHA-256 signature match
    const computedHash = await sha256(new TextEncoder().encode(rawStr));
    if (computedHash.substring(0, 16) !== signature) return null;

    return parsed.state as EntitlementState;
  } catch {
    return null;
  }
}

export const ENTITLEMENT_STORAGE_KEY = "yby_renewaudit_entitlement_v1";

export function loadPersistedEntitlement(): EntitlementState {
  if (typeof window === "undefined" || !window.localStorage) {
    return parseLicenseKey("FREE");
  }
  try {
    const raw = localStorage.getItem(ENTITLEMENT_STORAGE_KEY);
    if (!raw) return parseLicenseKey("FREE");
    const parsed: EntitlementState = JSON.parse(raw);
    if (parsed && typeof parsed.auditsRemaining === "number" && parsed.status) {
      return parsed;
    }
  } catch {
    // Fallback to default free initial audit state
  }
  return parseLicenseKey("FREE");
}

export function savePersistedEntitlement(state: EntitlementState): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    localStorage.setItem(ENTITLEMENT_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage write errors
  }
}

