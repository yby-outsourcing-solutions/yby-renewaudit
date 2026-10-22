import { useState } from "react";
import { buildNegotiationDraft } from "../../engines/negotiation/builder";
import type { CalculationTerm, ReconciliationResult } from "../../types";

interface NegotiationDraftViewProps {
  result: ReconciliationResult | null;
  terms: CalculationTerm[];
}

export function NegotiationDraftView({ result, terms }: NegotiationDraftViewProps) {
  const [copied, setCopied] = useState(false);
  const draft = buildNegotiationDraft(result, terms);

  function handleCopyText() {
    let textContent = `=====================================================\nYBY RENEWAUDIT — VENDOR NEGOTIATION DRAFT & POSITION\n=====================================================\n\n`;
    textContent += `Generated: ${draft.generatedAt}\n`;
    textContent += `Audit Status: ${draft.overallStatus}\n`;
    textContent += `Human Lock Verified: ${draft.isHumanLocked ? "YES (100% Terms Confirmed)" : "NO"}\n`;
    textContent += `Total Price Overcharge Ask: $${draft.totalOverchargeAmount.toLocaleString()}\n`;
    textContent += `Total Seat De-escalation Ask: ${draft.totalShelfwareSeats} Seats\n\n`;
    textContent += `-----------------------------------------------------\n`;
    textContent += `EXECUTIVE AUDIT FINDINGS & VENDOR POSITIONS\n`;
    textContent += `-----------------------------------------------------\n\n`;

    draft.items.forEach((item, index) => {
      textContent += `[ITEM ${index + 1}] ${item.ruleId}: ${item.title}\n`;
      textContent += `Financial Impact: ${item.financialImpactFormatted}\n`;
      textContent += `Vendor Position: ${item.negotiationPosition}\n`;
      textContent += `Suggested Ask: ${item.suggestedAsk}\n`;
      textContent += `Formula Trail: ${item.formulaTrail}\n`;
      textContent += `Source File: ${item.sourceFile}\n`;
      textContent += `SHA-256 Fingerprint: ${item.sourceHash}\n`;
      textContent += `Location Ref: ${item.locationRef}\n`;
      if (item.supportingTerms.length > 0) {
        textContent += `Supporting Locked Terms: ${item.supportingTerms.join(", ")}\n`;
      }
      textContent += `\n`;
    });

    textContent += `-----------------------------------------------------\n`;
    textContent += `DISCLAIMER: Generated deterministically from client-side SHA-256 evidence chain and human-locked terms by YBY RenewAudit.\n`;

    navigator.clipboard.writeText(textContent).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  }

  function handleExportJSON() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(draft, null, 2));
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `YBY_Negotiation_Draft_${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  }

  function handlePrint() {
    window.print();
  }

  if (!result || draft.items.length === 0) {
    return (
      <section className="panel-card" style={{ textAlign: "center", padding: "40px 20px" }}>
        <h3>📜 Vendor Negotiation Draft</h3>
        <p style={{ color: "var(--text-secondary)", marginTop: "8px" }}>
          No negotiation positions available. Upload contract files in Step 1 and verify terms in Step 2 to build the Negotiation Draft.
        </p>
      </section>
    );
  }

  return (
    <section className="panel-card">
      {/* Header & Actions */}
      <div className="panel-header">
        <div>
          <h2>📜 Vendor Negotiation Draft & Position Statement</h2>
          <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginTop: "4px" }}>
            Evidence-Backed Executive Counter-Proposals for Procurement Negotiations
          </div>
        </div>
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
          <button className="btn btn-secondary btn-sm" onClick={handleCopyText}>
            {copied ? "✅ Copied to Clipboard!" : "📋 Copy Draft Text"}
          </button>
          <button className="btn btn-secondary btn-sm" onClick={handleExportJSON}>
            📥 Export JSON Brief
          </button>
          <button className="btn btn-primary btn-sm" onClick={handlePrint}>
            🖨️ Print / Save Draft PDF
          </button>
        </div>
      </div>

      {/* Status Bar */}
      <div style={{ display: "flex", gap: "12px", marginBottom: "20px", flexWrap: "wrap" }}>
        <span className={`badge ${draft.overallStatus === "PASS" ? "badge-emerald" : "badge-rose"}`}>
          {draft.overallStatus === "PASS" ? "✅ AUDIT PASSED" : "⚠️ AUDIT BLOCKED"}
        </span>
        <span className={`badge ${draft.isHumanLocked ? "badge-cyan" : "badge-amber"}`}>
          {draft.isHumanLocked ? "🔒 100% TERMS HUMAN LOCKED" : "⚠️ HUMAN LOCK PENDING"}
        </span>
      </div>

      {/* Executive Impact Metrics */}
      <div className="metrics-grid" style={{ marginBottom: "24px" }}>
        <div className="metric-card">
          <div className="metric-label">Total Overcharge Recovery Ask</div>
          <div className="metric-value rose">${draft.totalOverchargeAmount.toLocaleString()}</div>
          <div className="metric-sub">Billed Price Variance Credit</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Seat De-escalation Target</div>
          <div className="metric-value amber">{draft.totalShelfwareSeats} Seats</div>
          <div className="metric-sub">Unutilized Entitlement Reduction</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Actionable Negotiation Items</div>
          <div className="metric-value cyan">{draft.items.length} Positions</div>
          <div className="metric-sub">Evidence-backed Counter-claims</div>
        </div>
      </div>

      {/* Negotiation Items */}
      {draft.items.map((item, idx) => {
        const rawHash = item.sourceHash || "";
        const compactHash = rawHash.length > 16 ? `${rawHash.substring(0, 16)}...` : rawHash;
        return (
          <article className={`finding-card ${item.severity}`} key={`${item.ruleId}-${idx}`}>
            <div className="finding-header">
              <div>
                <span className={`badge ${item.severity === "HIGH" ? "badge-rose" : "badge-amber"}`} style={{ marginRight: "8px" }}>
                  POSITION {idx + 1} • {item.ruleId}
                </span>
                <strong className="finding-title">{item.title}</strong>
              </div>
              <div className="finding-delta">{item.financialImpactFormatted}</div>
            </div>

            <div style={{ marginTop: "12px", background: "var(--surface-color, rgba(255,255,255,0.03))", padding: "14px", borderRadius: "8px", borderLeft: "3px solid var(--accent-cyan, #06b6d4)" }}>
              <div style={{ fontWeight: 600, color: "var(--text-primary)", marginBottom: "4px" }}>🏢 Vendor Position Statement:</div>
              <p style={{ color: "var(--text-secondary)", fontSize: "0.95rem", lineHeight: "1.5" }}>{item.negotiationPosition}</p>
            </div>

            <div style={{ marginTop: "12px", background: "var(--surface-color, rgba(255,255,255,0.03))", padding: "14px", borderRadius: "8px", borderLeft: "3px solid var(--accent-emerald, #10b981)" }}>
              <div style={{ fontWeight: 600, color: "var(--text-primary)", marginBottom: "4px" }}>🎯 Suggested Actionable Ask:</div>
              <p style={{ color: "var(--text-primary)", fontSize: "0.95rem", lineHeight: "1.5" }}>{item.suggestedAsk}</p>
            </div>

            <div className="formula-box" style={{ marginTop: "12px" }}>
              🧮 <strong>Evidence Formula Trail:</strong> {item.formulaTrail}
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: "16px", fontSize: "0.85rem", color: "var(--text-secondary)", marginTop: "12px" }}>
              <div>📄 <strong>Source File:</strong> <span className="source-tag">{item.sourceFile}</span></div>
              <div>
                🔑 <strong>SHA-256 Fingerprint:</strong>{" "}
                <span className="source-tag sha256-tag" title={rawHash}>
                  <span className="sha256-screen">{compactHash}</span>
                  <span className="sha256-print">{rawHash}</span>
                </span>
              </div>
              <div>📍 <strong>Ref:</strong> {item.locationRef}</div>
              {item.supportingTerms.length > 0 && (
                <div>🔒 <strong>Locked Terms:</strong> <span className="source-tag">{item.supportingTerms.join(", ")}</span></div>
              )}
            </div>
          </article>
        );
      })}

      <footer style={{ marginTop: "24px", paddingTop: "16px", borderTop: "1px solid var(--border-color, rgba(255,255,255,0.1))", fontSize: "0.8rem", color: "var(--text-secondary)", textAlign: "center" }}>
        🛡️ <strong>Evidence Notice:</strong> This negotiation draft is generated deterministically from client-side SHA-256 file fingerprints and human-locked terms. Zero external API calls were made.
      </footer>
    </section>
  );
}
