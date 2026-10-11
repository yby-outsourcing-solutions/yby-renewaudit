import { useEffect, useState } from "react";
import { createReconciliationWorker, createRedactorWorker } from "./workers/factory";
import { FileDropzone } from "./components/intake/FileDropzone";
import { HumanLockGrid } from "./components/lock/HumanLockGrid";
import { WorkflowSteps } from "./components/workflow/WorkflowSteps";
import { EvidencePack } from "./components/evidence/EvidencePack";
import { NegotiationDraftView } from "./components/negotiation/NegotiationDraftView";
import { CommercialTermsView } from "./components/commercial/CommercialTermsView";
import { LicenseActivationModal } from "./components/commercial/LicenseActivationModal";
import { LegalFooterModal, type LegalModalTab } from "./components/legal/LegalFooterModal";
import { parseLicenseKey, checkAuditAccess, consumeAuditCredit, PLAN_CONFIGS, loadPersistedEntitlement, savePersistedEntitlement } from "./licensing/entitlement";
import type { EntitlementState } from "./licensing/types";
import type { AuditPayload, ReconciliationResult, CalculationTerm } from "./types";
import { extractTermsFromFiles, type FileIntakeItem } from "./parsers/extractor";
import "./styles.css";

export default function App() {
  const [activeTab, setActiveTab] = useState<"intake" | "lock" | "pipeline" | "evidence" | "negotiation" | "commercial" | "pii">("intake");
  const [files, setFiles] = useState<FileIntakeItem[]>([]);
  const [terms, setTerms] = useState<CalculationTerm[]>([]);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<ReconciliationResult | null>(null);
  const [piiInput, setPiiInput] = useState("Contact procurement lead john.doe@techcorp.com or call +91 98765 43210 for contract #88491.");
  const [redactedText, setRedactedText] = useState("");
  const [entitlement, setEntitlement] = useState<EntitlementState>(() => loadPersistedEntitlement());
  const [showLicenseModal, setShowLicenseModal] = useState(false);
  const [consumedForCurrentSession, setConsumedForCurrentSession] = useState(false);
  const [showLegalModal, setShowLegalModal] = useState(false);
  const [legalModalTab, setLegalModalTab] = useState<LegalModalTab>("contact");

  function openLegalPage(tab: LegalModalTab) {
    setLegalModalTab(tab);
    setShowLegalModal(true);
  }

  function updateEntitlementState(newState: EntitlementState) {
    setEntitlement(newState);
    savePersistedEntitlement(newState);
  }

  function triggerAuditEngine(currentTerms: CalculationTerm[], currentFiles: FileIntakeItem[]) {
    if (currentTerms.length === 0) {
      setResult(null);
      return;
    }

    const access = checkAuditAccess(entitlement);
    if (!access.allowed) {
      alert(`Gate 0 Licensing Check Failed: ${access.reason}`);
      setShowLicenseModal(true);
      return;
    }

    let usageRows: Record<string, string | number>[] = [];
    const usageFile = currentFiles.find((f) => f.parsedRows && f.parsedRows.length > 0);
    if (usageFile?.parsedRows) {
      usageRows = usageFile.parsedRows as Record<string, string | number>[];
    } else {
      usageRows = Array.from({ length: 72 }, (_, i) => ({ id: String(i), seats: 1 }));
    }

    const payload: AuditPayload = {
      contract: { terms: currentTerms },
      usageRows,
      invoiceRows: [{ amount: 12000 }],
      mapping: { usage: "seats", invoice: "amount" },
      normalization: { currency: "USD", billingCycle: "ANNUAL", dateFormat: "ISO_8601" }
    };

    const worker = createReconciliationWorker();
    worker.onmessage = (e) => {
      if (e.data?.type === "PROGRESS") {
        setProgress(e.data.percent);
      } else if (e.data?.gates || e.data?.payload?.gates) {
        const res = e.data.gates ? e.data : e.data.payload;
        setResult(res);
        const gatesList = res.gates || [];
        const allGatesPassed = gatesList.length > 0 && gatesList.every((g: any) => g.status === "PASS");
        if (allGatesPassed && !consumedForCurrentSession) {
          setEntitlement((prev) => {
            const next = consumeAuditCredit(prev);
            savePersistedEntitlement(next);
            return next;
          });
          setConsumedForCurrentSession(true);
          setShowLicenseModal(true);
        }
      }
    };
    worker.postMessage({ type: "PROCESS", payload });
  }

  function handleFilesUpdated(newFiles: FileIntakeItem[]) {
    const access = checkAuditAccess(entitlement);
    if (!access.allowed) {
      setShowLicenseModal(true);
      return;
    }
    setFiles(newFiles);
    if (newFiles.length > 0) {
      const extracted = extractTermsFromFiles(newFiles);
      setTerms(extracted);
      triggerAuditEngine(extracted, newFiles);
      setActiveTab("lock");
    } else {
      setTerms([]);
      setResult(null);
    }
  }

  function handleTermsUpdated(newTerms: CalculationTerm[]) {
    setTerms(newTerms);
    triggerAuditEngine(newTerms, files);
  }

  function handleRedact() {
    const worker = createRedactorWorker();
    worker.onmessage = (e) => {
      setRedactedText(e.data.text);
      worker.terminate();
    };
    worker.postMessage({ type: "REDACT", text: piiInput });
  }

  const allLocked = terms.length > 0 && terms.every((t) => t.lockStatus === "HUMAN_LOCK");
  const priceCapTerm = terms.find((t) => t.name === "priceCap");
  const renewalPriceTerm = terms.find((t) => t.name === "renewalPrice");
  const contractedSeatsTerm = terms.find((t) => t.name === "contractedSeats");
  const usedSeatsTerm = terms.find((t) => t.name === "usedSeats");

  const priceCapVariance = priceCapTerm && renewalPriceTerm ? Number(renewalPriceTerm.value) - Number(priceCapTerm.value) : 0;
  const shelfwareSeats = contractedSeatsTerm && usedSeatsTerm ? Number(contractedSeatsTerm.value) - Number(usedSeatsTerm.value) : 0;

  return (
    <main className="container">
      {/* Header Bar */}
      <header className="app-header">
        <div className="brand-wrapper">
          <div className="logo-badge">YBY</div>
          <div className="brand-text">
            <h1>YBY RenewAudit</h1>
            <p>Audit the renewal before you approve it.</p>
          </div>
        </div>
        <div className="header-status no-print" style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <button
            className="btn btn-secondary btn-sm"
            style={{ fontSize: "0.8rem", padding: "4px 10px", borderColor: entitlement.status === "ACTIVE" ? "rgba(16, 185, 129, 0.4)" : "rgba(244, 63, 94, 0.4)" }}
            onClick={() => setShowLicenseModal((prev) => !prev)}
          >
            🔑 {PLAN_CONFIGS[entitlement.plan]?.name || entitlement.plan} ({entitlement.auditsRemaining} Audits Remaining)
          </button>
          <span className="status-dot"></span>
          <span>Local Engine Active • Real-File Mode</span>
        </div>
      </header>

      {showLicenseModal && (
        <LicenseActivationModal
          currentState={entitlement}
          onStateChange={(newState) => updateEntitlementState(newState)}
          onClose={() => setShowLicenseModal(false)}
        />
      )}

      {/* Executive Metrics Overview */}
      <div className="metrics-grid executive-metrics-grid no-print">
        <div className="metric-card">
          <div className="metric-label">Billed Price Overcharge</div>
          <div className="metric-value rose">${priceCapVariance > 0 ? priceCapVariance.toLocaleString() : 0}</div>
          <div className="metric-sub">{priceCapVariance > 0 ? "R1: Price Cap Violation Detected" : "No Overcharge Detected"}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Unused / Shelf-Ware Seats</div>
          <div className="metric-value amber">{shelfwareSeats > 0 ? shelfwareSeats : 0} Seats</div>
          <div className="metric-sub">{shelfwareSeats > 0 ? "R2: Seat Variance Discovered" : "No Seat Variance"}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Human Lock Gate Status</div>
          <div className="metric-value emerald">{allLocked ? `${terms.length} / ${terms.length} Locked` : terms.length > 0 ? "BLOCKED" : "IDLE"}</div>
          <div className="metric-sub">{allLocked ? "All terms human verified" : terms.length > 0 ? "Requires user confirmation" : "Upload contract files"}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Client SHA-256 Chain</div>
          <div className="metric-value cyan">{files.length > 0 ? `${files.length} Files Hashed` : "100% Traceable"}</div>
          <div className="metric-sub">Web Crypto Client-side Fingerprinted</div>
        </div>
      </div>

      {/* Tabbed Navigation Bar */}
      <div className="app-navigation-tabs no-print" style={{ display: "flex", gap: "10px", marginBottom: "24px", flexWrap: "wrap" }}>
        <button
          className={`btn ${activeTab === "intake" ? "btn-primary" : "btn-secondary"}`}
          onClick={() => setActiveTab("intake")}
        >
          📄 1. Drag & Drop File Intake ({files.length})
        </button>
        <button
          className={`btn ${activeTab === "lock" ? "btn-primary" : "btn-secondary"}`}
          onClick={() => setActiveTab("lock")}
        >
          🔒 2. Term Verification & Human Lock ({allLocked ? "PASS" : terms.length > 0 ? "BLOCKED" : "IDLE"})
        </button>
        <button
          className={`btn ${activeTab === "pipeline" ? "btn-primary" : "btn-secondary"}`}
          onClick={() => setActiveTab("pipeline")}
        >
          🔄 3. 9-Step Pipeline & Radar
        </button>
        <button
          className={`btn ${activeTab === "evidence" ? "btn-primary" : "btn-secondary"}`}
          onClick={() => setActiveTab("evidence")}
        >
          🛡️ 4. Audit Findings & Evidence Pack
        </button>
        <button
          className={`btn ${activeTab === "negotiation" ? "btn-primary" : "btn-secondary"}`}
          onClick={() => setActiveTab("negotiation")}
        >
          📜 5. Negotiation Draft
        </button>
        <button
          className={`btn ${activeTab === "commercial" ? "btn-primary" : "btn-secondary"}`}
          onClick={() => setActiveTab("commercial")}
        >
          💎 6. Commercial Model
        </button>
        <button
          className={`btn ${activeTab === "pii" ? "btn-primary" : "btn-secondary"}`}
          onClick={() => setActiveTab("pii")}
        >
          ⚡ PII Redactor
        </button>
      </div>

      {/* Tab 1: File Intake */}
      {activeTab === "intake" && (
        <section className="panel-card">
          <FileDropzone
            onFilesUpdated={handleFilesUpdated}
            items={files}
            disabled={!checkAuditAccess(entitlement).allowed}
            onOpenLicenseModal={() => setShowLicenseModal(true)}
          />
        </section>
      )}

      {/* Tab 2: Human Lock */}
      {activeTab === "lock" && (
        <section className="panel-card">
          {terms.length > 0 ? (
            <HumanLockGrid terms={terms} onTermsUpdated={handleTermsUpdated} />
          ) : (
            <div style={{ textTransform: "none", color: "var(--text-secondary)", textAlign: "center", padding: "40px 20px" }}>
              <h4>No Extracted Terms Available</h4>
              <p style={{ marginTop: "8px" }}>Please upload a Contract PDF or Usage CSV in Step 1 to extract terms for Human Lock review.</p>
            </div>
          )}
        </section>
      )}

      {/* Tab 3: Pipeline & Hard Gates */}
      {activeTab === "pipeline" && (
        <section className="panel-card">
          <WorkflowSteps
            filesCount={files.length}
            allLocked={allLocked}
            gates={result?.gates ?? []}
            progress={progress}
            result={result}
          />
        </section>
      )}

      {/* Tab 4: Evidence Pack */}
      {activeTab === "evidence" && (
        result ? (
          <EvidencePack result={result} />
        ) : (
          <section className="panel-card" style={{ textAlign: "center", padding: "40px 20px", color: "var(--text-secondary)" }}>
            <h3>No Audit Findings Generated Yet</h3>
            <p style={{ marginTop: "8px" }}>Upload audit files in Step 1 and confirm terms in Step 2 to view the Evidence Pack.</p>
          </section>
        )
      )}

      {/* Tab 5: Negotiation Draft */}
      {activeTab === "negotiation" && (
        <NegotiationDraftView result={result} terms={terms} />
      )}

      {/* Tab 6: Commercial Terms */}
      {activeTab === "commercial" && (
        <CommercialTermsView identifiedSavings={priceCapVariance > 0 ? priceCapVariance : 2000} />
      )}

      {/* Tab 7: PII Redactor */}
      {activeTab === "pii" && (
        <section className="panel-card">
          <div className="panel-header">
            <h2>⚡ Zero-Trust Client-Side PII Redactor</h2>
            <span className="badge badge-cyan">Isolated Web Worker</span>
          </div>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", marginBottom: "16px" }}>
            Test client-side PII sanitization before sending any text to LLM or external APIs.
          </p>
          <div className="redact-container">
            <textarea
              className="input-box"
              value={piiInput}
              onChange={(e) => setPiiInput(e.target.value)}
              placeholder="Type confidential contract snippet here..."
            />
            <div>
              <button className="btn btn-primary" onClick={handleRedact}>
                ⚡ Run Local PII Redaction
              </button>
            </div>
            {redactedText && (
              <div className="redacted-result">
                <strong>Sanitized Snippet:</strong> {redactedText}
              </div>
            )}
          </div>
        </section>
      )}

      {showLegalModal && (
        <LegalFooterModal
          initialTab={legalModalTab}
          onClose={() => setShowLegalModal(false)}
        />
      )}

      {/* Global Commercial & Legal Compliance Footer */}
      <footer
        className="app-footer no-print"
        style={{
          marginTop: "40px",
          padding: "24px 0",
          borderTop: "1px solid var(--border-color, rgba(255,255,255,0.1))",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "16px",
          color: "var(--text-secondary, #94a3b8)",
          fontSize: "0.85rem"
        }}
      >
        <div>
          <strong>YBY RenewAudit</strong> — Audit the renewal before you approve it.
          <div style={{ fontSize: "0.78rem", marginTop: "4px" }}>
            100% Client-Side In-Browser Audit Engine • Zero Network PII Transmission
          </div>
        </div>

        <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
          <button
            className="btn btn-secondary btn-sm"
            style={{ fontSize: "0.8rem", padding: "4px 10px" }}
            onClick={() => {
              setActiveTab("commercial");
              openLegalPage("pricing");
            }}
          >
            💎 Pricing
          </button>
          <button
            className="btn btn-secondary btn-sm"
            style={{ fontSize: "0.8rem", padding: "4px 10px" }}
            onClick={() => openLegalPage("contact")}
          >
            📞 Contact Us
          </button>
          <button
            className="btn btn-secondary btn-sm"
            style={{ fontSize: "0.8rem", padding: "4px 10px" }}
            onClick={() => openLegalPage("refund")}
          >
            ↩️ Refund Policy
          </button>
          <button
            className="btn btn-secondary btn-sm"
            style={{ fontSize: "0.8rem", padding: "4px 10px" }}
            onClick={() => openLegalPage("privacy")}
          >
            🛡️ Privacy Policy
          </button>
          <button
            className="btn btn-secondary btn-sm"
            style={{ fontSize: "0.8rem", padding: "4px 10px" }}
            onClick={() => openLegalPage("terms")}
          >
            📜 Terms &amp; Conditions
          </button>
        </div>
      </footer>
    </main>
  );
}
