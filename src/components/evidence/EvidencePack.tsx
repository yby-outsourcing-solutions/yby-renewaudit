import type { ReconciliationResult } from "../../types";
import { PostAuditFeedbackWidget } from "../feedback/PostAuditFeedbackWidget";

export function EvidencePack({ result }: { result: ReconciliationResult }) {
  function handlePrint() {
    window.print();
  }

  function handleExportJSON() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(result, null, 2));
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `YBY_RenewAudit_Evidence_Pack_${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  }

  return (
    <section className="panel-card evidence-pack-panel">
      <div className="panel-header">
        <h2>
          🛡️ Evidence Pack & Audit Findings
        </h2>
        <div style={{ display: "flex", gap: "10px" }} className="no-print">
          <button className="btn btn-secondary btn-sm" onClick={handleExportJSON}>
            📥 Export JSON Evidence
          </button>
          <button className="btn btn-primary btn-sm" onClick={handlePrint}>
            🖨️ Print / Save PDF
          </button>
        </div>
      </div>

      {result.blocked ? (
        <div className="badge badge-rose" style={{ padding: "12px 16px", borderRadius: "8px", marginBottom: "16px" }}>
          ⚠️ RECONCILIATION BLOCKED: Hard-gate requirement not satisfied.
        </div>
      ) : (
        <div className="badge badge-emerald" style={{ padding: "10px 14px", borderRadius: "8px", marginBottom: "16px", display: "inline-block" }}>
          ✅ AUDIT COMPLETE — 100% Deterministic Findings Verified
        </div>
      )}

      {result.evidence.map((e) => (
        <article className={`finding-card ${e.severity}`} key={`${e.ruleId}-${e.sourceHash}-${e.formula}`}>
          <div className="finding-header">
            <div>
              <span className={`badge ${e.severity === "HIGH" ? "badge-rose" : "badge-amber"}`} style={{ marginRight: "8px" }}>
                {e.severity} RISK
              </span>
              <strong className="finding-title">{e.ruleId}: {e.title}</strong>
            </div>
            <div className="finding-delta">
              +{e.ruleId === "R1" ? `$${e.delta.toLocaleString()}` : `${e.delta} Seats`}
            </div>
          </div>

          <div className="formula-box">
            🧮 Formula Trail: {e.formula}
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: "16px", fontSize: "0.85rem", color: "var(--text-secondary)", marginTop: "12px" }}>
            <div>
              📄 <strong>Source File:</strong> <span className="source-tag">{e.source.fileName}</span>
            </div>
            <div>
              🔑 <strong>SHA-256 Fingerprint:</strong> <span className="source-tag">{e.sourceHash.substring(0, 16)}...</span>
            </div>
            <div>
              📍 <strong>Location Ref:</strong> Page {e.source.page ?? "N/A"} / Row {e.source.row ?? "N/A"}
            </div>
          </div>
        </article>
      ))}
      <PostAuditFeedbackWidget />
    </section>
  );
}
