// tests/unit/feedback/feedback-validation.test.ts - Unit Tests for Feedback Validation Rules
import { describe, it, expect, beforeEach, vi } from "vitest";
import { handler as submitFeedbackHandler, deriveAnonymizedIpHash } from "../../../netlify/functions/feedback-submit";

describe("Feedback Validation & Integrity Unit Suite", () => {
  const TEST_SALT = "unit-test-hmac-salt-entropy-2026";

  beforeEach(() => {
    process.env.FEEDBACK_HMAC_SALT = TEST_SALT;
  });

  it("1. Method Guard: Rejects non-POST HTTP methods with 405 Method Not Allowed", async () => {
    const resGet = await submitFeedbackHandler({
      httpMethod: "GET",
      headers: {},
      body: null
    });
    expect(resGet.statusCode).toBe(405);
    const bodyGet = JSON.parse(resGet.body);
    expect(bodyGet.error).toBe("METHOD_NOT_ALLOWED");

    const resPut = await submitFeedbackHandler({
      httpMethod: "PUT",
      headers: {},
      body: JSON.stringify({ rating: 5, consentContact: false })
    });
    expect(resPut.statusCode).toBe(405);
  });

  it("2. JSON Syntax Guard: Returns 400 for malformed JSON request bodies", async () => {
    const res = await submitFeedbackHandler({
      httpMethod: "POST",
      headers: { "client-ip": "198.51.100.1" },
      body: "{ not-valid-json: true "
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toBe("INVALID_JSON");
  });

  it("3. Rating Boundaries: Rejects ratings < 1, > 5, non-integers, and missing rating", async () => {
    const invalidRatings = [0, 6, -1, 3.5, "5", null, undefined];

    for (const r of invalidRatings) {
      const res = await submitFeedbackHandler({
        httpMethod: "POST",
        headers: { "client-ip": "198.51.100.2" },
        body: JSON.stringify({ rating: r, consentContact: false })
      });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toBe("INVALID_RATING");
    }
  });

  it("4. Comment Length Guard: Rejects comments exceeding 1000 characters", async () => {
    const longComment = "A".repeat(1001);
    const res = await submitFeedbackHandler({
      httpMethod: "POST",
      headers: { "client-ip": "198.51.100.3" },
      body: JSON.stringify({
        rating: 4,
        comment: longComment,
        consentContact: false
      })
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toBe("COMMENT_TOO_LONG");
  });

  it("5. Consent Boolean Guard: Rejects non-boolean consentContact values", async () => {
    const res = await submitFeedbackHandler({
      httpMethod: "POST",
      headers: { "client-ip": "198.51.100.4" },
      body: JSON.stringify({
        rating: 5,
        consentContact: "yes" // String instead of boolean
      })
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toBe("INVALID_CONSENT");
  });

  it("6. Consent Enforcement: Rejects contactEmail when consentContact is false", async () => {
    const res = await submitFeedbackHandler({
      httpMethod: "POST",
      headers: { "client-ip": "198.51.100.5" },
      body: JSON.stringify({
        rating: 5,
        consentContact: false,
        contactEmail: "sneaky@enterprise.com" // Email provided without consent!
      })
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toBe("CONSENT_REQUIRED_FOR_EMAIL");
  });

  it("6b. Consent Enforcement: Rejects contactName and companyName when consentContact is false", async () => {
    const resName = await submitFeedbackHandler({
      httpMethod: "POST",
      headers: { "client-ip": "198.51.100.5" },
      body: JSON.stringify({
        rating: 5,
        consentContact: false,
        contactName: "Ramesh Patel"
      })
    });
    expect(resName.statusCode).toBe(400);
    expect(JSON.parse(resName.body).error).toBe("CONSENT_REQUIRED_FOR_CONTACT_INFO");

    const resCompany = await submitFeedbackHandler({
      httpMethod: "POST",
      headers: { "client-ip": "198.51.100.5" },
      body: JSON.stringify({
        rating: 5,
        consentContact: false,
        companyName: "Tata Consultancy Services"
      })
    });
    expect(resCompany.statusCode).toBe(400);
    expect(JSON.parse(resCompany.body).error).toBe("CONSENT_REQUIRED_FOR_CONTACT_INFO");
  });

  it("7. Email Format Validation: Rejects malformed email when consentContact is true", async () => {
    const invalidEmails = ["not-an-email", "@domain.com", "user@", "user@domain", "user@.com"];

    for (const email of invalidEmails) {
      const res = await submitFeedbackHandler({
        httpMethod: "POST",
        headers: { "client-ip": "198.51.100.6" },
        body: JSON.stringify({
          rating: 5,
          consentContact: true,
          contactEmail: email
        })
      });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toBe("INVALID_EMAIL_FORMAT");
    }
  });

  it("7b. Email Required with Consent: Rejects missing or empty contactEmail when consentContact is true", async () => {
    const resMissing = await submitFeedbackHandler({
      httpMethod: "POST",
      headers: { "client-ip": "198.51.100.6" },
      body: JSON.stringify({
        rating: 5,
        consentContact: true,
        contactName: "Ramesh Patel"
      })
    });
    expect(resMissing.statusCode).toBe(400);
    expect(JSON.parse(resMissing.body).error).toBe("EMAIL_REQUIRED_WITH_CONSENT");

    const resEmpty = await submitFeedbackHandler({
      httpMethod: "POST",
      headers: { "client-ip": "198.51.100.6" },
      body: JSON.stringify({
        rating: 5,
        consentContact: true,
        contactEmail: "   ",
        contactName: "Ramesh Patel"
      })
    });
    expect(resEmpty.statusCode).toBe(400);
    expect(JSON.parse(resEmpty.body).error).toBe("EMAIL_REQUIRED_WITH_CONSENT");
  });

  it("7c. Name & Company Validation: Rejects fields exceeding 128 characters or non-string types", async () => {
    const longName = "A".repeat(129);
    const resLongName = await submitFeedbackHandler({
      httpMethod: "POST",
      headers: { "client-ip": "198.51.100.6" },
      body: JSON.stringify({
        rating: 5,
        consentContact: true,
        contactEmail: "audit@enterprise.com",
        contactName: longName
      })
    });
    expect(resLongName.statusCode).toBe(400);
    expect(JSON.parse(resLongName.body).error).toBe("NAME_TOO_LONG");

    const longCompany = "B".repeat(129);
    const resLongCompany = await submitFeedbackHandler({
      httpMethod: "POST",
      headers: { "client-ip": "198.51.100.6" },
      body: JSON.stringify({
        rating: 5,
        consentContact: true,
        contactEmail: "audit@enterprise.com",
        companyName: longCompany
      })
    });
    expect(resLongCompany.statusCode).toBe(400);
    expect(JSON.parse(resLongCompany.body).error).toBe("COMPANY_TOO_LONG");

    const resBadTypeName = await submitFeedbackHandler({
      httpMethod: "POST",
      headers: { "client-ip": "198.51.100.6" },
      body: JSON.stringify({
        rating: 5,
        consentContact: true,
        contactEmail: "audit@enterprise.com",
        contactName: 12345
      })
    });
    expect(resBadTypeName.statusCode).toBe(400);
    expect(JSON.parse(resBadTypeName.body).error).toBe("INVALID_NAME");

    const resBadTypeCompany = await submitFeedbackHandler({
      httpMethod: "POST",
      headers: { "client-ip": "198.51.100.6" },
      body: JSON.stringify({
        rating: 5,
        consentContact: true,
        contactEmail: "audit@enterprise.com",
        companyName: { enterprise: true }
      })
    });
    expect(resBadTypeCompany.statusCode).toBe(400);
    expect(JSON.parse(resBadTypeCompany.body).error).toBe("INVALID_COMPANY");
  });

  it("8. Honeypot Spam Drop: Returns 200 OK immediately when hp_company is populated", async () => {
    const res = await submitFeedbackHandler({
      httpMethod: "POST",
      headers: { "client-ip": "198.51.100.7" },
      body: JSON.stringify({
        rating: 1,
        comment: "Spam bot submission",
        consentContact: false,
        hp_company: "Acme Spambot Corp"
      })
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.message).toBe("Feedback acknowledged.");
  });

  it("9. Fail-Closed HMAC Salt: Throws error and returns 500 when FEEDBACK_HMAC_SALT is missing", async () => {
    delete process.env.FEEDBACK_HMAC_SALT;

    const res = await submitFeedbackHandler({
      httpMethod: "POST",
      headers: { "client-ip": "198.51.100.8" },
      body: JSON.stringify({ rating: 5, consentContact: false })
    });

    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    expect(body.error).toBe("INTERNAL_CONFIGURATION_ERROR");
  });
});
