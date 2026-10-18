// netlify/functions/razorpay-webhook.ts - Authoritative Server-to-Server Razorpay Webhook Handler
import crypto from "crypto";
import { getServerConfig, AUTHORITATIVE_PLANS } from "./shared/config";
import { withTransaction } from "./shared/db";
import { generateCryptographicLicenseKey } from "../../src/commercial/server/provisioner";

export const handler = async (event: any) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Method Not Allowed. Use POST." })
    };
  }

  const rawBody = event.body || "";
  const signature = event.headers["x-razorpay-signature"] || event.headers["X-Razorpay-Signature"];

  if (!signature || !rawBody) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Missing signature header or payload body." })
    };
  }

  let config;
  try {
    config = getServerConfig();
  } catch (cErr: any) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: cErr.message })
    };
  }

  // 1. POINT 1: Cryptographic Webhook HMAC-SHA256 Verification
  const expectedSignature = crypto
    .createHmac("sha256", config.webhookSecret)
    .update(rawBody)
    .digest("hex");

  const sigBufferA = Buffer.from(signature);
  const sigBufferB = Buffer.from(expectedSignature);

  if (sigBufferA.length !== sigBufferB.length || !crypto.timingSafeEqual(sigBufferA, sigBufferB)) {
    return {
      statusCode: 401,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Unauthorized: Invalid webhook cryptographic signature." })
    };
  }

  const payload = JSON.parse(rawBody);
  const eventId = payload.id || `evt_${Date.now()}`;
  const eventType = payload.event;
  const payloadHash = crypto.createHash("sha256").update(rawBody).digest("hex");

  try {
    const result = await withTransaction(async (client) => {
      // 2. Atomic Idempotency Check (Duplicate Replay Protection)
      const eventInsert = await client.query(
        `INSERT INTO payment_events (event_id, event_type, payload_hash)
         VALUES ($1, $2, $3)
         ON CONFLICT (event_id) DO NOTHING
         RETURNING event_id;`,
        [eventId, eventType, payloadHash]
      );

      if (eventInsert.rowCount === 0) {
        // Event already recorded & processed
        return { status: "DEDUPLICATED", message: "Webhook event already processed successfully." };
      }

      // Handle One-Time Order Fulfillment
      if (eventType === "order.paid" || eventType === "payment.captured") {
        const paymentEntity = payload.payload?.payment?.entity;
        const orderEntity = payload.payload?.order?.entity;
        const orderId = orderEntity?.id || paymentEntity?.order_id;
        const paymentId = paymentEntity?.id;

        if (!orderId) {
          throw new Error("Missing order_id in webhook payment entity.");
        }

        // Lock order row
        const orderRes = await client.query(
          `SELECT * FROM orders WHERE order_id = $1 FOR UPDATE;`,
          [orderId]
        );

        let order = orderRes.rows[0];

        if (orderRes.rowCount === 0) {
          // Self-heal: If order wasn't persisted in orders table during checkout due to latency,
          // dynamically register order from verified webhook payment entity
          let planType = "SINGLE_AUDIT";
          if (paymentEntity?.amount === 4999000 || paymentEntity?.notes?.planType === "ANNUAL_PROFESSIONAL") {
            planType = "ANNUAL_PROFESSIONAL";
          } else if (paymentEntity?.amount === 499900 || paymentEntity?.notes?.planType === "PROFESSIONAL_MONTHLY") {
            planType = "PROFESSIONAL_MONTHLY";
          }

          const receiptId = `rcpt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
          const dummyClaimHash = crypto.createHash("sha256").update(orderId).digest("hex");

          await client.query(
            `INSERT INTO orders (order_id, receipt_id, plan_type, amount_inr_paise, currency, status, customer_email, claim_token_hash)
             VALUES ($1, $2, $3, $4, 'INR', 'created', $5, $6)
             ON CONFLICT (order_id) DO NOTHING;`,
            [orderId, receiptId, planType, paymentEntity?.amount || 299900, paymentEntity?.email || "billing@company.com", dummyClaimHash]
          );

          const retryOrder = await client.query(
            `SELECT * FROM orders WHERE order_id = $1 FOR UPDATE;`,
            [orderId]
          );

          if (retryOrder.rowCount > 0) {
            order = retryOrder.rows[0];
          } else {
            throw new Error(`CRITICAL_MISMATCH: Order ${orderId} does not exist in authoritative orders table.`);
          }
        }

        // 3. POINT 2: Payment Status Verification
        if (paymentEntity && paymentEntity.status !== "captured") {
          return { status: "SKIPPED", message: "Payment status is not captured." };
        }

        // 4. POINT 3: Currency Verification
        if (paymentEntity && paymentEntity.currency !== "INR") {
          throw new Error(`SECURITY_ALERT: Currency mismatch. Expected INR, received ${paymentEntity.currency}`);
        }

        // 5. POINT 4 & 5: Amount & Plan Verification
        if (paymentEntity && paymentEntity.amount !== order.amount_inr_paise) {
          throw new Error(`SECURITY_ALERT: Amount mismatch. Expected ${order.amount_inr_paise}, received ${paymentEntity.amount}`);
        }

        // If license was already fulfilled via client path, link event and preserve key
        if (order.license_key) {
          await client.query(
            `UPDATE payment_events SET order_id = $1, payment_id = $2, license_key = $3, amount_inr_paise = $4, currency = 'INR' WHERE event_id = $5;`,
            [orderId, paymentId, order.license_key, order.amount_inr_paise, eventId]
          );
          return { status: "PREVIOUSLY_FULFILLED", license_key: order.license_key };
        }

        // Otherwise provision new license key
        const planConfig = AUTHORITATIVE_PLANS[order.plan_type];
        const newKey = generateCryptographicLicenseKey(order.plan_type);
        const auditsAllowed = planConfig ? planConfig.auditsAllowed : 1;
        const expiresAt = planConfig && planConfig.cycleDays
          ? new Date(Date.now() + planConfig.cycleDays * 24 * 60 * 60 * 1000).toISOString()
          : null;

        await client.query(
          `INSERT INTO licenses (license_key, plan_type, status, audits_allowed, audits_used, audits_reserved, expires_at)
           VALUES ($1, $2, 'ACTIVE', $3, 0, 0, $4);`,
          [newKey, order.plan_type, auditsAllowed, expiresAt]
        );

        await client.query(
          `UPDATE orders SET status = 'paid', payment_id = $1, license_key = $2, updated_at = NOW() WHERE order_id = $3;`,
          [paymentId, newKey, orderId]
        );

        await client.query(
          `UPDATE payment_events SET order_id = $1, payment_id = $2, license_key = $3, amount_inr_paise = $4, currency = 'INR' WHERE event_id = $5;`,
          [orderId, paymentId, newKey, order.amount_inr_paise, eventId]
        );

        return { status: "PROVISIONED", license_key: newKey };
      }

      // Handle Subscription Quota Renewals
      if (eventType === "subscription.charged") {
        const subEntity = payload.payload?.subscription?.entity;
        const subId = subEntity?.id;

        if (subId) {
          const subRes = await client.query(
            `SELECT * FROM subscriptions WHERE subscription_id = $1 FOR UPDATE;`,
            [subId]
          );

          if (subRes.rowCount > 0) {
            const sub = subRes.rows[0];
            const planConfig = AUTHORITATIVE_PLANS[sub.plan_type];
            const addedAudits = planConfig ? planConfig.auditsAllowed : 5;
            const newExpiry = new Date(Date.now() + (planConfig?.cycleDays || 30) * 24 * 60 * 60 * 1000).toISOString();

            // Replenish audits
            await client.query(
              `UPDATE licenses
               SET audits_allowed = audits_allowed + $1, status = 'ACTIVE', expires_at = $2, updated_at = NOW()
               WHERE subscription_id = $3;`,
              [addedAudits, newExpiry, subId]
            );

            await client.query(
              `UPDATE subscriptions
               SET status = 'active', charge_count = charge_count + 1, current_cycle_end = $1, updated_at = NOW()
               WHERE subscription_id = $2;`,
              [newExpiry, subId]
            );
          }
        }
      }

      // Handle Subscription Cancellation, Halting or Activation
      if (eventType === "subscription.cancelled" || eventType === "subscription.halted" || eventType === "subscription.activated") {
        const subEntity = payload.payload?.subscription?.entity;
        const subId = subEntity?.id;
        if (subId) {
          const newStatus = eventType === "subscription.cancelled" ? "cancelled" : (eventType === "subscription.halted" ? "halted" : "active");
          await client.query(
            `UPDATE subscriptions SET status = $1, updated_at = NOW() WHERE subscription_id = $2;`,
            [newStatus, subId]
          );
        }
      }

      // Handle Payment Failure
      if (eventType === "payment.failed") {
        const paymentEntity = payload.payload?.payment?.entity;
        const orderId = paymentEntity?.order_id;
        const paymentId = paymentEntity?.id;
        if (orderId) {
          await client.query(
            `UPDATE orders SET status = 'failed', payment_id = $1, updated_at = NOW() WHERE order_id = $2;`,
            [paymentId, orderId]
          );
        }
      }

      return { status: "PROCESSED" };
    });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result)
    };
  } catch (err: any) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: err.message || "Webhook processing error." })
    };
  }
};
