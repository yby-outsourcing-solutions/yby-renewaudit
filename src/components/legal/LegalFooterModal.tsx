import { useState } from "react";

export type LegalModalTab = "pricing" | "contact" | "refund" | "privacy" | "terms";

interface LegalFooterModalProps {
  initialTab?: LegalModalTab;
  onClose: () => void;
}

export function LegalFooterModal({ initialTab = "contact", onClose }: LegalFooterModalProps) {
  const [activeTab, setActiveTab] = useState<LegalModalTab>(initialTab);

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(0, 0, 0, 0.75)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        padding: "20px"
      }}
    >
      <div
        style={{
          background: "var(--bg-card, #131722)",
          border: "1px solid var(--border-color, rgba(255,255,255,0.12))",
          borderRadius: "16px",
          width: "100%",
          maxWidth: "850px",
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 20px 50px rgba(0,0,0,0.5)"
        }}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: "20px 24px",
            borderBottom: "1px solid var(--border-color, rgba(255,255,255,0.1))",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center"
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: "1.25rem", color: "var(--text-primary, #fff)" }}>
              ⚖️ YBY RenewAudit — Legal &amp; Commercial Compliance
            </h3>
            <span style={{ fontSize: "0.8rem", color: "var(--text-secondary, #94a3b8)" }}>
              Razorpay Merchant Disclosures &amp; Platform Governance
            </span>
          </div>
          <button
            className="btn btn-secondary btn-sm"
            onClick={onClose}
            style={{ fontSize: "1rem", padding: "6px 12px" }}
          >
            ✕ Close
          </button>
        </div>

        {/* Modal Navigation Tabs */}
        <div
          style={{
            display: "flex",
            gap: "8px",
            padding: "12px 24px",
            background: "rgba(255,255,255,0.02)",
            borderBottom: "1px solid var(--border-color, rgba(255,255,255,0.08))",
            overflowX: "auto"
          }}
        >
          <button
            className={`btn btn-sm ${activeTab === "contact" ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setActiveTab("contact")}
          >
            📞 Contact Us
          </button>
          <button
            className={`btn btn-sm ${activeTab === "refund" ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setActiveTab("refund")}
          >
            ↩️ Refund Policy
          </button>
          <button
            className={`btn btn-sm ${activeTab === "privacy" ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setActiveTab("privacy")}
          >
            🛡️ Privacy Policy
          </button>
          <button
            className={`btn btn-sm ${activeTab === "terms" ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setActiveTab("terms")}
          >
            📜 Terms &amp; Conditions
          </button>
          <button
            className={`btn btn-sm ${activeTab === "pricing" ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setActiveTab("pricing")}
          >
            💎 Commercial Pricing
          </button>
        </div>

        {/* Modal Content Body */}
        <div style={{ padding: "24px", overflowY: "auto", flex: 1, fontSize: "0.9rem", lineHeight: "1.6", color: "var(--text-secondary, #cbd5e1)" }}>
          {/* Contact Us */}
          {activeTab === "contact" && (
            <div>
              <h3 style={{ color: "#fff", marginBottom: "12px" }}>📞 Contact Us</h3>
              <p>For customer support, billing inquiries, or licensing assistance, reach out to our commercial team:</p>
              
              <div style={{ background: "rgba(255,255,255,0.03)", padding: "16px", borderRadius: "8px", marginTop: "16px", border: "1px solid rgba(255,255,255,0.08)" }}>
                <p><strong>🏢 Company:</strong> YBY RenewAudit / YBY Outsourcing Services</p>
                <p><strong>📧 Support Email:</strong> <a href="mailto:ybyoutsourcing@zohomail.in" style={{ color: "var(--accent-cyan, #06b6d4)" }}>ybyoutsourcing@zohomail.in</a></p>
                <p><strong>📞 Phone:</strong> <a href="tel:+917020690046" style={{ color: "var(--accent-cyan, #06b6d4)" }}>+91 7020690046</a></p>
                <p><strong>📍 Address:</strong> YBY Tech Center, Latur, Maharashtra – 413512</p>
                <p><strong>⏰ Operating Hours:</strong> Monday – Friday, 9:00 AM – 6:00 PM IST (Response within 24–48 Business Hours)</p>
              </div>
            </div>
          )}

          {/* Refund & Cancellation Policy */}
          {activeTab === "refund" && (
            <div>
              <h3 style={{ color: "#fff", marginBottom: "12px" }}>↩️ Refund &amp; Cancellation Policy</h3>
              <p>Our refund policy directly mirrors our strict commercial quota state machine (AVAILABLE → RESERVED → CONSUMED):</p>
              
              <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "16px" }}>
                <div style={{ background: "rgba(16, 185, 129, 0.05)", padding: "14px", borderRadius: "8px", border: "1px solid rgba(16, 185, 129, 0.2)" }}>
                  <strong style={{ color: "#10b981" }}>🟢 AVAILABLE Quota (100% Refundable)</strong>
                  <p style={{ margin: "4px 0 0 0" }}>Unused, unreserved audit credits in AVAILABLE state qualify for a 100% full refund within 7 days of purchase.</p>
                </div>

                <div style={{ background: "rgba(245, 158, 11, 0.05)", padding: "14px", borderRadius: "8px", border: "1px solid rgba(245, 158, 11, 0.2)" }}>
                  <strong style={{ color: "#f59e0b" }}>🟡 RESERVED Quota (Cancellation Release)</strong>
                  <p style={{ margin: "4px 0 0 0" }}>If an audit execution is interrupted or cancelled before G1–G5 Hard Gates pass, the credit reservation (RESERVED) is automatically released back to AVAILABLE state.</p>
                </div>

                <div style={{ background: "rgba(244, 63, 94, 0.05)", padding: "14px", borderRadius: "8px", border: "1px solid rgba(244, 63, 94, 0.2)" }}>
                  <strong style={{ color: "#f43f5e" }}>🔴 CONSUMED Quota (Non-Refundable)</strong>
                  <p style={{ margin: "4px 0 0 0" }}>Once 100% Human Lock is confirmed, G1–G5 Hard Gates pass, and audit Evidence Pack is generated, the credit transitions to CONSUMED. Consumed credits represent completed audit work and are non-refundable.</p>
                </div>
              </div>

              <p style={{ marginTop: "16px" }}>
                To request a refund for unconsumed AVAILABLE credits, email <a href="mailto:ybyoutsourcing@zohomail.in" style={{ color: "var(--accent-cyan)" }}>ybyoutsourcing@zohomail.in</a> with your Payment ID. Approved refunds settle back to your original payment method within 5–7 business days.
              </p>
            </div>
          )}

          {/* Privacy Policy */}
          {activeTab === "privacy" && (
            <div>
              <h3 style={{ color: "#fff", marginBottom: "12px" }}>🛡️ Privacy Policy &amp; Data Governance</h3>
              <p>YBY RenewAudit is engineered ground-up around a <strong>Zero-Trust Client-Side Architecture</strong>:</p>

              <ul style={{ paddingLeft: "20px", marginTop: "12px", display: "flex", flexDirection: "column", gap: "8px" }}>
                <li><strong>🔒 100% In-Browser Web Worker Execution:</strong> All contract PDFs, usage CSVs, line items, and audit calculation rules execute locally inside Web Workers on your device.</li>
                <li><strong>🚫 Zero Raw File Submission:</strong> Confidential contract files, row data, PII, or audit findings are NEVER transmitted to cloud backends or third-party LLM APIs.</li>
                <li><strong>🔑 SHA-256 Web Crypto Fingerprinting:</strong> Document authenticity is fingerprinted locally on your device using Web Crypto API.</li>
                <li><strong>📡 Outbound Licensing Privacy Boundary:</strong> Outbound licensing verification contains strictly <code>{"{ licenseKey, deviceHash }"}</code>. Non-licensing metadata is strictly blocked.</li>
              </ul>

              {/* G7 Feedback Ledger Retention Policy */}
              <div style={{ marginTop: "20px", padding: "16px", background: "rgba(99, 102, 241, 0.06)", borderRadius: "10px", border: "1px solid rgba(99, 102, 241, 0.2)" }}>
                <h4 style={{ color: "#a5b4fc", marginBottom: "10px", fontSize: "0.95rem" }}>
                  📋 Feedback Ledger Data Retention &amp; Privacy Governance
                </h4>
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  <div style={{ padding: "12px", background: "rgba(245, 158, 11, 0.05)", borderRadius: "8px", border: "1px solid rgba(245, 158, 11, 0.15)" }}>
                    <strong style={{ color: "#fbbf24", fontSize: "0.85rem" }}>🟡 Consent-Enabled Contact Records — 180-Day Retention</strong>
                    <p style={{ margin: "6px 0 0 0", fontSize: "0.85rem" }}>
                      When users voluntarily opt in to post-audit correspondence (consent enabled), direct contact identifiers
                      (work email, full name, company name) are retained for a maximum of <strong>180 calendar days</strong> solely
                      for commercial partner verification and enterprise procurement follow-up; thereafter all contact identifiers
                      are permanently nullified.
                    </p>
                  </div>
                  <div style={{ padding: "12px", background: "rgba(16, 185, 129, 0.05)", borderRadius: "8px", border: "1px solid rgba(16, 185, 129, 0.15)" }}>
                    <strong style={{ color: "#34d399", fontSize: "0.85rem" }}>🟢 Anonymous Feedback Records — 365-Day Retention</strong>
                    <p style={{ margin: "6px 0 0 0", fontSize: "0.85rem" }}>
                      Anonymous feedback records (consent disabled) — comprising numerical ratings, redacted qualitative commentary,
                      and anonymized HMAC IP hashes — are retained for up to <strong>365 calendar days</strong> for statistical
                      audit-engine optimization before deletion.
                    </p>
                  </div>
                  <div style={{ padding: "12px", background: "rgba(244, 63, 94, 0.05)", borderRadius: "8px", border: "1px solid rgba(244, 63, 94, 0.15)" }}>
                    <strong style={{ color: "#fb7185", fontSize: "0.85rem" }}>🔴 Contract &amp; Audit Data — Never Stored</strong>
                    <p style={{ margin: "6px 0 0 0", fontSize: "0.85rem" }}>
                      Contract files, clauses, and monetary findings are <strong>never stored</strong>. All audit calculations
                      execute exclusively in-browser and are permanently discarded when the session ends.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Terms & Conditions */}
          {activeTab === "terms" && (
            <div>
              <h3 style={{ color: "#fff", marginBottom: "12px" }}>📜 Terms &amp; Conditions</h3>
              <p>Welcome to YBY RenewAudit. By accessing our platform, you agree to the following operational terms:</p>

              <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "12px" }}>
                <p><strong>1. Decision-Support Scope:</strong> YBY RenewAudit provides automated deterministic audit analysis, seat variance metrics, and vendor negotiation drafts strictly as <em>human decision-support tools</em>.</p>
                <p><strong>2. Human Lock &amp; Signing Authority:</strong> Users must verify all extracted terms in Step 2 (Human Lock). Final commercial signing authority and vendor negotiation decisions remain 100% with the enterprise procurement user.</p>
                <p><strong>3. Commercial Pricing &amp; Quotas:</strong> Services are billed per transparent fixed-fee introductory tiers (Free First Audit ₹0, Single Audit ₹2,999, Professional Monthly ₹4,999, Annual Professional ₹49,990). Quota consumption occurs atomically upon Gate G5 PASS.</p>
                <p><strong>4. Limitation of Liability:</strong> Platform outputs represent deterministic mathematical reconciliation against uploaded contract terms and do not constitute formal legal guarantees of vendor refund acceptance.</p>
              </div>
            </div>
          )}

          {/* Commercial Pricing */}
          {activeTab === "pricing" && (
            <div>
              <h3 style={{ color: "#fff", marginBottom: "12px" }}>💎 Commercial Pricing &amp; Tier Specifications</h3>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px", marginTop: "16px" }}>
                <div style={{ background: "rgba(6, 182, 212, 0.05)", padding: "14px", borderRadius: "8px", border: "1px solid rgba(6, 182, 212, 0.2)" }}>
                  <strong style={{ color: "var(--accent-cyan)" }}>1️⃣ Free First Audit</strong>
                  <div style={{ fontSize: "1.2rem", color: "#fff", margin: "6px 0" }}>₹0 / First Audit</div>
                  <p style={{ fontSize: "0.8rem", margin: 0 }}>Limit: 1 Audit Case per company.</p>
                </div>

                <div style={{ background: "rgba(16, 185, 129, 0.05)", padding: "14px", borderRadius: "8px", border: "1px solid rgba(16, 185, 129, 0.2)" }}>
                  <strong style={{ color: "var(--accent-emerald)" }}>2️⃣ Single Audit</strong>
                  <div style={{ fontSize: "1.2rem", color: "#fff", margin: "6px 0" }}>₹2,999 / One-Time</div>
                  <p style={{ fontSize: "0.8rem", margin: 0 }}>Limit: 1 Renewal Audit Case.</p>
                </div>

                <div style={{ background: "rgba(245, 158, 11, 0.05)", padding: "14px", borderRadius: "8px", border: "1px solid rgba(245, 158, 11, 0.2)" }}>
                  <strong style={{ color: "var(--accent-amber)" }}>3️⃣ Professional Monthly</strong>
                  <div style={{ fontSize: "1.2rem", color: "#fff", margin: "6px 0" }}>₹4,999 / Month</div>
                  <p style={{ fontSize: "0.8rem", margin: 0 }}>Limit: Max 5 Audit Cases / month.</p>
                </div>

                <div style={{ background: "rgba(244, 63, 94, 0.05)", padding: "14px", borderRadius: "8px", border: "1px solid rgba(244, 63, 94, 0.2)" }}>
                  <strong style={{ color: "var(--accent-rose)" }}>4️⃣ Annual Professional</strong>
                  <div style={{ fontSize: "1.2rem", color: "#fff", margin: "6px 0" }}>₹49,990 / Year</div>
                  <p style={{ fontSize: "0.8rem", margin: 0 }}>Limit: Max 60 Audit Cases / year.</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div
          style={{
            padding: "16px 24px",
            borderTop: "1px solid var(--border-color, rgba(255,255,255,0.1))",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            background: "rgba(0,0,0,0.2)"
          }}
        >
          <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
            © 2026 YBY RenewAudit • All Rights Reserved
          </span>
          <button className="btn btn-primary btn-sm" onClick={onClose}>
            ✓ Done
          </button>
        </div>
      </div>
    </div>
  );
}
