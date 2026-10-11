import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { executeLocalReconciliationSync } from "../../src/api/auditWorkflow";
import { consumeAuditCredit, parseLicenseKey, checkAuditAccess } from "../../src/licensing/entitlement";
import type { CalculationTerm, ReconciliationResult } from "../../src/types";

describe("PDF Print Isolation & Report Presentation Regression Suite", () => {
  it("1. styles.css strictly isolates Evidence Pack and hides all commercial entitlement & navigation UI in @media print", () => {
    const cssPath = path.resolve(__dirname, "../../src/styles.css");
    const cssContent = fs.readFileSync(cssPath, "utf-8");

    // Extract @media print block
    const printBlockMatch = cssContent.match(/@media\s+print\s*\{([\s\S]*?)\n\}/);
    expect(printBlockMatch).not.toBeNull();
    const printBlock = printBlockMatch![1];

    // Assert mandatory isolation selectors are hidden with display: none !important
    expect(printBlock).toContain(".no-print");
    expect(printBlock).toContain(".license-modal-container");
    expect(printBlock).toContain(".app-navigation-tabs");
    expect(printBlock).toContain(".executive-metrics-grid");
    expect(printBlock).toContain(".app-footer");
    expect(printBlock).toContain(".header-status");
    expect(printBlock).toContain("display: none !important");

    // Assert printable audit findings and evidence panel are explicitly styled
    expect(printBlock).toContain(".evidence-pack-panel");
    expect(printBlock).toContain(".finding-card");
    expect(printBlock).toContain(".formula-box");
    expect(printBlock).toContain(".source-tag");
    expect(printBlock).toContain("page-break-inside: avoid");
  });

  it("2. LicenseActivationModal has dedicated license-modal-container and no-print classes", () => {
    const modalPath = path.resolve(__dirname, "../../src/components/commercial/LicenseActivationModal.tsx");
    const modalContent = fs.readFileSync(modalPath, "utf-8");

    // Must have the dedicated isolation class
    expect(modalContent).toContain('className="license-modal-container no-print"');
  });

  it("3. EvidencePack has evidence-pack-panel class and no-print on print/export buttons", () => {
    const evidencePath = path.resolve(__dirname, "../../src/components/evidence/EvidencePack.tsx");
    const evidenceContent = fs.readFileSync(evidencePath, "utf-8");

    expect(evidenceContent).toContain('className="panel-card evidence-pack-panel"');
    expect(evidenceContent).toContain('className="no-print"');
  });

  it("4. App.tsx isolates header status, metrics grid, tabs, and footer with no-print", () => {
    const appPath = path.resolve(__dirname, "../../src/App.tsx");
    const appContent = fs.readFileSync(appPath, "utf-8");

    expect(appContent).toContain('className="header-status no-print"');
    expect(appContent).toContain('className="metrics-grid executive-metrics-grid no-print"');
    expect(appContent).toContain('className="app-navigation-tabs no-print"');
    expect(appContent).toContain('className="app-footer no-print"');
  });

  it("5. Completed audit findings (R1, R2, SHA-256 fingerprint, source file) remain 100% intact after quota consumption", () => {
    // 1. Initial State: Single Audit with 1 credit
    let entitlement = parseLicenseKey("YBY-SINGLE-TEST-001");
    expect(entitlement.status).toBe("ACTIVE");
    expect(entitlement.auditsRemaining).toBe(1);

    // 2. Verified Audit Execution
    const terms: CalculationTerm[] = [
      { id: "1", name: "priceCap", value: 10000, lockStatus: "HUMAN_LOCK", sourceRef: { fileName: "contract_msa.pdf", fileSha256: "hash_msa_123", page: 1 } },
      { id: "2", name: "renewalPrice", value: 12000, lockStatus: "HUMAN_LOCK", sourceRef: { fileName: "contract_msa.pdf", fileSha256: "hash_msa_123", page: 1 } },
      { id: "3", name: "contractedSeats", value: 100, lockStatus: "HUMAN_LOCK", sourceRef: { fileName: "contract_msa.pdf", fileSha256: "hash_msa_123", page: 2 } },
      { id: "4", name: "usedSeats", value: 72, lockStatus: "HUMAN_LOCK", sourceRef: { fileName: "usage_report.csv", fileSha256: "hash_usage_456", row: 15 } }
    ];

    const result: ReconciliationResult = executeLocalReconciliationSync(terms, [{ seats: 72 }]);
    expect(result.blocked).toBe(false);
    expect(result.evidence).toHaveLength(2);

    // Verify R1 finding details
    const r1 = result.evidence.find((e) => e.ruleId === "R1")!;
    expect(r1).toBeDefined();
    expect(r1.delta).toBe(2000);
    expect(r1.title).toContain("Price Cap Violation");
    expect(r1.formula).toBe("12000 - 10000 = 2000");
    expect(r1.source.fileName).toBe("contract_msa.pdf");
    expect(r1.sourceHash).toBe("hash_msa_123");
    expect(r1.source.page).toBe(1);

    // Verify R2 finding details
    const r2 = result.evidence.find((e) => e.ruleId === "R2")!;
    expect(r2).toBeDefined();
    expect(r2.delta).toBe(28);
    expect(r2.title).toContain("Shelf-ware Seat Variance");
    expect(r2.formula).toBe("100 - 72 = 28");
    expect(r2.source.fileName).toBe("usage_report.csv");
    expect(r2.sourceHash).toBe("hash_usage_456");
    expect(r2.source.row).toBe(15);

    // 3. Post-Audit Quota Consumption: 1 -> 0
    entitlement = consumeAuditCredit(entitlement);
    expect(entitlement.auditsRemaining).toBe(0);
    expect(entitlement.auditsUsed).toBe(1);
    expect(entitlement.status).toBe("SINGLE_AUDIT_ALREADY_CONSUMED");

    // 4. Assert: Quota is exhausted for NEW audits (Gate 0 blocked)
    const access = checkAuditAccess(entitlement);
    expect(access.allowed).toBe(false);
    expect(access.reason).toContain("Single Audit token already consumed");

    // 5. Assert: The completed audit result and evidence pack remain 100% readable and printable
    expect(result.evidence).toHaveLength(2);
    expect(result.evidence[0].delta).toBe(2000);
    expect(result.evidence[1].delta).toBe(28);
  });
});
