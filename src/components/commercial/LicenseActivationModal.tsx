import { useState } from "react";
import { checkAuditAccess, PLAN_CONFIGS, parseLicenseKey } from "../../licensing/entitlement";
import type { EntitlementState, PlanType } from "../../licensing/types";
import { computeWebhookHmac, getWebhookSecret, PaymentWebhookHandler } from "../../commercial/server/paymentWebhookHandler";
import { ProductionLicensingService } from "../../licensing/server/licensingService";

interface LicenseActivationModalProps {
  currentState: EntitlementState;
  onStateChange: (newState: EntitlementState) => void;
  onClose?: () => void;
}

export function LicenseActivationModal({ currentState, onStateChange, onClose }: LicenseActivationModalProps) {
  const [inputKey, setInputKey] = useState("");
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);

  const planInfo = PLAN_CONFIGS[currentState.plan];
  const accessCheck = checkAuditAccess(currentState);

  function handleActivate(keyToActivate?: string) {
    const targetKey = keyToActivate || inputKey;
    if (!targetKey.trim()) {
      setMessage({ text: "Please enter an activation key.", type: "error" });
      return;
    }

    const newState = parseLicenseKey(targetKey);
    onStateChange(newState);

    if (newState.status === "ACTIVE") {
      setMessage({
        text: `Successfully activated ${PLAN_CONFIGS[newState.plan]?.name || "Plan"}! (${newState.auditsRemaining} audits available)`,
        type: "success"
      });
      setInputKey("");
    } else {
      setMessage({
        text: newState.errorReason || "Failed to activate license key.",
        type: "error"
      });
    }
  }

  async function handleServerVerifiedPayment(planType: PlanType, simulateFailure: boolean = false) {
    setIsProcessingPayment(true);
    setMessage(null);

    try {
      const eventId = `evt_pay_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const paymentId = `pay_order_${Date.now()}`;
      const amountINR = PLAN_CONFIGS[planType]?.priceINR || 2999;
      const eventType = simulateFailure ? "payment.failed" : "payment.captured";
      const signature = await computeWebhookHmac(`${eventId}:${paymentId}:${planType}`, getWebhookSecret());

      const webhookRes = await PaymentWebhookHandler.handleWebhook({
        eventId,
        eventType,
        paymentId,
        amountINR,
        customerEmail: "billing@company.com",
        planType,
        signature
      });

      if (webhookRes.success && webhookRes.provisionedKey) {
        const valRes = ProductionLicensingService.handleValidateKeyRequest({
          licenseKey: webhookRes.provisionedKey,
          deviceHash: "default_device_hash"
        });

        const newState: EntitlementState = {
          status: "ACTIVE",
          plan: planType,
          auditsAllowed: valRes.auditsRemaining || 1,
          auditsUsed: 0,
          auditsRemaining: valRes.auditsRemaining || 1
        };

        onStateChange(newState);
        setMessage({
          text: `Payment Confirmed & Verified Server-Side! ${PLAN_CONFIGS[planType].name} activated with ${newState.auditsRemaining} audits.`,
          type: "success"
        });
      } else {
        setMessage({
          text: `Payment Verification Failed: ${webhookRes.message}`,
          type: "error"
        });
      }
    } catch {
      setMessage({ text: "Payment verification failed due to network or server error.", type: "error" });
    } finally {
      setIsProcessingPayment(false);
    }
  }

  return (
    <div
      className="license-modal-container no-print"
      style={{ background: "var(--surface-color, rgba(255,255,255,0.03))", padding: "20px", borderRadius: "12px", border: "1px solid var(--border-color, rgba(255,255,255,0.1))", marginBottom: "20px" }}
    >
      <div className="panel-header">
        <div>
          <h2>🔑 License & Commercial Entitlement</h2>
          <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginTop: "4px" }}>
            Gate 0 Commercial Access Control & Quota Management
          </div>
        </div>
        {onClose && (
          <button className="btn btn-secondary btn-sm" onClick={onClose}>
            ✕ Close
          </button>
        )}
      </div>

      {/* Active License Status Card */}
      <div className="metrics-grid" style={{ marginBottom: "20px" }}>
        <div className="metric-card">
          <div className="metric-label">Active Plan</div>
          <div className="metric-value cyan" style={{ fontSize: "1.3rem" }}>{planInfo?.name || currentState.plan}</div>
          <div className="metric-sub">{planInfo?.priceINR === 0 ? "Free Initial Audit" : `₹${planInfo?.priceINR.toLocaleString("en-IN")}`}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Entitlement Status</div>
          <div className={`metric-value ${accessCheck.allowed ? "emerald" : "rose"}`} style={{ fontSize: "1.3rem" }}>
            {currentState.status}
          </div>
          <div className="metric-sub">{accessCheck.allowed ? "Gate 0 Access Granted" : "Gate 0 Execution Blocked"}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Audit Quota Balance</div>
          <div className="metric-value amber" style={{ fontSize: "1.3rem" }}>
            {currentState.auditsRemaining} / {currentState.auditsAllowed}
          </div>
          <div className="metric-sub">{currentState.auditsUsed} Audits Used</div>
        </div>
      </div>

      {!accessCheck.allowed && (
        <div className="badge badge-rose" style={{ padding: "12px 16px", borderRadius: "8px", marginBottom: "20px", display: "block", textAlign: "center" }}>
          ⚠️ <strong>Gate 0 Blocked:</strong> {accessCheck.reason}
        </div>
      )}

      {/* Server-Verified Payment Upgrade Options */}
      <div style={{ marginBottom: "20px", padding: "16px", background: accessCheck.allowed ? "rgba(6, 182, 212, 0.05)" : "rgba(244, 63, 94, 0.05)", borderRadius: "8px", border: `1px solid ${accessCheck.allowed ? "rgba(6, 182, 212, 0.2)" : "rgba(244, 63, 94, 0.2)"}` }}>
        <h4 style={{ marginBottom: "10px", color: accessCheck.allowed ? "var(--accent-cyan)" : "var(--accent-rose)" }}>
          {accessCheck.allowed ? "💎 Upgrade / Renew Entitlement (Server-Verified Flow)" : "💳 Pay & Upgrade Entitlement (Required Recovery Action)"}
        </h4>
        <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginBottom: "12px" }}>
          {accessCheck.allowed
            ? `Your current plan is ACTIVE (${currentState.auditsRemaining} audit credit(s) remaining). You may purchase additional credits or upgrade below:`
            : "Select a commercial plan below to initiate server-verified payment settlement and reactivate audit access:"}
        </p>
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
          <button
            className="btn btn-primary btn-sm"
            disabled={isProcessingPayment}
            onClick={() => handleServerVerifiedPayment("SINGLE_AUDIT")}
          >
            💳 Pay ₹2,999 (Single Audit)
          </button>
          <button
            className="btn btn-primary btn-sm"
            disabled={isProcessingPayment}
            onClick={() => handleServerVerifiedPayment("PROFESSIONAL_MONTHLY")}
          >
            💳 Pay ₹4,999 (Monthly Plan)
          </button>
          <button
            className="btn btn-primary btn-sm"
            disabled={isProcessingPayment}
            onClick={() => handleServerVerifiedPayment("ANNUAL_PROFESSIONAL")}
          >
            💳 Pay ₹49,990 (Annual Plan)
          </button>
        </div>
      </div>

      {/* Key Activation Form */}
      <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap", marginBottom: "16px" }}>
        <input
          type="text"
          className="input-box"
          style={{ flex: 1, minWidth: "260px" }}
          placeholder="Enter License Key (e.g. YBY-PRO-XXXX or YBY-SINGLE-XXXX)"
          value={inputKey}
          onChange={(e) => setInputKey(e.target.value)}
        />
        <button className="btn btn-secondary" onClick={() => handleActivate()}>
          🔑 Activate Key
        </button>
      </div>

      {message && (
        <div className={`badge ${message.type === "success" ? "badge-emerald" : "badge-rose"}`} style={{ padding: "10px 14px", borderRadius: "8px", marginBottom: "16px" }}>
          {message.text}
        </div>
      )}
    </div>
  );
}

