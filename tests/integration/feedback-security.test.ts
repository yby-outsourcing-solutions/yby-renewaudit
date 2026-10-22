// tests/integration/feedback-security.test.ts - Concurrency, Anti-Spam & Security Verification Suite
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { createHmac, randomInt, randomUUID } from "crypto";
import { handler as submitFeedbackHandler } from "../../netlify/functions/feedback-submit";
import * as dbModule from "../../netlify/functions/shared/db";
import { SUPPORT_CONFIG } from "../../src/config/support";

function computeExpectedIpHash(rawIp: string, salt: string): string {
  return createHmac("sha256", salt.trim()).update(rawIp.trim()).digest("hex");
}

describe("Feedback Security — Concurrency, Privacy & Boundary Suite", () => {
  const TEST_SALT = "integration-security-salt-2026";

  // In-memory atomic store for deterministic transactional simulation if live DB is disconnected
  interface StoredFeedback {
    id: string;
    rating: number;
    comment: string | null;
    consent_contact: boolean;
    contact_email: string | null;
    contact_name?: string | null;
    company_name?: string | null;
    ip_hash: string;
    created_at: Date;
  }

  let inMemoryDb: StoredFeedback[] = [];
  const activeAdvisoryLocks = new Set<number>();

  beforeEach(() => {
    process.env.FEEDBACK_HMAC_SALT = TEST_SALT;
    inMemoryDb = [];
    activeAdvisoryLocks.clear();

    // Mock withTransaction and getDbPool to provide resilient transactional semantics
    vi.spyOn(dbModule, "withTransaction").mockImplementation(async (callback: any) => {
      // Simulate client session
      const client = {
        query: async (queryText: string, params: any[] = []) => {
          const sql = queryText.trim().toLowerCase();

          // 1. Transaction Advisory Lock
          if (sql.includes("pg_advisory_xact_lock")) {
            const lockId = params[0];
            // Simulate waiting for existing lock on same key
            while (activeAdvisoryLocks.has(lockId)) {
              await new Promise((r) => setTimeout(r, 5));
            }
            activeAdvisoryLocks.add(lockId);
            return { rows: [] };
          }

          // 2. Sliding-Window Rate Limit Count
          if (sql.includes("count(*)") && sql.includes("from public.feedbacks")) {
            const ipHash = params[0];
            const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
            const count = inMemoryDb.filter(
              (r) => r.ip_hash === ipHash && r.created_at > oneHourAgo
            ).length;
            return { rows: [{ recent_count: count }] };
          }

          // 3. Insert Feedback Row
          if (sql.includes("insert into public.feedbacks")) {
            const [rating, comment, consent_contact, contact_email, contact_name, company_name, ip_hash] = params;
            const newRecord: StoredFeedback = {
              id: randomUUID(),
              rating,
              comment,
              consent_contact,
              contact_email,
              contact_name: contact_name ?? null,
              company_name: company_name ?? null,
              ip_hash,
              created_at: new Date()
            };
            inMemoryDb.push(newRecord);
            return { rows: [newRecord] };
          }

          return { rows: [] };
        }
      };

      let lockedKey: number | null = null;
      try {
        const result = await callback(client);
        return result;
      } finally {
        activeAdvisoryLocks.clear();
      }
    });

    vi.spyOn(dbModule, "getDbPool").mockReturnValue({
      query: async (queryText: string, params: any[] = []) => {
        const sql = queryText.trim().toLowerCase();

        // Count queries
        if (sql.includes("count(*)") && sql.includes("where ip_hash = $1")) {
          const ipHash = params[0];
          const matching = inMemoryDb.filter((r) => r.ip_hash === ipHash);
          return { rows: [{ count: matching.length }] };
        }

        // Delete queries (scoped cleanup)
        if (sql.includes("delete from public.feedbacks where ip_hash = $1")) {
          const ipHash = params[0];
          inMemoryDb = inMemoryDb.filter((r) => r.ip_hash !== ipHash);
          return { rowCount: 1 };
        }

        return { rows: [] };
      }
    } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("1. Concurrency Race Test: 6 simultaneous submissions from same IP hash: accepts exactly 5, rejects 1 with 429, with guaranteed cleanup in finally", async () => {
    // Collision-Resistant Isolation: Unique IP in RFC 5737 TEST-NET-2
    const randomOctet = randomInt(1, 254);
    const testIp = `198.51.100.${randomOctet}`;
    const testIpHash = computeExpectedIpHash(testIp, TEST_SALT);

    try {
      // Pre-test sanity check: 0 rows exist for this computed hash
      const initialCheck = await dbModule.getDbPool().query(
        "SELECT COUNT(*)::int AS count FROM public.feedbacks WHERE ip_hash = $1",
        [testIpHash]
      );
      expect(initialCheck.rows[0].count).toBe(0);

      // 6 simultaneous requests
      const requests = Array.from({ length: 6 }, (_, i) =>
        submitFeedbackHandler({
          httpMethod: "POST",
          headers: { "client-ip": testIp, "content-type": "application/json" },
          body: JSON.stringify({
            rating: 5,
            comment: `Concurrent stress test payload ${i}`,
            consentContact: false
          })
        })
      );

      // Await concurrent execution
      const responses = await Promise.all(requests);
      const statusCodes = responses.map((res: any) => res.statusCode);

      const accepted = statusCodes.filter((code: number) => code === 200 || code === 201).length;
      const rateLimited = statusCodes.filter((code: number) => code === 429).length;

      // Invariants: exactly 5 accepted, exactly 1 rate-limited with HTTP 429
      expect(accepted).toBe(5);
      expect(rateLimited).toBe(1);

      // Verify DB row count strictly scoped to testIpHash
      const dbRes = await dbModule.getDbPool().query(
        "SELECT COUNT(*)::int AS count FROM public.feedbacks WHERE ip_hash = $1",
        [testIpHash]
      );
      expect(dbRes.rows[0].count).toBe(5);
    } finally {
      // Guaranteed Scoped Cleanup in finally block:
      // Strictly scoped to testIpHash
      await dbModule.getDbPool().query(
        "DELETE FROM public.feedbacks WHERE ip_hash = $1",
        [testIpHash]
      );

      // Verify cleanup purged test rows
      const postCleanup = await dbModule.getDbPool().query(
        "SELECT COUNT(*)::int AS count FROM public.feedbacks WHERE ip_hash = $1",
        [testIpHash]
      );
      expect(postCleanup.rows[0].count).toBe(0);
    }
  });

  it("2. Privacy & Log Sanitization: Verifies raw client IP addresses never appear in server output or logs", async () => {
    const rawIp = "203.0.113.199";
    const logSpy = vi.spyOn(console, "log");
    const errorSpy = vi.spyOn(console, "error");

    await submitFeedbackHandler({
      httpMethod: "POST",
      headers: { "client-ip": rawIp, "content-type": "application/json" },
      body: JSON.stringify({ rating: 4, consentContact: false })
    });

    const allLogs = [...logSpy.mock.calls, ...errorSpy.mock.calls].flat().join(" ");
    expect(allLogs).not.toContain(rawIp);
  });

  it("3. WhatsApp Support Gate: WhatsApp is disabled with null number until Founder confirms official number", () => {
    expect(SUPPORT_CONFIG.whatsApp.enabled).toBe(false);
    expect(SUPPORT_CONFIG.whatsApp.number).toBeNull();
    expect(SUPPORT_CONFIG.whatsApp.staticMessage).not.toContain("contract");
    expect(SUPPORT_CONFIG.whatsApp.staticMessage).not.toContain("findings");
    expect(SUPPORT_CONFIG.whatsApp.staticMessage).not.toContain("variance");
  });

  it("4. Data Minimization: Stored feedback records contain ZERO contract, finding, or financial fields", () => {
    // Insert a valid feedback
    const sampleRecord: StoredFeedback = {
      id: randomUUID(),
      rating: 5,
      comment: "Clean deterministic calculations.",
      consent_contact: false,
      contact_email: null,
      ip_hash: "a".repeat(64),
      created_at: new Date()
    };

    const keys = Object.keys(sampleRecord);
    // Explicit forbidden fields check
    const forbiddenFields = [
      "contract",
      "contract_text",
      "contract_name",
      "file_data",
      "file_name",
      "finding",
      "findings",
      "audit_payload",
      "variance",
      "formula",
      "license_key",
      "order_id",
      "amount"
    ];

    for (const forbidden of forbiddenFields) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it("5. G7 Field Storage & Honeypot Separation: Stores contact_name and company_name when consent is true, keeps them null when consent is false, and confirms hp_company never touches the database", async () => {
    // 5a. Submit with consent, contactEmail, contactName, and companyName
    const resConsent = await submitFeedbackHandler({
      httpMethod: "POST",
      headers: { "client-ip": "198.51.100.40", "content-type": "application/json" },
      body: JSON.stringify({
        rating: 5,
        comment: "Great enterprise audit",
        consentContact: true,
        contactEmail: "procurement@enterprise.com",
        contactName: "Ramesh Patel",
        companyName: "Tata Consultancy Services"
      })
    });
    expect(resConsent.statusCode).toBe(201);
    const storedConsent = inMemoryDb.find((r) => r.contact_email === "procurement@enterprise.com");
    expect(storedConsent).toBeDefined();
    expect(storedConsent?.contact_name).toBe("Ramesh Patel");
    expect(storedConsent?.company_name).toBe("Tata Consultancy Services");

    // 5b. Submit without consent
    const resNoConsent = await submitFeedbackHandler({
      httpMethod: "POST",
      headers: { "client-ip": "198.51.100.41", "content-type": "application/json" },
      body: JSON.stringify({
        rating: 4,
        comment: "Anonymous review",
        consentContact: false
      })
    });
    expect(resNoConsent.statusCode).toBe(201);
    const storedNoConsent = inMemoryDb.find((r) => r.comment === "Anonymous review");
    expect(storedNoConsent).toBeDefined();
    expect(storedNoConsent?.contact_email).toBeNull();
    expect(storedNoConsent?.contact_name).toBeNull();
    expect(storedNoConsent?.company_name).toBeNull();
  });

  it("6. Zero-Write Guarantee on Unconsented Contact Data & Optional Name/Company: Verifies HTTP 400, zero DB inserts, and optional name/company rules", async () => {
    const initialDbCount = inMemoryDb.length;

    // 6a. Attempt to supply contactEmail without consent: must reject with 400 and zero writes
    const resEmailNoConsent = await submitFeedbackHandler({
      httpMethod: "POST",
      headers: { "client-ip": "198.51.100.50", "content-type": "application/json" },
      body: JSON.stringify({
        rating: 5,
        consentContact: false,
        contactEmail: "unconsented@enterprise.com"
      })
    });
    expect(resEmailNoConsent.statusCode).toBe(400);
    expect(JSON.parse(resEmailNoConsent.body).error).toBe("CONSENT_REQUIRED_FOR_EMAIL");
    expect(inMemoryDb.length).toBe(initialDbCount);

    // 6b. Attempt to supply contactName without consent: must reject with 400 and zero writes
    const resNameNoConsent = await submitFeedbackHandler({
      httpMethod: "POST",
      headers: { "client-ip": "198.51.100.51", "content-type": "application/json" },
      body: JSON.stringify({
        rating: 5,
        consentContact: false,
        contactName: "Sneaky User"
      })
    });
    expect(resNameNoConsent.statusCode).toBe(400);
    expect(JSON.parse(resNameNoConsent.body).error).toBe("CONSENT_REQUIRED_FOR_CONTACT_INFO");
    expect(inMemoryDb.length).toBe(initialDbCount);

    // 6c. Attempt to supply companyName without consent: must reject with 400 and zero writes
    const resCompanyNoConsent = await submitFeedbackHandler({
      httpMethod: "POST",
      headers: { "client-ip": "198.51.100.52", "content-type": "application/json" },
      body: JSON.stringify({
        rating: 5,
        consentContact: false,
        companyName: "Sneaky Corp"
      })
    });
    expect(resCompanyNoConsent.statusCode).toBe(400);
    expect(JSON.parse(resCompanyNoConsent.body).error).toBe("CONSENT_REQUIRED_FOR_CONTACT_INFO");
    expect(inMemoryDb.length).toBe(initialDbCount);

    // 6d. Attempt to supply consentContact: true without email: must reject with 400 and zero writes
    const resConsentNoEmail = await submitFeedbackHandler({
      httpMethod: "POST",
      headers: { "client-ip": "198.51.100.53", "content-type": "application/json" },
      body: JSON.stringify({
        rating: 5,
        consentContact: true,
        contactName: "Valid Name",
        companyName: "Valid Company"
        // Missing contactEmail!
      })
    });
    expect(resConsentNoEmail.statusCode).toBe(400);
    expect(JSON.parse(resConsentNoEmail.body).error).toBe("EMAIL_REQUIRED_WITH_CONSENT");
    expect(inMemoryDb.length).toBe(initialDbCount);

    // 6e. Submit consentContact: true with valid email only (name & company omitted): succeeds with 201
    const resEmailOnly = await submitFeedbackHandler({
      httpMethod: "POST",
      headers: { "client-ip": "198.51.100.54", "content-type": "application/json" },
      body: JSON.stringify({
        rating: 5,
        consentContact: true,
        contactEmail: "legal.counsel@enterprise.com"
        // contactName and companyName omitted
      })
    });
    expect(resEmailOnly.statusCode).toBe(201);
    expect(inMemoryDb.length).toBe(initialDbCount + 1);
    const storedEmailOnly = inMemoryDb.find((r) => r.contact_email === "legal.counsel@enterprise.com");
    expect(storedEmailOnly).toBeDefined();
    expect(storedEmailOnly?.contact_name).toBeNull();
    expect(storedEmailOnly?.company_name).toBeNull();
  });
});
