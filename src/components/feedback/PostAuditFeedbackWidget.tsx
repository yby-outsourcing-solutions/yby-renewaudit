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
      <div className="feedback-widget feedback-success-card no-print">
        <div className="feedback-success-content">
          <div className="feedback-success-left">
            <div className="feedback-success-badge" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <div>
              <h4 className="feedback-success-title">
                Thank you for your feedback!
              </h4>
              <p className="feedback-success-desc">
                Your evaluation helps us strengthen our deterministic audit engine and enterprise protection.
              </p>
            </div>
          </div>
          <FounderWhatsAppButton />
        </div>
      </div>
    );
  }

  const starLabels = ["", "Poor", "Fair", "Good", "Very Good", "Excellent"];

  return (
    <div className="feedback-widget feedback-card no-print">
      <div className="feedback-header">
        <div className="feedback-title-group">
          <div className="feedback-icon-badge" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
            </svg>
          </div>
          <div>
            <h4 className="feedback-title">
              Rate Your Audit Report Experience
            </h4>
            <p className="feedback-subtitle">
              Your feedback is strictly confidential. No contract details or audit findings are ever recorded.
            </p>
          </div>
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
        <div className="feedback-stars-container">
          {[1, 2, 3, 4, 5].map((star) => {
            const isFilled = (hoverRating || rating) >= star;
            return (
              <button
                key={star}
                type="button"
                onClick={() => setRating(star)}
                onMouseEnter={() => setHoverRating(star)}
                onMouseLeave={() => setHoverRating(0)}
                className={`feedback-star-btn ${isFilled ? "active" : ""}`}
                title={starLabels[star]}
                aria-label={`Rate ${star} out of 5 stars`}
              >
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill={isFilled ? "currentColor" : "none"}
                  stroke="currentColor"
                  strokeWidth={isFilled ? "0" : "1.75"}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
              </button>
            );
          })}
          {(hoverRating > 0 || rating > 0) && (
            <span className="feedback-star-pill">
              {starLabels[hoverRating || rating]}
            </span>
          )}
        </div>

        {/* Optional Comment */}
        <div className="feedback-comment-group">
          <div className="feedback-label-row">
            <label htmlFor="feedback-comment" className="feedback-label">
              Optional Comment or Suggestions
            </label>
            <span
              className={`feedback-counter ${
                comment.length >= MAX_COMMENT_LENGTH ? "limit-warn" : ""
              }`}
            >
              {comment.length} / {MAX_COMMENT_LENGTH}
            </span>
          </div>
          <textarea
            id="feedback-comment"
            className="feedback-textarea"
            rows={3}
            value={comment}
            onChange={(e) => setComment(e.target.value.slice(0, MAX_COMMENT_LENGTH))}
            placeholder="What worked well? What could make the audit findings clearer?"
            maxLength={MAX_COMMENT_LENGTH}
          />
        </div>

        {/* Contact Consent Checkbox Card */}
        <div style={{ marginBottom: "16px" }}>
          <label
            htmlFor="feedback-consent-checkbox"
            className={`feedback-consent-card ${consentContact ? "checked" : ""}`}
          >
            <input
              id="feedback-consent-checkbox"
              type="checkbox"
              className="feedback-checkbox"
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
            <div className="feedback-consent-text">
              I consent to be contacted regarding this feedback
              <span className="feedback-consent-sub">
                Optional: Check this if you would like our product team to follow up on your suggestions.
              </span>
            </div>
          </label>
        </div>

        {/* Conditional Contact Fields (Only rendered when consent is true) */}
        {consentContact && (
          <div className="feedback-contact-grid">
            <div className="feedback-input-group">
              <label htmlFor="feedback-email">
                <span>
                  Work Email <span className="feedback-required">*</span>
                </span>
              </label>
              <input
                id="feedback-email"
                name="contactEmail"
                type="email"
                className="feedback-input"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                placeholder="procurement.officer@enterprise.com"
                maxLength={255}
                required
                autoComplete="email"
              />
            </div>

            <div className="feedback-input-group">
              <label htmlFor="feedback-contact-name">
                <span>Full Name</span>
                <span className="feedback-optional">Optional</span>
              </label>
              <input
                id="feedback-contact-name"
                name="contactName"
                type="text"
                className="feedback-input"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder="e.g. Ramesh Patel"
                maxLength={MAX_NAME_LENGTH}
                autoComplete="name"
              />
            </div>

            <div className="feedback-input-group">
              <label htmlFor="feedback-company-name">
                <span>Company Name</span>
                <span className="feedback-optional">Optional</span>
              </label>
              <input
                id="feedback-company-name"
                name="companyName"
                type="text"
                className="feedback-input"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="e.g. Tata Consultancy Services"
                maxLength={MAX_COMPANY_LENGTH}
                autoComplete="organization"
              />
            </div>
          </div>
        )}

        {errorMessage && (
          <div className="feedback-error-banner" role="alert">
            <span aria-hidden="true">⚠️</span>
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Action Button */}
        <div>
          <button
            type="submit"
            className="feedback-submit-btn"
            disabled={status === "submitting" || rating === 0}
          >
            {status === "submitting" ? (
              <>
                <span className="feedback-spinner" aria-hidden="true" />
                <span>Submitting Feedback...</span>
              </>
            ) : (
              <>
                <span>Submit Feedback</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
