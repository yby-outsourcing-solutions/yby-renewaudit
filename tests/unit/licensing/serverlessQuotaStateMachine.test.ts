// tests/unit/licensing/serverlessQuotaStateMachine.test.ts - Atomic State Machine & Lease Boundaries Test Suite
import { describe, expect, it } from "vitest";

describe("Serverless Quota State Machine & Invariant Tests", () => {
  // Pure state model simulating database row locking & transition guards
  interface MockLicenseRow {
    license_key: string;
    audits_allowed: number;
    audits_used: number;
    audits_reserved: number;
    status: string;
    expires_at: number | null;
    bound_device_hash: string | null;
  }

  interface MockLeaseRow {
    reservation_id: string;
    license_key: string;
    device_hash: string;
    status: "ACTIVE" | "COMMITTED" | "RELEASED" | "EXPIRED";
    lease_expires_at: number;
  }

  function simulateReserve(
    license: MockLicenseRow,
    leases: Map<string, MockLeaseRow>,
    deviceHash: string,
    now: number
  ): { success: boolean; reservationId?: string; reason?: string } {
    // 1. Expiry check
    if (license.expires_at && license.expires_at < now) {
      return { success: false, reason: "LICENSE_EXPIRED" };
    }

    // 2. Device binding check
    if (!license.bound_device_hash) {
      license.bound_device_hash = deviceHash;
    } else if (license.bound_device_hash !== deviceHash) {
      return { success: false, reason: "DEVICE_MISMATCH" };
    }

    // 3. Quota availability check
    const remaining = license.audits_allowed - license.audits_used - license.audits_reserved;
    if (remaining < 1) {
      return { success: false, reason: "QUOTA_EXHAUSTED" };
    }

    // 4. Atomic reserve
    license.audits_reserved += 1;
    const reservationId = `RES-${now}-${Math.random().toString(36).substring(2, 6)}`;
    leases.set(reservationId, {
      reservation_id: reservationId,
      license_key: license.license_key,
      device_hash: deviceHash,
      status: "ACTIVE",
      lease_expires_at: now + 15 * 60 * 1000
    });

    return { success: true, reservationId };
  }

  function simulateCommit(
    license: MockLicenseRow,
    leases: Map<string, MockLeaseRow>,
    reservationId: string,
    deviceHash: string,
    now: number
  ): { success: boolean; reason?: string } {
    const lease = leases.get(reservationId);
    if (!lease) return { success: false, reason: "RESERVATION_NOT_FOUND" };

    // Atomic guard: status must be ACTIVE, device must match, and lease must not be expired
    if (lease.status === "COMMITTED") return { success: false, reason: "ALREADY_COMMITTED" };
    if (lease.status === "RELEASED") return { success: false, reason: "ALREADY_RELEASED" };
    if (lease.status === "EXPIRED" || lease.lease_expires_at <= now) return { success: false, reason: "RESERVATION_EXPIRED" };
    if (lease.device_hash !== deviceHash) return { success: false, reason: "DEVICE_MISMATCH" };

    // Transition lease
    lease.status = "COMMITTED";

    // Update license atomically
    license.audits_reserved = Math.max(license.audits_reserved - 1, 0);
    license.audits_used += 1;

    // Check invariants
    expect(license.audits_used + license.audits_reserved).toBeLessThanOrEqual(license.audits_allowed);
    expect(license.audits_reserved).toBeGreaterThanOrEqual(0);
    expect(license.audits_used).toBeGreaterThanOrEqual(0);

    return { success: true };
  }

  function simulateRelease(
    license: MockLicenseRow,
    leases: Map<string, MockLeaseRow>,
    reservationId: string,
    deviceHash: string,
    now: number
  ): { success: boolean; reason?: string } {
    const lease = leases.get(reservationId);
    if (!lease) return { success: false, reason: "RESERVATION_NOT_FOUND" };

    if (lease.status !== "ACTIVE" || lease.lease_expires_at <= now) {
      return { success: false, reason: "NOT_ACTIVE_OR_EXPIRED" };
    }

    lease.status = "RELEASED";
    license.audits_reserved = Math.max(license.audits_reserved - 1, 0);
    expect(license.audits_reserved).toBeGreaterThanOrEqual(0);

    return { success: true };
  }

  it("1. Reserve Quota increments reserved and issues active lease", () => {
    const license: MockLicenseRow = {
      license_key: "YBY-TEST-001",
      audits_allowed: 5,
      audits_used: 0,
      audits_reserved: 0,
      status: "ACTIVE",
      expires_at: null,
      bound_device_hash: "device_abc"
    };
    const leases = new Map<string, MockLeaseRow>();

    const res = simulateReserve(license, leases, "device_abc", 1000);
    expect(res.success).toBe(true);
    expect(license.audits_reserved).toBe(1);
    expect(license.audits_used).toBe(0);
  });

  it("2. Double-Commit Defense: Second commit fails and does not double-increment audits_used", () => {
    const license: MockLicenseRow = {
      license_key: "YBY-TEST-002",
      audits_allowed: 1,
      audits_used: 0,
      audits_reserved: 0,
      status: "ACTIVE",
      expires_at: null,
      bound_device_hash: "dev_1"
    };
    const leases = new Map<string, MockLeaseRow>();

    const res = simulateReserve(license, leases, "dev_1", 1000);
    const resId = res.reservationId!;

    // First commit succeeds
    const commit1 = simulateCommit(license, leases, resId, "dev_1", 2000);
    expect(commit1.success).toBe(true);
    expect(license.audits_used).toBe(1);
    expect(license.audits_reserved).toBe(0);

    // Second commit (duplicate replay) must fail
    const commit2 = simulateCommit(license, leases, resId, "dev_1", 3000);
    expect(commit2.success).toBe(false);
    expect(commit2.reason).toBe("ALREADY_COMMITTED");
    expect(license.audits_used).toBe(1); // Still exactly 1, never 2
  });

  it("3. Double-Release Defense: Releasing twice fails and avoids negative reservation underflow", () => {
    const license: MockLicenseRow = {
      license_key: "YBY-TEST-003",
      audits_allowed: 5,
      audits_used: 0,
      audits_reserved: 0,
      status: "ACTIVE",
      expires_at: null,
      bound_device_hash: "dev_2"
    };
    const leases = new Map<string, MockLeaseRow>();

    const res = simulateReserve(license, leases, "dev_2", 1000);
    const resId = res.reservationId!;
    expect(license.audits_reserved).toBe(1);

    const rel1 = simulateRelease(license, leases, resId, "dev_2", 2000);
    expect(rel1.success).toBe(true);
    expect(license.audits_reserved).toBe(0);

    // Duplicate release attempt
    const rel2 = simulateRelease(license, leases, resId, "dev_2", 2500);
    expect(rel2.success).toBe(false);
    expect(license.audits_reserved).toBe(0); // Never underflows below 0
  });

  it("4. Expired Lease Rejection: Cannot commit an expired reservation", () => {
    const license: MockLicenseRow = {
      license_key: "YBY-TEST-004",
      audits_allowed: 5,
      audits_used: 0,
      audits_reserved: 0,
      status: "ACTIVE",
      expires_at: null,
      bound_device_hash: "dev_3"
    };
    const leases = new Map<string, MockLeaseRow>();

    const res = simulateReserve(license, leases, "dev_3", 1000);
    const resId = res.reservationId!;

    // Fast forward beyond 15-minute lease (15 mins = 900,000 ms)
    const commitAttempt = simulateCommit(license, leases, resId, "dev_3", 1000 + 950000);
    expect(commitAttempt.success).toBe(false);
    expect(commitAttempt.reason).toBe("RESERVATION_EXPIRED");
  });

  it("5. Device Mismatch Rejection: Committing on a different device is blocked", () => {
    const license: MockLicenseRow = {
      license_key: "YBY-TEST-005",
      audits_allowed: 5,
      audits_used: 0,
      audits_reserved: 0,
      status: "ACTIVE",
      expires_at: null,
      bound_device_hash: "device_original"
    };
    const leases = new Map<string, MockLeaseRow>();

    const res = simulateReserve(license, leases, "device_original", 1000);
    const commitAttempt = simulateCommit(license, leases, res.reservationId!, "device_attacker", 2000);
    expect(commitAttempt.success).toBe(false);
    expect(commitAttempt.reason).toBe("DEVICE_MISMATCH");
  });
});
