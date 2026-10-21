// src/config/support.ts - Official Support & Contact Channels Configuration

export interface SupportConfig {
  whatsApp: {
    number: string | null;
    enabled: boolean;
    staticMessage: string;
  };
}

export const SUPPORT_CONFIG: SupportConfig = {
  whatsApp: {
    // LOCKED PER BROTHER 1 DIRECTIVE: Set to null and false until Founder explicitly confirms official number
    number: null,
    enabled: false,
    staticMessage: "Hello YBY RenewAudit Team, I completed an audit on the platform and would like to connect with the Founder."
  }
};
