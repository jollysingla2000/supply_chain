export interface RowDemandEvaluation {
  rawActual: number;
  rawForecast: number;
  safeActual: number;
  safeForecast: number;
  returnQty: number;
  wasNegativeClamped: boolean;
  uncensoredDemand: number;
  stockoutRecoveredUnits: number;
  unitError: number;
  absError: number;
  accuracyPct: number | null;
  accuracyLabel: string;
  zScore: number;
  isOutlier: boolean;
}

/**
 * Enforces the required zero-sales rule:
 * When Actual === 0, percentage accuracy MUST be null ("N/A"), even when Forecast === 0.
 * Unit error (Forecast - Actual) can still be 0.
 */
export function calcRowAccuracyPct(actual: number, forecast: number): number | null {
  const safeAct = Math.max(0, Number.isFinite(actual) ? actual : 0);
  const safeFcst = Math.max(0, Number.isFinite(forecast) ? forecast : 0);
  if (safeAct === 0) {
    return null;
  }
  const absErr = Math.abs(safeFcst - safeAct);
  return Math.max(0, (1 - absErr / safeAct) * 100);
}

export function formatAccuracyLabel(accuracyPct: number | null, decimals = 1): string {
  if (accuracyPct === null || !Number.isFinite(accuracyPct)) {
    return 'N/A';
  }
  return `${accuracyPct.toFixed(decimals)}%`;
}

export function clampNegativeActual(rawActual: number): {
  clampedActual: number;
  returnQty: number;
  wasClamped: boolean;
} {
  const numeric = Number.isFinite(rawActual) ? rawActual : 0;
  if (numeric < 0) {
    return {
      clampedActual: 0,
      returnQty: Math.abs(numeric),
      wasClamped: true,
    };
  }
  return {
    clampedActual: numeric,
    returnQty: 0,
    wasClamped: false,
  };
}

export function calcUncensoredDemand(
  actual: number,
  stockoutDays: number,
  bucketDays = 30
): number {
  const safeAct = Math.max(0, Number.isFinite(actual) ? actual : 0);
  const clampedDays = Math.min(bucketDays - 1, Math.max(0, Number.isFinite(stockoutDays) ? stockoutDays : 0));
  if (clampedDays === 0) return Math.round(safeAct);
  return Math.round(safeAct / (1 - clampedDays / bucketDays));
}

export function evaluateDemandMetrics(
  rawActual: number,
  rawForecast: number,
  stockoutDays = 0,
  stdDev = 1
): RowDemandEvaluation {
  const { clampedActual, returnQty, wasClamped } = clampNegativeActual(rawActual);
  const safeForecast = Math.max(0, Number.isFinite(rawForecast) ? rawForecast : 0);
  const uncensoredDemand = calcUncensoredDemand(clampedActual, stockoutDays, 30);
  const unitError = safeForecast - clampedActual;
  const absError = Math.abs(unitError);
  const accuracyPct = calcRowAccuracyPct(clampedActual, safeForecast);
  const safeStd = Math.max(1e-6, Number.isFinite(stdDev) && stdDev > 0 ? stdDev : 1);
  const zScore = Math.abs(clampedActual - safeForecast) / safeStd;

  return {
    rawActual,
    rawForecast,
    safeActual: clampedActual,
    safeForecast,
    returnQty,
    wasNegativeClamped: wasClamped,
    uncensoredDemand,
    stockoutRecoveredUnits: uncensoredDemand - clampedActual,
    unitError,
    absError,
    accuracyPct,
    accuracyLabel: formatAccuracyLabel(accuracyPct, 1),
    zScore,
    isOutlier: zScore > 3,
  };
}

export function calcWmapeAccuracy(actuals: number[], forecasts: number[]): number | null {
  if (actuals.length === 0 || actuals.length !== forecasts.length) return null;
  let totalActual = 0;
  let totalAbsError = 0;
  for (let i = 0; i < actuals.length; i++) {
    const act = Math.max(0, actuals[i] ?? 0);
    const fcst = Math.max(0, forecasts[i] ?? 0);
    totalActual += act;
    totalAbsError += Math.abs(fcst - act);
  }
  if (totalActual === 0) return null;
  return Math.max(0, (1 - totalAbsError / totalActual) * 100);
}

export function calcCumulativeBias(
  actuals: number[],
  forecasts: number[]
): { signedErrorSum: number; biasPct: number | null; meanBiasPerPeriod: number } {
  const n = Math.min(actuals.length, forecasts.length);
  if (n === 0) return { signedErrorSum: 0, biasPct: null, meanBiasPerPeriod: 0 };
  let signedErrorSum = 0;
  let totalForecast = 0;
  for (let i = 0; i < n; i++) {
    const act = Math.max(0, actuals[i] ?? 0);
    const fcst = Math.max(0, forecasts[i] ?? 0);
    signedErrorSum += fcst - act;
    totalForecast += fcst;
  }
  const biasPct = totalForecast > 0 ? (signedErrorSum / totalForecast) * 100 : null;
  const meanBiasPerPeriod = signedErrorSum / n;
  return { signedErrorSum, biasPct, meanBiasPerPeriod };
}

export function calcTrackingSignal(
  actuals: number[],
  forecasts: number[]
): { trackingSignal: number; mad: number; alertTriggered: boolean } {
  const n = Math.min(actuals.length, forecasts.length);
  if (n === 0) return { trackingSignal: 0, mad: 0, alertTriggered: false };
  let signedSum = 0;
  let absSum = 0;
  for (let i = 0; i < n; i++) {
    const err = Math.max(0, forecasts[i] ?? 0) - Math.max(0, actuals[i] ?? 0);
    signedSum += err;
    absSum += Math.abs(err);
  }
  const mad = absSum / n;
  const trackingSignal = mad > 0 ? signedSum / mad : 0;
  return {
    trackingSignal,
    mad,
    alertTriggered: Math.abs(trackingSignal) > 4,
  };
}

export function calcLeaveOneOutSigma(
  series: number[],
  targetIndex: number
): { looMean: number; looStd: number; zScore: number } {
  const others = series.filter((_, idx) => idx !== targetIndex);
  if (others.length < 2) return { looMean: 0, looStd: 0, zScore: 0 };
  const mean = others.reduce((a, b) => a + b, 0) / others.length;
  const variance =
    others.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / (others.length - 1);
  const std = Math.sqrt(variance);
  const target = series[targetIndex] ?? mean;
  const zScore = std > 0 ? Math.abs(target - mean) / std : 0;
  return { looMean: mean, looStd: std, zScore };
}

export function calcL0TrendRecovery(
  overhangForecasts: number[],
  cleanBaselines: number[]
): number {
  const n = Math.min(overhangForecasts.length, cleanBaselines.length);
  let saved = 0;
  for (let i = 0; i < n; i++) {
    saved += Math.max(0, overhangForecasts[i] - cleanBaselines[i]);
  }
  return Math.round(saved);
}

export function calcPromoNetLift(
  grossLiftPct: number,
  postPromoDipPct: number
): number {
  return Number((grossLiftPct - postPromoDipPct).toFixed(1));
}

export function calcCannibalizationNet(
  launchUnits: number,
  sisterBaseUnits: number,
  cannibalizationRatePct: number
): { sisterLossUnits: number; netPortfolioGain: number } {
  const sisterLossUnits = Math.round(sisterBaseUnits * (cannibalizationRatePct / 100));
  return {
    sisterLossUnits,
    netPortfolioGain: Math.round(launchUnits - sisterLossUnits),
  };
}

export function calcSeriesCoV(series: number[]): number {
  if (series.length < 2) return 0;
  const mean = series.reduce((a, b) => a + b, 0) / series.length;
  if (mean === 0) return 0;
  const variance =
    series.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / (series.length - 1);
  return (Math.sqrt(variance) / mean) * 100;
}

export function calcBullwhipRatio(
  primaryBillingSeries: number[],
  posSellOutSeries: number[]
): { primaryCoV: number; posCoV: number; ratio: number } {
  const primaryCoV = calcSeriesCoV(primaryBillingSeries);
  const posCoV = calcSeriesCoV(posSellOutSeries);
  const ratio = posCoV > 0 ? primaryCoV / posCoV : 0;
  return { primaryCoV, posCoV, ratio };
}

export function calcMeioSafetyStockDelta(
  zValue: number,
  rmseReduction: number,
  leadTimeMonths: number
): number {
  return -Math.round(zValue * rmseReduction * Math.sqrt(Math.max(0, leadTimeMonths)));
}

export interface WeeklyBucketInput {
  week: string;
  forecast: number;
  orders: number;
}

export interface WeeklyBucketResult {
  week: string;
  forecast: number;
  orders: number;
  consumedForecast: number;
  spilloverOut: number;
  remainingForecast: number;
  netSupplyRequirement: number;
}

export function calcWeeklyOrderConsumption(
  buckets: WeeklyBucketInput[]
): { rows: WeeklyBucketResult[]; totalRtf: number } {
  let carryOverOrders = 0;
  const rows: WeeklyBucketResult[] = [];

  for (const b of buckets) {
    const effectiveOrders = b.orders + carryOverOrders;
    const consumedForecast = Math.min(b.forecast, effectiveOrders);
    const spilloverOut = Math.max(0, effectiveOrders - b.forecast);
    const remainingForecast = Math.max(0, b.forecast - consumedForecast);
    // Net supply needed in this bucket: unconsumed forecast + orders physically due this bucket (minus prior spillover already counted in earlier bucket)
    const netSupplyRequirement = Math.max(b.orders, b.forecast - carryOverOrders);
    carryOverOrders = spilloverOut;

    rows.push({
      week: b.week,
      forecast: b.forecast,
      orders: b.orders,
      consumedForecast,
      spilloverOut,
      remainingForecast,
      netSupplyRequirement,
    });
  }

  const totalRtf = rows.reduce((sum, r) => sum + r.netSupplyRequirement, 0);
  return { rows, totalRtf };
}
