export type PlanType = "FREE_FIRST_AUDIT" | "SINGLE_AUDIT" | "PROFESSIONAL_MONTHLY" | "ANNUAL_PROFESSIONAL";

export type EntitlementStatus =
  | "ACTIVE"
  | "UNVERIFIED"
  | "QUOTA_EXHAUSTED"
  | "EXPIRED"
  | "INVALID_KEY"
  | "NETWORK_ERROR"
  | "SINGLE_AUDIT_ALREADY_CONSUMED";

export interface PlanConfig {
  type: PlanType;
  name: string;
  priceINR: number;
  maxAudits: number;
  isSubscription: boolean;
}

export interface LicenseCredential {
  licenseKey: string;
  deviceHash: string;
}

export interface EntitlementState {
  status: EntitlementStatus;
  plan: PlanType;
  auditsAllowed: number;
  auditsUsed: number;
  auditsRemaining: number;
  expiresAt?: string;
  isConsumableSingleAudit?: boolean;
  consumedAt?: string;
  errorReason?: string;
}

export interface Gate0SafeguardResult {
  valid: boolean;
  errorCode?: "FILE_TOO_LARGE" | "ROW_LIMIT_EXCEEDED";
  errorMessage?: string;
}

export interface LicensingNetworkRequest {
  licenseKey: string;
  deviceHash: string;
}
