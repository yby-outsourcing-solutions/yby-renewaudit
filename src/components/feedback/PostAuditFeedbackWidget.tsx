import React, { useState } from "react";
import { FounderWhatsAppButton } from "./FounderWhatsAppButton";

export function PostAuditFeedbackWidget() {
  const [rating, setRating] = useState<number>(0);
  const [hoverRating, setHoverRating] = useState<number>(0);
  const [comment, setComment] = useState<string>("");
  const [consentContact, setConsentContact] = useState<boolean>(false);
  const [contactEmail, setContactEmail] = useState<string>("");
  const [contactName, setContactName] = useState<string>("");
  const [companyName, setCompanyName] = useState<string>("");
  const [honeypot, setHoneypot] = useState<string>("");
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string>("");

  const MAX_COMMENT_LENGTH = 1000;
  const MAX_NAME_LENGTH = 128;
  const MAX_COMPANY_LENGTH = 128;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (rating < 1 || rating > 5) {
      setErrorMessage("Please select a star rating between 1 and 5.");
      return;
    }

    if (consentContact) {
      if (contactEmail.trim().length === 0) {
        setErrorMessage("Please enter your work email to enable contact consent.");
        return;
      }
      const emailRegex = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
      if (!emailRegex.test(contactEmail.trim())) {
        setErrorMessage("Please enter a valid work email address or uncheck the contact consent.");
        return;
      }
      if (contactName.trim().length > MAX_NAME_LENGTH) {
        setErrorMessage(`Full Name must not exceed ${MAX_NAME_LENGTH} characters.`);
        return;
      }
      if (companyName.trim().length > MAX_COMPANY_LENGTH) {
        setErrorMessage(`Company Name must not exceed ${MAX_COMPANY_LENGTH} characters.`);
        return;
      }
    }

    setStatus("submitting");
    setErrorMessage("");

    try {
      const res = await fetch("/.netlify/functions/feedback-submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rating,
          comment: comment.trim() || undefined,
          consentContact,
          contactEmail: consentContact && contactEmail.trim() ? contactEmail.trim() : undefined,
          contactName: consentContact && contactName.trim() ? contactName.trim() : undefined,
          companyName: consentContact && companyName.trim() ? companyName.trim() : undefined,
          hp_company: honeypot || undefined
        })
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        setStatus("success");
      } else if (res.status === 429) {
        setStatus("error");
        setErrorMessage(data.message || "Submission limit reached (maximum 5 submissions per hour).");
      } else {
        setStatus("error");
        setErrorMessage(data.message || "Failed to submit feedback. Please try again later.");
      }
    } catch {
      setStatus("error");
      setErrorMessage("Network error: Could not reach the feedback service.");
    }
  }

  if (status === "success") {
    return (
      <div
        className="feedback-widget panel-card no-print"
        style={{
          marginTop: "24px",
          padding: "20px",
          border: "1px solid rgba(16, 185, 129, 0.4)",
          borderRadius: "8px",
          background: "rgba(16, 185, 129, 0.05)"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
          <div>
            <h4 style={{ color: "var(--color-emerald, #10b981)", margin: "0 0 4px 0", fontSize: "1rem" }}>
              ✅ Thank you for your feedback!
            </h4>
            <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--text-secondary, #94a3b8)" }}>
              Your evaluation helps us strengthen our deterministic audit engine and enterprise protection.
            </p>
          </div>
          <FounderWhatsAppButton />
        </div>
      </div>
    );
  }

  const starLabels = ["", "Poor", "Fair", "Good", "Very Good", "Excellent"];

  return (
    <div
      className="feedback-widget panel-card no-print"
      style={{
        marginTop: "24px",
        padding: "20px",
        border: "1px solid var(--border-color, rgba(255, 255, 255, 0.1))",
        borderRadius: "8px",
        background: "var(--card-bg, #0f172a)"
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px", flexWrap: "wrap", gap: "8px" }}>
        <div>
          <h4 style={{ margin: "0 0 4px 0", fontSize: "1rem", color: "var(--text-primary, #f8fafc)" }}>
            🌟 Rate Your Audit Report Experience
          </h4>
          <span style={{ fontSize: "0.82rem", color: "var(--text-secondary, #94a3b8)" }}>
            Your feedback is strictly confidential. No contract details or audit findings are ever recorded.
          </span>
        </div>
        <FounderWhatsAppButton />
      </div>

      <form onSubmit={handleSubmit}>
        {/* Honeypot field (hidden from genuine users) */}
        <input
          type="text"
          name="hp_company"
          value={honeypot}
          onChange={(e) => setHoneypot(e.target.value)}
          tabIndex={-1}
          autoComplete="off"
          style={{ display: "none" }}
          aria-hidden="true"
        />

        {/* Star Rating Bar */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", margin: "12px 0 16px 0" }}>
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              type="button"
              onClick={() => setRating(star)}
              onMouseEnter={() => setHoverRating(star)}
              onMouseLeave={() => setHoverRating(0)}
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                fontSize: "1.5rem",
                color: (hoverRating || rating) >= star ? "#fbbf24" : "rgba(255, 255, 255, 0.2)",
                padding: "2px",
                transition: "transform 0.1s ease, color 0.15s ease"
              }}
              title={starLabels[star]}
              aria-label={`Rate ${star} out of 5 stars`}
            >
              ★
            </button>
          ))}
          {rating > 0 && (
            <span style={{ fontSize: "0.85rem", color: "var(--text-secondary, #94a3b8)", marginLeft: "8px" }}>
              ({starLabels[rating]})
            </span>
          )}
        </div>

        {/* Optional Comment */}
        <div style={{ marginBottom: "14px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
            <label htmlFor="feedback-comment" style={{ fontSize: "0.82rem", color: "var(--text-secondary, #94a3b8)" }}>
              Optional Comment or Suggestions
            </label>
            <span style={{ fontSize: "0.75rem", color: comment.length > MAX_COMMENT_LENGTH ? "var(--color-rose, #f43f5e)" : "var(--text-muted, #64748b)" }}>
              {comment.length} / {MAX_COMMENT_LENGTH}
            </span>
          </div>
          <textarea
            id="feedback-comment"
            className="input-box"
            rows={2}
            value={comment}
            onChange={(e) => setComment(e.target.value.slice(0, MAX_COMMENT_LENGTH))}
            placeholder="What worked well? What could make the audit findings clearer?"
            style={{ width: "100%", fontSize: "0.85rem", resize: "vertical" }}
          />
        </div>

        {/* Contact Consent Checkbox */}
        <div style={{ marginBottom: "14px" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "0.82rem", color: "var(--text-secondary, #94a3b8)" }}>
            <input
              type="checkbox"
              checked={consentContact}
              onChange={(e) => {
                setConsentContact(e.target.checked);
                if (!e.target.checked) {
                  setContactEmail("");
                  setContactName("");
                  setCompanyName("");
                }
              }}
            />
            I consent to be contacted regarding this feedback
          </label>
        </div>

        {/* Conditional Contact Fields (Only rendered when consent is true) */}
        {consentContact && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "12px", marginBottom: "14px" }}>
            <div>
              <label htmlFor="feedback-email" style={{ fontSize: "0.82rem", color: "var(--text-secondary, #94a3b8)", display: "block", marginBottom: "4px" }}>
                Work Email <span style={{ color: "var(--color-rose, #f43f5e)" }}>*</span>
              </label>
              <input
                id="feedback-email"
                type="email"
                className="input-box"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                placeholder="procurement.officer@enterprise.com"
                maxLength={255}
                required
                style={{ width: "100%", fontSize: "0.85rem" }}
              />
            </div>

            <div>
              <label htmlFor="feedback-contact-name" style={{ fontSize: "0.82rem", color: "var(--text-secondary, #94a3b8)", display: "block", marginBottom: "4px" }}>
                Full Name <span style={{ fontSize: "0.75rem", color: "var(--text-muted, #64748b)" }}>(Optional)</span>
              </label>
              <input
                id="feedback-contact-name"
                name="contactName"
                type="text"
                className="input-box"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder="e.g. Ramesh Patel"
                maxLength={MAX_NAME_LENGTH}
                style={{ width: "100%", fontSize: "0.85rem" }}
              />
            </div>

            <div>
              <label htmlFor="feedback-company-name" style={{ fontSize: "0.82rem", color: "var(--text-secondary, #94a3b8)", display: "block", marginBottom: "4px" }}>
                Company Name <span style={{ fontSize: "0.75rem", color: "var(--text-muted, #64748b)" }}>(Optional)</span>
              </label>
              <input
                id="feedback-company-name"
                name="companyName"
                type="text"
                className="input-box"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="e.g. Tata Consultancy Services"
                maxLength={MAX_COMPANY_LENGTH}
                style={{ width: "100%", fontSize: "0.85rem" }}
              />
            </div>
          </div>
        )}

        {errorMessage && (
          <div style={{ color: "var(--color-rose, #f43f5e)", fontSize: "0.82rem", marginBottom: "12px" }}>
            ⚠️ {errorMessage}
          </div>
        )}

        {/* Action Button */}
        <div>
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={status === "submitting" || rating === 0}
            style={{ fontSize: "0.85rem", padding: "6px 16px" }}
          >
            {status === "submitting" ? "Submitting..." : "Submit Feedback"}
          </button>
        </div>
      </form>
    </div>
  );
}
