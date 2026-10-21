import { SUPPORT_CONFIG } from "../../config/support";

/**
 * FounderWhatsAppButton
 * 
 * Invariants:
 * - Returns null when SUPPORT_CONFIG.whatsApp.enabled is false or number is null.
 * - Under no circumstances does this component include contract details, findings,
 *   formulas, file names, or user financial data in the WhatsApp query string.
 */
export function FounderWhatsAppButton() {
  const { enabled, number, staticMessage } = SUPPORT_CONFIG.whatsApp;

  if (!enabled || !number) {
    return null;
  }

  const cleanNumber = number.replace(/[^0-9]/g, "");
  const encodedMessage = encodeURIComponent(staticMessage);
  const whatsappUrl = `https://wa.me/${cleanNumber}?text=${encodedMessage}`;

  return (
    <a
      href={whatsappUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="btn btn-secondary btn-sm"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        borderColor: "rgba(37, 211, 102, 0.4)",
        color: "#25d366"
      }}
    >
      <span>💬</span> Chat with Founder on WhatsApp
    </a>
  );
}
