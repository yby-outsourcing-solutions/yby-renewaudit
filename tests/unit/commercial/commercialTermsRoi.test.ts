import { describe, expect, it } from "vitest";
import {
  calculateCommercialROI,
  INVALID_FEE_SENTINEL
} from "../../../src/components/commercial/CommercialTermsView";

describe("Commercial Model ROI Simulator & Net Customer Value Suite", () => {
  it("1. Brother 1 Observed Example: ₹2,000 savings against ₹2,999 fee yields -₹999 net value and -33.31% ROI", () => {
    const res = calculateCommercialROI(2000, 2999);

    expect(res.netCustomerValueINR).toBe(-999);
    expect(res.formattedNetValue).toBe("-₹999");
    expect(res.customerROI).toBe("-33.31");
    expect(res.formattedROI).toBe("-33.31%");
    expect(res.roiNumeric).toBeCloseTo(-33.3111, 2);
    expect(res.isInvalidFee).toBe(false);
  });

  it("2. Zero Savings Edge Case: ₹0 savings against ₹2,999 fee yields -₹2,999 net value and -100.00% ROI", () => {
    const res = calculateCommercialROI(0, 2999);

    expect(res.netCustomerValueINR).toBe(-2999);
    expect(res.formattedNetValue).toBe("-₹2,999");
    expect(res.customerROI).toBe("-100.00");
    expect(res.formattedROI).toBe("-100.00%");
    expect(res.roiNumeric).toBe(-100);
    expect(res.isInvalidFee).toBe(false);
  });

  it("3. Break-Even Edge Case: ₹2,999 savings against ₹2,999 fee yields ₹0 net value and 0.00% ROI", () => {
    const res = calculateCommercialROI(2999, 2999);

    expect(res.netCustomerValueINR).toBe(0);
    expect(res.formattedNetValue).toBe("₹0");
    expect(res.customerROI).toBe("0.00");
    expect(res.formattedROI).toBe("0.00%");
    expect(res.roiNumeric).toBe(0);
    expect(res.isInvalidFee).toBe(false);
  });

  it("4. Positive Return: ₹5,998 savings against ₹2,999 fee yields ₹2,999 net value and 100.00% ROI", () => {
    const res = calculateCommercialROI(5998, 2999);

    expect(res.netCustomerValueINR).toBe(2999);
    expect(res.formattedNetValue).toBe("₹2,999");
    expect(res.customerROI).toBe("100.00");
    expect(res.formattedROI).toBe("100.00%");
    expect(res.roiNumeric).toBe(100);
    expect(res.isInvalidFee).toBe(false);

    // Default High Savings Check
    const resHigh = calculateCommercialROI(160000, 2999);
    expect(resHigh.netCustomerValueINR).toBe(157001);
    expect(resHigh.formattedNetValue).toBe("₹1,57,001");
    expect(resHigh.customerROI).toBe("5235.11");
    expect(resHigh.formattedROI).toBe("5235.11%");
  });

  it("5. Zero Fee Safeguard: ₹5,000 savings / ₹0 fee yields N/A sentinel with ₹5,000 Net Customer Value", () => {
    const res = calculateCommercialROI(5000, 0);

    expect(res.isInvalidFee).toBe(true);
    expect(res.netCustomerValueINR).toBe(5000);
    expect(res.formattedNetValue).toBe("₹5,000");
    expect(res.customerROI).toBe("N/A");
    expect(res.formattedROI).toBe(INVALID_FEE_SENTINEL);
    expect(res.roiNumeric).toBeNull();
  });

  it("6. Zero Savings / Zero Fee: ₹0 savings / ₹0 fee yields N/A sentinel with ₹0 Net Customer Value", () => {
    const res = calculateCommercialROI(0, 0);

    expect(res.isInvalidFee).toBe(true);
    expect(res.netCustomerValueINR).toBe(0);
    expect(res.formattedNetValue).toBe("₹0");
    expect(res.customerROI).toBe("N/A");
    expect(res.formattedROI).toBe(INVALID_FEE_SENTINEL);
    expect(res.roiNumeric).toBeNull();
  });

  it("7. Negative Fee Safeguard: Negative fee is rejected and fails closed with N/A sentinel", () => {
    const res = calculateCommercialROI(5000, -500);

    expect(res.isInvalidFee).toBe(true);
    expect(res.customerROI).toBe("N/A");
    expect(res.formattedROI).toBe(INVALID_FEE_SENTINEL);
    expect(res.roiNumeric).toBeNull();
  });

  it("8. Non-Finite Inputs Safeguard: handles NaN, Infinity safely without displaying NaN or Infinity", () => {
    // NaN Savings with valid fee
    const resNaNSavings = calculateCommercialROI(Number.NaN, 2999);
    expect(resNaNSavings.netCustomerValueINR).toBe(-2999);
    expect(resNaNSavings.formattedNetValue).toBe("-₹2,999");
    expect(resNaNSavings.customerROI).toBe("-100.00");
    expect(resNaNSavings.formattedROI).toBe("-100.00%");
    expect(resNaNSavings.isInvalidFee).toBe(false);

    // NaN Fee
    const resNaNFee = calculateCommercialROI(5000, Number.NaN);
    expect(resNaNFee.isInvalidFee).toBe(true);
    expect(resNaNFee.customerROI).toBe("N/A");
    expect(resNaNFee.formattedROI).toBe(INVALID_FEE_SENTINEL);
    expect(resNaNFee.roiNumeric).toBeNull();

    // Infinity Fee
    const resInfFee = calculateCommercialROI(5000, Number.POSITIVE_INFINITY);
    expect(resInfFee.isInvalidFee).toBe(true);
    expect(resInfFee.customerROI).toBe("N/A");
    expect(resInfFee.formattedROI).toBe(INVALID_FEE_SENTINEL);
    expect(resInfFee.roiNumeric).toBeNull();
  });
});
