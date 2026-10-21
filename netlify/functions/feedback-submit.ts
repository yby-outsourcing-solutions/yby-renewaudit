// netlify/functions/feedback-submit.ts - Secure Post-Audit Feedback Submission Endpoint
import { createHmac } from "crypto";
import { withTransaction } from "./shared/db";

interface FeedbackSubmissionPayload {
  rating: number;
  comment?: string;
  consentContact: boolean;
  contactEmail?: string;
  hp_company?: string; // Honeypot field for bot protection
}

const RFC5322_EMAIL_REGEX = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const MAX_COMMENT_LENGTH = 1000;
const RATE_LIMIT_WINDOW_HOURS = 1;
const MAX_SUBMISSIONS_PER_WINDOW = 5;

/**
 * Extracts and anonymizes the client IP using HMAC-SHA256 with a dedicated server salt.
 * Fails closed if the dedicated salt is missing.
 * Never leaks the raw IP address into logs or returns it to the client.
 */
export function deriveAnonymizedIpHash(headers: Record<string, string | undefined>): string {
  const salt = process.env.FEEDBACK_HMAC_SALT;
  if (!salt || typeof salt !== "string" || salt.trim().length === 0) {
    // Strict fail-closed: Zero fallbacks to webhook secrets or hardcoded defaults
    console.error("[SECURITY] FEEDBACK_HMAC_SALT is unconfigured. Failing closed.");
    const err: any = new Error("INTERNAL_CONFIGURATION_ERROR");
    err.statusCode = 500;
    throw err;
  }

  // Retrieve client IP from standard Netlify / proxy headers without logging raw value
  const rawIp =
    headers["client-ip"] ||
    headers["x-nf-client-connection-ip"] ||
    headers["x-forwarded-for"]?.split(",")[0] ||
    "127.0.0.1";

  return createHmac("sha256", salt.trim())
    .update(rawIp.trim())
    .digest("hex");
}

export const handler = async (event: any) => {
  // CORS Preflight
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json"
  };

  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: corsHeaders,
      body: ""
    };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: "METHOD_NOT_ALLOWED", message: "Only POST requests are permitted." })
    };
  }

  try {
    // 1. IP Anonymization & Salt Verification (Fails closed if FEEDBACK_HMAC_SALT missing)
    const ipHash = deriveAnonymizedIpHash(event.headers || {});

    // 2. Parse & Validate Payload
    let payload: FeedbackSubmissionPayload;
    try {
      payload = JSON.parse(event.body || "{}");
    } catch {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "INVALID_JSON", message: "Malformed JSON payload in request body." })
      };
    }

    const { rating, comment, consentContact, contactEmail, hp_company } = payload;

    // 3. Honeypot Check (Spam mitigation): Silently discard if populated
    if (hp_company && typeof hp_company === "string" && hp_company.trim().length > 0) {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ success: true, message: "Feedback acknowledged." })
      };
    }

    // 4. Rating Validation: Integer between 1 and 5
    if (
      typeof rating !== "number" ||
      !Number.isInteger(rating) ||
      rating < 1 ||
      rating > 5
    ) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          error: "INVALID_RATING",
          message: "Rating must be an integer between 1 and 5."
        })
      };
    }

    // 5. Comment Validation: Optional string <= 1000 characters
    let sanitizedComment: string | null = null;
    if (comment !== undefined && comment !== null) {
      if (typeof comment !== "string") {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: "INVALID_COMMENT", message: "Comment must be a text string." })
        };
      }
      const trimmed = comment.trim();
      if (trimmed.length > MAX_COMMENT_LENGTH) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({
            error: "COMMENT_TOO_LONG",
            message: `Comment must not exceed ${MAX_COMMENT_LENGTH} characters.`
          })
        };
      }
      if (trimmed.length > 0) {
        sanitizedComment = trimmed;
      }
    }

    // 6. Contact Consent Validation
    if (typeof consentContact !== "boolean") {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          error: "INVALID_CONSENT",
          message: "consentContact must be a boolean (true or false)."
        })
      };
    }

    // 7. Contact Email Enforcement: Reject if consent is false
    let sanitizedEmail: string | null = null;
    if (!consentContact) {
      if (contactEmail !== undefined && contactEmail !== null && String(contactEmail).trim().length > 0) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({
            error: "CONSENT_REQUIRED_FOR_EMAIL",
            message: "contactEmail must not be provided when consentContact is false."
          })
        };
      }
    } else {
      if (contactEmail !== undefined && contactEmail !== null) {
        if (typeof contactEmail !== "string") {
          return {
            statusCode: 400,
            headers: corsHeaders,
            body: JSON.stringify({ error: "INVALID_EMAIL", message: "contactEmail must be a valid email string." })
          };
        }
        const trimmedEmail = contactEmail.trim();
        if (trimmedEmail.length > 0) {
          if (trimmedEmail.length > 255 || !RFC5322_EMAIL_REGEX.test(trimmedEmail)) {
            return {
              statusCode: 400,
              headers: corsHeaders,
              body: JSON.stringify({
                error: "INVALID_EMAIL_FORMAT",
                message: "Provided contact email has an invalid format."
              })
            };
          }
          sanitizedEmail = trimmedEmail;
        }
      }
    }

    // 8. Transactional Advisory Lock & Concurrency-Safe Rate Limiting
    const insertResult = await withTransaction(async (client) => {
      // Acquire transaction-scoped advisory lock on the 32-bit hashtext of ipHash
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [ipHash]);

      // Count submissions from this anonymized IP hash within the last hour
      const countRes = await client.query(
        `SELECT COUNT(*)::int AS recent_count
         FROM public.feedbacks
         WHERE ip_hash = $1
           AND created_at > NOW() - INTERVAL '${RATE_LIMIT_WINDOW_HOURS} hour'`,
        [ipHash]
      );

      const recentCount = countRes.rows[0]?.recent_count ?? 0;
      if (recentCount >= MAX_SUBMISSIONS_PER_WINDOW) {
        const rateLimitErr: any = new Error("RATE_LIMIT_EXCEEDED");
        rateLimitErr.statusCode = 429;
        throw rateLimitErr;
      }

      // Safe insertion with exact parameterized values
      const res = await client.query(
        `INSERT INTO public.feedbacks (rating, comment, consent_contact, contact_email, ip_hash)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, created_at`,
        [rating, sanitizedComment, consentContact, sanitizedEmail, ipHash]
      );

      return res.rows[0];
    });

    return {
      statusCode: 201,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        feedbackId: insertResult.id,
        message: "Thank you for your feedback."
      })
    };
  } catch (err: any) {
    if (err.statusCode === 429 || err.message === "RATE_LIMIT_EXCEEDED") {
      return {
        statusCode: 429,
        headers: corsHeaders,
        body: JSON.stringify({
          error: "RATE_LIMIT_EXCEEDED",
          message: `Too many submissions. Maximum ${MAX_SUBMISSIONS_PER_WINDOW} feedbacks allowed per hour.`
        })
      };
    }

    if (err.statusCode === 500 || err.message === "INTERNAL_CONFIGURATION_ERROR") {
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({
          error: "INTERNAL_CONFIGURATION_ERROR",
          message: "Server configuration prevents feedback processing."
        })
      };
    }

    // Generic error fallback without leaking sensitive details or database errors
    console.error("[FEEDBACK HANDLER ERROR]", err?.message || err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: "INTERNAL_SERVER_ERROR",
        message: "An error occurred while submitting feedback."
      })
    };
  }
};
