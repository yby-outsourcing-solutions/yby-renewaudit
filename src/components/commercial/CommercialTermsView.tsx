import { useState } from "react";

interface CommercialTermsViewProps {
  identifiedSavings?: number;
}

export const INVALID_FEE_SENTINEL = "N/A — Audit Fee is zero/invalid";

export interface CommercialROISimulation {
  netCustomerValueINR: number;
  customerROI: string;
  roiNumeric: number | null;
  formattedNetValue: string;
  formattedROI: string;
  isInvalidFee: boolean;
}

export function calculateCommercialROI(
  savingsINR: number,
  auditFee: number = 2999
): CommercialROISimulation {
  const safeSavings = Number.isFinite(savingsINR) ? savingsINR : 0;
  const isInvalidFee = !Number.isFinite(auditFee) || auditFee <= 0;

  if (isInvalidFee) {
    const feeFallback = Number.isFinite(auditFee) && auditFee >= 0 ? auditFee : 0;
    const netCustomerValueINR = safeSavings - feeFallback;
    const formattedNetValue =
      netCustomerValueINR < 0
        ? `-₹${Math.abs(netCustomerValueINR).toLocaleString("en-IN")}`
        : `₹${netCustomerValueINR.toLocaleString("en-IN")}`;

    return {
      netCustomerValueINR,
      customerROI: "N/A",
      roiNumeric: null,
      formattedNetValue,
      formattedROI: INVALID_FEE_SENTINEL,
      isInvalidFee: true
    };
  }

  const netCustomerValueINR = safeSavings - auditFee;
  const roiNumeric = (netCustomerValueINR / auditFee) * 100;
  const customerROI = roiNumeric.toFixed(2);
  const formattedNetValue =
    netCustomerValueINR < 0
      ? `-₹${Math.abs(netCustomerValueINR).toLocaleString("en-IN")}`
      : `₹${netCustomerValueINR.toLocaleString("en-IN")}`;
  const formattedROI = `${customerROI}%`;

  return {
    netCustomerValueINR,
    customerROI,
    roiNumeric,
    formattedNetValue,
    formattedROI,
    isInvalidFee: false
  };
}

export function CommercialTermsView({ identifiedSavings = 160000 }: CommercialTermsViewProps) {
  // Identified savings default set to ₹1,60,000 (~$2,000)
  const [customSavingsINR, setCustomSavingsINR] = useState<number>(identifiedSavings || 160000);

  // V1 Introductory Fixed Fee Model:
  const singleAuditPrice = 2999;
  const simulation = calculateCommercialROI(customSavingsINR, singleAuditPrice);

  return (
    <section className="panel-card">
      <div className="panel-header">
        <div>
          <h2>💎 YBY RenewAudit — V1 Introductory Commercial Pricing</h2>
          <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginTop: "4px" }}>
            Transparent Fixed-Fee Introductory Pricing & ROI Simulator (INR ₹)
          </div>
        </div>
        <span className="badge badge-emerald">V1 Introductory Model</span>
      </div>

      <div className="badge badge-amber" style={{ padding: "10px 14px", borderRadius: "8px", marginBottom: "20px", display: "inline-block" }}>
        ⚠️ <strong>Notice:</strong> This introductory pricing is designed for early customer acquisition &amp; real-world validation (first 10–15 customers). Commercial limits are isolated and do NOT alter core audit calculations.
      </div>

      {/* Interactive Savings & ROI Calculator */}
      <div style={{ background: "var(--surface-color, rgba(255,255,255,0.03))", padding: "20px", borderRadius: "12px", marginBottom: "24px", border: "1px solid var(--border-color, rgba(255,255,255,0.1))" }}>
        <h3 style={{ marginBottom: "12px" }}>📊 Single Audit Value &amp; ROI Simulator</h3>
        <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", marginBottom: "16px" }}>
          Simulate net customer savings and ROI on a Single Audit (₹2,999 flat fee):
        </p>

        <div style={{ marginBottom: "16px", display: "flex", gap: "16px", alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ fontWeight: 600 }}>Identified Audit Overcharge Savings (₹):</label>
          <input
            type="number"
            className="input-box"
            style={{ width: "220px" }}
            value={customSavingsINR}
            onChange={(e) => setCustomSavingsINR(Math.max(0, Number(e.target.value) || 0))}
            step="10000"
          />
        </div>

        <div className="metrics-grid">
          <div className="metric-card">
            <div className="metric-label">Identified Savings</div>
            <div className="metric-value emerald">₹{customSavingsINR.toLocaleString("en-IN")}</div>
            <div className="metric-sub">Verified Overcharge Value</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Single Audit Fee</div>
            <div className="metric-value cyan">₹{singleAuditPrice.toLocaleString("en-IN")}</div>
            <div className="metric-sub">Flat Transparent One-Time Fee</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Net Customer Value Retained</div>
            <div className={`metric-value ${simulation.netCustomerValueINR >= 0 ? "emerald" : "rose"}`}>
              {simulation.formattedNetValue}
            </div>
            <div className="metric-sub">
              {simulation.netCustomerValueINR >= 0 ? "Net Savings Retained by Customer" : "Net Deficit (Audit Cost Exceeds Savings)"}
            </div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Customer ROI Multiplier</div>
            <div
              className={`metric-value ${
                simulation.isInvalidFee
                  ? "amber"
                  : simulation.roiNumeric! >= 0
                  ? simulation.roiNumeric! > 0
                    ? "emerald"
                    : "cyan"
                  : "rose"
              }`}
              style={simulation.isInvalidFee ? { fontSize: "1.05rem", lineHeight: 1.3 } : undefined}
            >
              {simulation.formattedROI}
            </div>
            <div className="metric-sub">
              {simulation.isInvalidFee
                ? "Audit Fee Must Be Greater Than Zero"
                : simulation.roiNumeric! >= 0
                ? "Return on Single Audit Fee"
                : "Negative Net Yield on Audit Fee"}
            </div>
          </div>
        </div>
      </div>

      {/* Commercial Tiers */}
      <h3 style={{ marginBottom: "16px" }}>🏷️ V1 Introductory Pricing Plans</h3>
      <div className="metrics-grid" style={{ marginBottom: "24px" }}>
        {/* Tier 1: Free Audit */}
        <div className="metric-card" style={{ borderTop: "3px solid var(--accent-cyan, #06b6d4)" }}>
          <div className="metric-label" style={{ fontSize: "1rem", fontWeight: 700 }}>1️⃣ Free First Audit</div>
          <div className="metric-value cyan" style={{ fontSize: "1.4rem", margin: "10px 0" }}>₹0 / First Audit</div>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", lineHeight: "1.4" }}>
            <strong>Limit:</strong> 1 Audit Case per new company.<br />
            Includes 1 contract + 1 usage CSV, Evidence Pack &amp; Negotiation Draft.
          </p>
        </div>

        {/* Tier 2: Single Audit */}
        <div className="metric-card" style={{ borderTop: "3px solid var(--accent-emerald, #10b981)" }}>
          <div className="metric-label" style={{ fontSize: "1rem", fontWeight: 700 }}>2️⃣ Single Audit</div>
          <div className="metric-value emerald" style={{ fontSize: "1.4rem", margin: "10px 0" }}>₹2,999 / One-Time</div>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", lineHeight: "1.4" }}>
            <strong>Limit:</strong> 1 Renewal Audit Case.<br />
            Ideal for occasional/single-renewal contract reviews.
          </p>
        </div>

        {/* Tier 3: Professional Monthly */}
        <div className="metric-card" style={{ borderTop: "3px solid var(--accent-amber, #f59e0b)" }}>
          <div className="metric-label" style={{ fontSize: "1rem", fontWeight: 700 }}>3️⃣ Professional Monthly</div>
          <div className="metric-value amber" style={{ fontSize: "1.4rem", margin: "10px 0" }}>₹4,999 / Month</div>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", lineHeight: "1.4" }}>
            <strong>Limit:</strong> Max 5 Audit Cases / month.<br />
            Introductory pricing for first 10–15 paying customers.
          </p>
        </div>

        {/* Tier 4: Annual Professional */}
        <div className="metric-card" style={{ borderTop: "3px solid var(--accent-rose, #f43f5e)" }}>
          <div className="metric-label" style={{ fontSize: "1rem", fontWeight: 700 }}>4️⃣ Annual Professional</div>
          <div className="metric-value rose" style={{ fontSize: "1.4rem", margin: "10px 0" }}>₹49,990 / Year</div>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", lineHeight: "1.4" }}>
            <strong>Limit:</strong> Max 60 Audit Cases / year.<br />
            ~₹4,166/mo equivalent (Introductory pricing for first 10 annual buyers).
          </p>
        </div>
      </div>

      {/* Commercial Safeguards & Economics */}
      <h3 style={{ marginBottom: "12px" }}>🔒 Commercial Safeguards &amp; Value Drivers</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "16px", marginBottom: "20px" }}>
        <div style={{ background: "var(--surface-color, rgba(255,255,255,0.03))", padding: "16px", borderRadius: "8px" }}>
          <strong>✅ No Success Fee (Fixed Pricing)</strong>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", marginTop: "4px" }}>
            100% transparent fixed pricing without percentage commission or recovery sharing friction.
          </p>
        </div>
        <div style={{ background: "var(--surface-color, rgba(255,255,255,0.03))", padding: "16px", borderRadius: "8px" }}>
          <strong>🔒 Strict Pricing Isolation</strong>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", marginTop: "4px" }}>
            Commercial plan limits are isolated presentation schemas and do NOT mutate G8.1–G8.6 audit rules or R1–R8 calculations.
          </p>
        </div>
        <div style={{ background: "var(--surface-color, rgba(255,255,255,0.03))", padding: "16px", borderRadius: "8px" }}>
          <strong>🚀 High Gross Margin Structure</strong>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", marginTop: "4px" }}>
            100% client-side browser execution eliminates backend cloud compute overhead, ensuring over 90% operational gross margin.
          </p>
        </div>
      </div>
    </section>
  );
}
