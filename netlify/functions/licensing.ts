// netlify/functions/licensing.ts - Serverless Quota Engine with Row-Level Locks and Atomic Leases
import crypto from "crypto";
import { withTransaction } from "./shared/db";

interface LicensingRequestBody {
  action: "validate" | "reserve" | "commit" | "release";
  licenseKey: string;
  deviceHash: string;
  reservationId?: string;
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
    const body: LicensingRequestBody = JSON.parse(event.body || "{}");
    const { action, licenseKey, deviceHash, reservationId } = body;

    if (!action || !licenseKey || !deviceHash) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ valid: false, status: "INVALID_KEY", reason: "Missing action, licenseKey, or deviceHash." })
      };
    }

    const key = licenseKey.trim().toUpperCase();

    // 1. ACTION: VALIDATE
    if (action === "validate") {
      const result = await withTransaction(async (client) => {
        // Clean expired leases first
        await client.query(
          `WITH expired AS (
             UPDATE quota_leases SET status = 'EXPIRED', resolved_at = NOW()
             WHERE license_key = $1 AND status = 'ACTIVE' AND lease_expires_at <= NOW()
             RETURNING reservation_id
           )
           UPDATE licenses SET audits_reserved = GREATEST(audits_reserved - (SELECT COUNT(*) FROM expired), 0), updated_at = NOW()
           WHERE license_key = $1;`,
          [key]
        );

        const licRes = await client.query(
          `SELECT * FROM licenses WHERE license_key = $1 FOR UPDATE;`,
          [key]
        );

        if (licRes.rowCount === 0) {
          return { valid: false, status: "INVALID_KEY", reason: "Invalid or unrecognized license activation key." };
        }

        const lic = licRes.rows[0];

        // Expiry check
        if (lic.expires_at && new Date(lic.expires_at).getTime() < Date.now()) {
          return { valid: false, plan: lic.plan_type, auditsRemaining: 0, auditsReserved: lic.audits_reserved, status: "EXPIRED", reason: "License subscription has expired." };
        }

        // Device Binding check
        if (!lic.bound_device_hash) {
          await client.query(
            `UPDATE licenses SET bound_device_hash = $1, updated_at = NOW() WHERE license_key = $2;`,
            [deviceHash, key]
          );
          lic.bound_device_hash = deviceHash;
        } else if (lic.bound_device_hash !== deviceHash) {
          return { valid: false, plan: lic.plan_type, status: "INVALID_KEY", reason: "Device Binding Violation: License is already registered to another device." };
        }

        const remaining = Math.max(lic.audits_allowed - lic.audits_used - lic.audits_reserved, 0);
        if (remaining <= 0) {
          const status = lic.plan_type === "SINGLE_AUDIT" ? "SINGLE_AUDIT_ALREADY_CONSUMED" : "QUOTA_EXHAUSTED";
          return { valid: false, plan: lic.plan_type, auditsRemaining: 0, auditsReserved: lic.audits_reserved, status, reason: "Audit quota exhausted." };
        }

        return {
          valid: true,
          plan: lic.plan_type,
          auditsRemaining: remaining,
          auditsReserved: lic.audits_reserved,
          status: "ACTIVE"
        };
      });

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result)
      };
    }

    // 2. ACTION: RESERVE (Gate 0 Audit Start)
    if (action === "reserve") {
      const resId = `RES-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
      const result = await withTransaction(async (client) => {
        // Sweep expired
        await client.query(
          `WITH expired AS (
             UPDATE quota_leases SET status = 'EXPIRED', resolved_at = NOW()
             WHERE license_key = $1 AND status = 'ACTIVE' AND lease_expires_at <= NOW()
             RETURNING reservation_id
           )
           UPDATE licenses SET audits_reserved = GREATEST(audits_reserved - (SELECT COUNT(*) FROM expired), 0), updated_at = NOW()
           WHERE license_key = $1;`,
          [key]
        );

        const licRes = await client.query(
          `SELECT * FROM licenses WHERE license_key = $1 FOR UPDATE;`,
          [key]
        );

        if (licRes.rowCount === 0) {
          return { valid: false, status: "INVALID_KEY", reason: "License key not found." };
        }

        const lic = licRes.rows[0];
        const remaining = Math.max(lic.audits_allowed - lic.audits_used - lic.audits_reserved, 0);

        if (remaining <= 0) {
          return {
            valid: false,
            plan: lic.plan_type,
            auditsRemaining: 0,
            auditsReserved: lic.audits_reserved,
            status: lic.plan_type === "SINGLE_AUDIT" ? "SINGLE_AUDIT_ALREADY_CONSUMED" : "QUOTA_EXHAUSTED",
            reason: "Cannot reserve quota: No available audits remaining."
          };
        }

        // Atomically increment reserved
        await client.query(
          `UPDATE licenses SET audits_reserved = audits_reserved + 1, updated_at = NOW() WHERE license_key = $1;`,
          [key]
        );

        await client.query(
          `INSERT INTO quota_leases (reservation_id, license_key, device_hash, status, lease_expires_at)
           VALUES ($1, $2, $3, 'ACTIVE', NOW() + INTERVAL '15 minutes');`,
          [resId, key, deviceHash]
        );

        return {
          valid: true,
          plan: lic.plan_type,
          auditsRemaining: remaining - 1,
          auditsReserved: lic.audits_reserved + 1,
          reservationId: resId,
          status: "ACTIVE"
        };
      });

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result)
      };
    }

    // 3. ACTION: COMMIT (Audit Finished Successfully)
    if (action === "commit") {
      if (!reservationId) {
        return {
          statusCode: 400,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ valid: false, status: "INVALID_KEY", reason: "reservationId is required for commit." })
        };
      }

      const result = await withTransaction(async (client) => {
        // Atomic single-query transition: ACTIVE -> COMMITTED
        const leaseUpdate = await client.query(
          `UPDATE quota_leases
           SET status = 'COMMITTED', resolved_at = NOW()
           WHERE reservation_id = $1
             AND license_key = $2
             AND device_hash = $3
             AND status = 'ACTIVE'
             AND lease_expires_at > NOW()
           RETURNING reservation_id;`,
          [reservationId, key, deviceHash]
        );

        if (leaseUpdate.rowCount === 0) {
          // Check reason
          const checkRes = await client.query(`SELECT status, lease_expires_at, device_hash FROM quota_leases WHERE reservation_id = $1;`, [reservationId]);
          if (checkRes.rowCount === 0) {
            return { valid: false, status: "INVALID_KEY", reason: "RESERVATION_NOT_FOUND" };
          }
          const lease = checkRes.rows[0];
          if (lease.status === "COMMITTED") return { valid: false, status: "ALREADY_COMMITTED", reason: "Reservation has already been committed." };
          if (lease.status === "RELEASED") return { valid: false, status: "ALREADY_RELEASED", reason: "Reservation has already been released." };
          if (new Date(lease.lease_expires_at).getTime() <= Date.now()) return { valid: false, status: "EXPIRED", reason: "Reservation lease expired." };
          if (lease.device_hash !== deviceHash) return { valid: false, status: "DEVICE_MISMATCH", reason: "Device hash mismatch." };
          return { valid: false, status: "INVALID_KEY", reason: "Invalid reservation." };
        }

        // Increment used and decrement reserved
        const licUpdate = await client.query(
          `UPDATE licenses
           SET audits_reserved = GREATEST(audits_reserved - 1, 0),
               audits_used = audits_used + 1,
               status = CASE 
                   WHEN plan_type = 'SINGLE_AUDIT' AND audits_used + 1 >= audits_allowed THEN 'SINGLE_AUDIT_ALREADY_CONSUMED'
                   WHEN audits_used + 1 >= audits_allowed THEN 'QUOTA_EXHAUSTED'
                   ELSE status
               END,
               updated_at = NOW()
           WHERE license_key = $1
           RETURNING audits_allowed, audits_used, audits_reserved, status, plan_type;`,
          [key]
        );

        const updatedLic = licUpdate.rows[0];
        const remaining = Math.max(updatedLic.audits_allowed - updatedLic.audits_used - updatedLic.audits_reserved, 0);

        return {
          valid: true,
          plan: updatedLic.plan_type,
          auditsRemaining: remaining,
          auditsReserved: updatedLic.audits_reserved,
          status: updatedLic.status
        };
      });

      return {
        statusCode: result.valid ? 200 : 409,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result)
      };
    }

    // 4. ACTION: RELEASE (Audit Cancelled / Failed)
    if (action === "release") {
      if (!reservationId) {
        return {
          statusCode: 400,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ valid: false, status: "INVALID_KEY", reason: "reservationId is required for release." })
        };
      }

      const result = await withTransaction(async (client) => {
        const leaseUpdate = await client.query(
          `UPDATE quota_leases
           SET status = 'RELEASED', resolved_at = NOW()
           WHERE reservation_id = $1
             AND license_key = $2
             AND device_hash = $3
             AND status = 'ACTIVE'
             AND lease_expires_at > NOW()
           RETURNING reservation_id;`,
          [reservationId, key, deviceHash]
        );

        if (leaseUpdate.rowCount === 0) {
          return { valid: false, status: "INVALID_KEY", reason: "Reservation could not be released (either not found, already resolved, or expired)." };
        }

        await client.query(
          `UPDATE licenses
           SET audits_reserved = GREATEST(audits_reserved - 1, 0), updated_at = NOW()
           WHERE license_key = $1;`,
          [key]
        );

        return { valid: true, status: "ACTIVE", reason: "Quota reservation released back to AVAILABLE state." };
      });

      return {
        statusCode: result.valid ? 200 : 409,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result)
      };
    }

    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: `Unknown action: ${action}` })
    };
  } catch (err: any) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: err.message || "Licensing operation failed." })
    };
  }
};
