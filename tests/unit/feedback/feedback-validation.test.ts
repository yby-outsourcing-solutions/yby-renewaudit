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
