// src/licensing/apiClient.ts - Production Licensing API Client Bridge
import type { EntitlementState } from "./types";
import { verifyLicensingNetworkPayload } from "./entitlement";
import { ProductionLicensingService } from "./server/licensingService";

/**
 * Client-Side Production Licensing API Bridge
 * Sends ONLY { licenseKey, deviceHash } over HTTPS to the Production Licensing API.
 */
export async function verifyLicenseKeyOnline(
  licenseKey: string,
  deviceHash: string,
  apiBaseUrl?: string
): Promise<EntitlementState> {
  const payload = { licenseKey, deviceHash };

  // 1. Zero Audit Data Privacy Assertion
  if (!verifyLicensingNetworkPayload(payload)) {
    return {
      status: "INVALID_KEY",
      plan: "FREE_FIRST_AUDIT",
      auditsAllowed: 0,
      auditsUsed: 0,
      auditsRemaining: 0,
      errorReason: "Privacy Violation: Outbound licensing payload rejected due to non-licensing metadata."
    };
  }

  try {
    // If production endpoint is provided or in browser with Netlify Functions active
    const targetUrl = apiBaseUrl
      ? `${apiBaseUrl}/licensing`
      : typeof window !== "undefined" && window.location.hostname !== "localhost" && !window.location.hostname.includes("127.0.0.1")
      ? "/.netlify/functions/licensing"
      : undefined;

    if (targetUrl) {
      const response = await fetch(targetUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "validate", licenseKey, deviceHash })
      });

      if (!response.ok) {
        return {
          status: "NETWORK_ERROR",
          plan: "FREE_FIRST_AUDIT",
          auditsAllowed: 0,
          auditsUsed: 0,
          auditsRemaining: 0,
          errorReason: `Licensing API returned HTTP error status ${response.status}.`
        };
      }

      const resJson = await response.json();
      return {
        status: resJson.status,
        plan: resJson.plan || "FREE_FIRST_AUDIT",
        auditsAllowed: resJson.auditsAllowed || (resJson.auditsRemaining || 0),
        auditsUsed: 0,
        auditsRemaining: resJson.auditsRemaining || 0,
        errorReason: resJson.reason
      };
    }

    // Direct isolated service handler invocation (Local/Test execution mode)
    const serverRes = ProductionLicensingService.handleValidateKeyRequest(payload);
    return {
      status: serverRes.status,
      plan: serverRes.plan || "FREE_FIRST_AUDIT",
      auditsAllowed: serverRes.auditsRemaining || 0,
      auditsUsed: 0,
      auditsRemaining: serverRes.auditsRemaining || 0,
      errorReason: serverRes.reason
    };
  } catch {
    // Network failure fails closed for starting NEW audits
    return {
      status: "NETWORK_ERROR",
      plan: "FREE_FIRST_AUDIT",
      auditsAllowed: 0,
      auditsUsed: 0,
      auditsRemaining: 0,
      errorReason: "Licensing server unreachable. Gate 0 audit execution blocked until network connection is restored."
    };
  }
}
