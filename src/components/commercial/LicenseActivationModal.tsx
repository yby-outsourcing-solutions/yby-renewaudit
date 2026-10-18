import { useEffect, useState } from "react";
import { checkAuditAccess, PLAN_CONFIGS, parseLicenseKey, getClientDeviceHash } from "../../licensing/entitlement";
import type { EntitlementState, PlanType } from "../../licensing/types";
import { computeWebhookHmac, getWebhookSecret, PaymentWebhookHandler } from "../../commercial/server/paymentWebhookHandler";
import { ProductionLicensingService } from "../../licensing/server/licensingService";

export const PENDING_FULFILLMENT_STORAGE_KEY = "yby_pending_fulfillment_v1";

export interface PendingFulfillmentData {
  orderId: string;
  paymentId: string;
  signature: string;
  claimToken: string;
  planType: PlanType;
  timestamp: number;
}

export function getPendingFulfillment(): PendingFulfillmentData | null {
  if (typeof window === "undefined" || !window.sessionStorage) return null;
  try {
    const raw = sessionStorage.getItem(PENDING_FULFILLMENT_STORAGE_KEY);
    if (!raw) return null;
    const parsed: PendingFulfillmentData = JSON.parse(raw);
    if (parsed && parsed.orderId && parsed.paymentId && parsed.signature && parsed.claimToken && parsed.planType) {
      if (Date.now() - parsed.timestamp < 24 * 60 * 60 * 1000) {
        return parsed;
      }
    }
    sessionStorage.removeItem(PENDING_FULFILLMENT_STORAGE_KEY);
  } catch {
    // Storage read error
  }
  return null;
}

export function savePendingFulfillment(data: PendingFulfillmentData): void {
  if (typeof window === "undefined" || !window.sessionStorage) return;
  try {
    sessionStorage.setItem(PENDING_FULFILLMENT_STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Storage write error
  }
}

export function clearPendingFulfillment(): void {
  if (typeof window === "undefined" || !window.sessionStorage) return;
  try {
    sessionStorage.removeItem(PENDING_FULFILLMENT_STORAGE_KEY);
  } catch {
    // Storage remove error
  }
}

interface LicenseActivationModalProps {
  currentState: EntitlementState;
  onStateChange: (newState: EntitlementState) => void;
  onClose?: () => void;
}

export function LicenseActivationModal({ currentState, onStateChange, onClose }: LicenseActivationModalProps) {
  const [inputKey, setInputKey] = useState("");
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [pendingRecovery, setPendingRecovery] = useState<PendingFulfillmentData | null>(null);
  const [isRecovering, setIsRecovering] = useState(false);

  const planInfo = PLAN_CONFIGS[currentState.plan];
  const accessCheck = checkAuditAccess(currentState);

  // Check for interrupted/unfulfilled captured payments on component mount
  useEffect(() => {
    const pending = getPendingFulfillment();
    if (pending) {
      setPendingRecovery(pending);
    }
  }, []);

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

  // Idempotent recovery for captured payments where the fulfillment response was lost or timed out
  async function handleRecoverFulfillment(pending: PendingFulfillmentData) {
    setIsRecovering(true);
    setMessage(null);
    try {
      const deviceHash = await getClientDeviceHash();
      const fulfillRes = await fetch("/.netlify/functions/fulfill-license", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_id: pending.orderId,
          orderId: pending.orderId,
          payment_id: pending.paymentId,
          paymentId: pending.paymentId,
          razorpay_signature: pending.signature,
          signature: pending.signature,
          claim_token: pending.claimToken,
          claimToken: pending.claimToken,
          device_hash: deviceHash,
          deviceHash: deviceHash
        })
      });

      const fulfillData = await fulfillRes.json();
      const licenseKey = fulfillData.licenseKey || fulfillData.license_key;

      if (fulfillRes.ok && fulfillData.success && licenseKey) {
        clearPendingFulfillment();
        setPendingRecovery(null);
        handleActivate(licenseKey);
        setMessage({
          text: `Payment fulfillment recovered successfully! ${PLAN_CONFIGS[pending.planType]?.name || pending.planType} activated.`,
          type: "success"
        });
      } else {
        setMessage({
          text: fulfillData.error || "Recovery failed. Unable to verify payment with server.",
          type: "error"
        });
      }
    } catch (err: any) {
      setMessage({
        text: `Recovery network error: ${err.message || "Failed to reach licensing server. Please retry."}`,
        type: "error"
      });
    } finally {
      setIsRecovering(false);
    }
  }

  async function handleServerVerifiedPayment(planType: PlanType, simulateFailure: boolean = false, isMicroTest: boolean = false) {
    setIsProcessingPayment(true);
    setMessage(null);

    const isDev = Boolean(import.meta.env?.DEV);
    const isLocalhost = typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
    const isSimulationAllowed = isDev && isLocalhost && simulateFailure;

    // Fail closed: simulation cannot be invoked in production or without explicit test mode
    if (simulateFailure && !isSimulationAllowed) {
      setIsProcessingPayment(false);
      setMessage({
        text: "Simulated payment is disabled in production. Authoritative server-verified settlement is required.",
        type: "error"
      });
      return;
    }

    if (!isSimulationAllowed) {
      // Production & Live Browser Razorpay Flow: STRICT FAIL-CLOSED
      try {
        const deviceHash = await getClientDeviceHash();
        const checkoutRes = await fetch("/.netlify/functions/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            planType: planType,
            plan: planType,
            isMicroTest: isMicroTest,
            customerEmail: "billing@company.com"
          })
        });

        if (!checkoutRes.ok) {
          const errData = await checkoutRes.json().catch(() => ({}));
          setIsProcessingPayment(false);
          setMessage({
            text: errData.error || `Payment checkout initialization failed (HTTP ${checkoutRes.status}). Please try again.`,
            type: "error"
          });
          return; // FAIL CLOSED: Never fall through to simulated payment
        }

        const checkoutData = await checkoutRes.json();
        const keyId = checkoutData.keyId || checkoutData.key_id;
        const orderId = checkoutData.orderId || checkoutData.order_id;
        const amount = checkoutData.amount;
        const currency = checkoutData.currency || "INR";
        const claimToken = checkoutData.claimToken || checkoutData.claim_token;

        if (!keyId || !orderId || !claimToken) {
          setIsProcessingPayment(false);
          setMessage({
            text: "Malformed checkout response from server. Missing order authorization parameters.",
            type: "error"
          });
          return; // FAIL CLOSED
        }

        // Dynamically load Razorpay checkout SDK if not present on window
        if (!(window as any).Razorpay) {
          await new Promise<void>((resolve, reject) => {
            const script = document.createElement("script");
            script.src = "https://checkout.razorpay.com/v1/checkout.js";
            script.onload = () => resolve();
            script.onerror = () => reject(new Error("Failed to load Razorpay Checkout SDK. Check network connection."));
            document.body.appendChild(script);
          });
        }

        const rzp = new (window as any).Razorpay({
          key: keyId,
          amount: amount,
          currency: currency,
          name: "YBY RenewAudit",
          description: isMicroTest
            ? "Live UPI Verification Test (₹10.00)"
            : `${PLAN_CONFIGS[planType]?.name || planType} Commercial Entitlement`,
          order_id: orderId,
          handler: async (response: {
            razorpay_payment_id: string;
            razorpay_order_id: string;
            razorpay_signature: string;
          }) => {
            // 1. Immediately persist captured payment to sessionStorage for recovery resilience
            const pendingData: PendingFulfillmentData = {
              orderId: response.razorpay_order_id,
              paymentId: response.razorpay_payment_id,
              signature: response.razorpay_signature,
              claimToken: claimToken,
              planType: planType,
              timestamp: Date.now()
            };
            savePendingFulfillment(pendingData);
            setPendingRecovery(pendingData);

            // 2. Perform authoritative server-side fulfillment with persistent device binding
            try {
              const fulfillRes = await fetch("/.netlify/functions/fulfill-license", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  order_id: response.razorpay_order_id,
                  orderId: response.razorpay_order_id,
                  payment_id: response.razorpay_payment_id,
                  paymentId: response.razorpay_payment_id,
                  razorpay_signature: response.razorpay_signature,
                  signature: response.razorpay_signature,
                  claim_token: claimToken,
                  claimToken: claimToken,
                  device_hash: deviceHash,
                  deviceHash: deviceHash
                })
              });

              const fulfillData = await fulfillRes.json();
              const licenseKey = fulfillData.licenseKey || fulfillData.license_key;

              if (fulfillRes.ok && fulfillData.success && licenseKey) {
                clearPendingFulfillment();
                setPendingRecovery(null);
                handleActivate(licenseKey);
              } else {
                setMessage({
                  text: fulfillData.error || "Payment was captured, but license provisioning encountered an error. Click 'Recover License' to retry.",
                  type: "error"
                });
              }
            } catch (e: any) {
              setMessage({
                text: `License fulfillment network error: ${e.message}. Your payment was captured; click 'Recover License' to complete activation.`,
                type: "error"
              });
            } finally {
              setIsProcessingPayment(false);
            }
          },
          modal: {
            ondismiss: () => {
              setIsProcessingPayment(false);
            }
          }
        });

        rzp.open();
        return;
      } catch (err: any) {
        setIsProcessingPayment(false);
        setMessage({
          text: err.message || "Failed to initialize payment checkout. Please check connection and try again.",
          type: "error"
        });
        return; // STRICT FAIL CLOSED: Do not fall through to simulation
      }
    }

    // Explicit Local Development Simulation Path (Only reachable when isSimulationAllowed is true)
    try {
      const deviceHash = await getClientDeviceHash();
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
          deviceHash: deviceHash
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
          text: `[DEV ONLY] Payment Confirmed & Verified Server-Side! ${PLAN_CONFIGS[planType].name} activated with ${newState.auditsRemaining} audits.`,
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

      {/* Interrupted Payment Recovery Banner */}
      {pendingRecovery && (
        <div
          className="badge badge-amber"
          style={{
            padding: "14px 18px",
            borderRadius: "8px",
            marginBottom: "20px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "12px",
            background: "rgba(245, 158, 11, 0.15)",
            border: "1px solid rgba(245, 158, 11, 0.4)"
          }}
        >
          <div>
            <strong style={{ color: "var(--accent-amber, #f59e0b)" }}>⚠️ Unfulfilled Payment Detected:</strong>
            <div style={{ fontSize: "0.85rem", marginTop: "2px", color: "var(--text-secondary)" }}>
              Payment for Order #{pendingRecovery.orderId.slice(-8)} was captured, but license fulfillment was interrupted.
            </div>
          </div>
          <button
            className="btn btn-warning btn-sm"
            disabled={isRecovering}
            onClick={() => handleRecoverFulfillment(pendingRecovery)}
          >
            {isRecovering ? "Recovering..." : "🔄 Recover License"}
          </button>
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
            className="btn btn-warning btn-sm"
            disabled={isProcessingPayment}
            style={{ fontWeight: "bold", background: "#f59e0b", color: "#000", border: "1px solid #d97706" }}
            onClick={() => handleServerVerifiedPayment("SINGLE_AUDIT", false, true)}
          >
            ⚡ Pay ₹10 (Live UPI Test)
          </button>
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

