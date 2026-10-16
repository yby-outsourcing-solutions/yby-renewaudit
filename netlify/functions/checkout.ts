// netlify/functions/checkout.ts - Secure Order & Subscription Creation with Unguessable Claim Secrets
import crypto from "crypto";
import { getServerConfig, AUTHORITATIVE_PLANS } from "./shared/config";
import { withTransaction } from "./shared/db";

interface CheckoutRequestBody {
  planType?: "SINGLE_AUDIT" | "PROFESSIONAL_MONTHLY" | "ANNUAL_PROFESSIONAL";
  plan?: "SINGLE_AUDIT" | "PROFESSIONAL_MONTHLY" | "ANNUAL_PROFESSIONAL";
  customerEmail?: string;
  customer_email?: string;
}

export const handler = async (event: any) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Method Not Allowed. Use POST." })
    };
  }

  try {
    const config = getServerConfig();
    const body: CheckoutRequestBody = JSON.parse(event.body || "{}");
    const planType = body.planType || body.plan;
    const customerEmail = body.customerEmail || body.customer_email;

    if (!planType) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: `planType is required. Must be one of: ${Object.keys(AUTHORITATIVE_PLANS).join(", ")}` })
      };
    }

    const plan = AUTHORITATIVE_PLANS[planType];
    if (!plan) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: `Invalid planType. Must be one of: ${Object.keys(AUTHORITATIVE_PLANS).join(", ")}` })
      };
    }

    if (!customerEmail || !customerEmail.includes("@")) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Valid customerEmail is required." })
      };
    }

    const receiptId = `rcpt_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;

    // 1. Generate 256-bit unguessable claim token (sent only to client memory for this session)
    const claimToken = crypto.randomBytes(32).toString("hex");
    const claimTokenHash = crypto.createHash("sha256").update(claimToken).digest("hex");

    // 2. Call Razorpay API to create an order
    const authHeader = Buffer.from(`${config.keyId}:${config.keySecret}`).toString("base64");
    const orderPayload = {
      amount: plan.amountPaise,
      currency: "INR",
      receipt: receiptId,
      notes: {
        plan_type: planType,
        customer_email: customerEmail,
        env: config.env
      }
    };

    const razorpayRes = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${authHeader}`
      },
      body: JSON.stringify(orderPayload)
    });

    const orderData = await razorpayRes.json();
    if (!razorpayRes.ok) {
      return {
        statusCode: razorpayRes.status,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: orderData.error?.description || "Razorpay order creation failed." })
      };
    }

    // 3. Atomically persist order in database
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO orders (order_id, receipt_id, plan_type, amount_inr_paise, currency, status, customer_email, claim_token_hash)
         VALUES ($1, $2, $3, $4, 'INR', 'created', $5, $6);`,
        [orderData.id, receiptId, planType, plan.amountPaise, customerEmail, claimTokenHash]
      );
    });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        // Standard snake_case
        order_id: orderData.id,
        amount: orderData.amount,
        currency: orderData.currency,
        key_id: config.keyId,
        claim_token: claimToken,
        plan_type: planType,
        // Dual-support camelCase
        orderId: orderData.id,
        keyId: config.keyId,
        claimToken: claimToken,
        planType: planType
      })
    };
  } catch (err: any) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: err.message || "Internal server error during checkout initiation." })
    };
  }
};
