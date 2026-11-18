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
  zScore: number | null;
  isOutlier: boolean;
}

function assertFiniteSeries(values: number[], name: string): void {
  for (let i = 0; i < values.length; i++) {
    if (!Number.isFinite(values[i])) {
      throw new Error(`Invalid non-finite numeric value in ${name} at index ${i}`);
    }
  }
}

function assertNonNegativeSeries(values: number[], name: string): void {
  assertFiniteSeries(values, name);
  for (let i = 0; i < values.length; i++) {
    if (values[i] < 0) {
      throw new Error(`Invalid negative numeric value (${values[i]}) in ${name} at index ${i}`);
    }
  }
}

function assertMatchingSeries(actuals: number[], forecasts: number[], fnName: string): void {
  if (actuals.length !== forecasts.length) {
    throw new Error(
      `${fnName}: Series length mismatch (actuals=${actuals.length}, forecasts=${forecasts.length})`
    );
  }
  assertNonNegativeSeries(actuals, 'actuals');
  assertNonNegativeSeries(forecasts, 'forecasts');
}

/**
 * Enforces the required zero-sales rule:
 * When Actual === 0, percentage accuracy MUST be null ("N/A"), even when Forecast === 0.
 * Unit error (Forecast - Actual) can still be 0.
 * Rejects negative actuals or negative forecasts rather than silently clamping.
 */
export function calcRowAccuracyPct(actual: number, forecast: number): number | null {
  if (!Number.isFinite(actual) || !Number.isFinite(forecast)) {
    throw new Error('calcRowAccuracyPct: actual and forecast must be finite numbers');
  }
  if (actual < 0 || forecast < 0) {
    throw new Error('calcRowAccuracyPct: actual and forecast must be non-negative');
  }
  if (actual === 0) {
    return null;
  }
  const absErr = Math.abs(forecast - actual);
  return Math.max(0, (1 - absErr / actual) * 100);
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
  if (!Number.isFinite(rawActual)) {
    throw new Error('clampNegativeActual: rawActual must be a finite number');
  }
  if (rawActual < 0) {
    return {
      clampedActual: 0,
      returnQty: Math.abs(rawActual),
      wasClamped: true,
    };
  }
  return {
    clampedActual: rawActual,
    returnQty: 0,
    wasClamped: false,
  };
}

export function calcUncensoredDemand(
  actual: number,
  stockoutDays: number,
  bucketDays = 30
): number {
  if (!Number.isFinite(actual) || !Number.isFinite(stockoutDays) || !Number.isFinite(bucketDays)) {
    throw new Error('calcUncensoredDemand: inputs must be finite numbers');
  }
  if (actual < 0) {
    throw new Error('calcUncensoredDemand: actual cannot be negative');
  }
  if (bucketDays <= 0 || stockoutDays < 0 || stockoutDays >= bucketDays) {
    throw new Error(`calcUncensoredDemand: stockoutDays (${stockoutDays}) must be in [0, ${bucketDays})`);
  }
  if (stockoutDays === 0) return Math.round(actual);
  return Math.round(actual / (1 - stockoutDays / bucketDays));
}

export function evaluateDemandMetrics(
  rawActual: number,
  rawForecast: number,
  stockoutDays = 0,
  stdDev = 1
): RowDemandEvaluation {
  if (!Number.isFinite(rawActual) || !Number.isFinite(rawForecast)) {
    throw new Error('evaluateDemandMetrics: Actual and Forecast must be finite numbers');
  }
  if (rawForecast < 0) {
    throw new Error('evaluateDemandMetrics: rawForecast cannot be negative');
  }
  if (!Number.isFinite(stockoutDays) || stockoutDays < 0 || stockoutDays >= 30) {
    throw new Error('evaluateDemandMetrics: stockoutDays must be between 0 and 29');
  }
  if (!Number.isFinite(stdDev) || stdDev < 0) {
    throw new Error('evaluateDemandMetrics: stdDev must be a non-negative finite number');
  }

  const { clampedActual, returnQty, wasClamped } = clampNegativeActual(rawActual);
  const safeForecast = rawForecast;
  const uncensoredDemand = calcUncensoredDemand(clampedActual, stockoutDays, 30);
  const unitError = safeForecast - clampedActual;
  const absError = Math.abs(unitError);
  const accuracyPct = calcRowAccuracyPct(clampedActual, safeForecast);

  let zScore: number | null = 0;
  let isOutlier = false;
  if (stdDev === 0) {
    if (clampedActual === safeForecast) {
      zScore = 0;
      isOutlier = false;
    } else {
      zScore = null;
      isOutlier = true;
    }
  } else {
    zScore = Math.abs(clampedActual - safeForecast) / stdDev;
    isOutlier = zScore > 3;
  }

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
    isOutlier,
  };
}

export function calcWmapeAccuracy(actuals: number[], forecasts: number[]): number | null {
  assertMatchingSeries(actuals, forecasts, 'calcWmapeAccuracy');
  if (actuals.length === 0) return null;

  let totalActual = 0;
  let totalAbsError = 0;
  for (let i = 0; i < actuals.length; i++) {
    const act = actuals[i];
    const fcst = forecasts[i];
    totalActual += act;
    totalAbsError += Math.abs(fcst - act);
  }
  if (totalActual === 0) return null;
  return Math.max(0, (1 - totalAbsError / totalActual) * 100);
}

/**
 * Cumulative Forecast Bias.
 * Sign convention: Forecast - Actual (+ indicates over-forecast, - indicates under-forecast).
 * Percentage denominator: Total Forecast (ΣForecast). Returns null ("N/A") when Total Forecast === 0.
 */
export function calcCumulativeBias(
  actuals: number[],
  forecasts: number[]
): {
  signedErrorSum: number;
  totalForecast: number;
  biasPct: number | null;
  meanBiasPerPeriod: number;
  convention: string;
} {
  assertMatchingSeries(actuals, forecasts, 'calcCumulativeBias');
  const n = actuals.length;
  if (n === 0) {
    return {
      signedErrorSum: 0,
      totalForecast: 0,
      biasPct: null,
      meanBiasPerPeriod: 0,
      convention: '(Forecast - Actual) / ΣForecast',
    };
  }

  let signedErrorSum = 0;
  let totalForecast = 0;
  for (let i = 0; i < n; i++) {
    const act = actuals[i];
    const fcst = forecasts[i];
    signedErrorSum += fcst - act;
    totalForecast += fcst;
  }

  const biasPct = totalForecast > 0 ? (signedErrorSum / totalForecast) * 100 : null;
  const meanBiasPerPeriod = signedErrorSum / n;
  return {
    signedErrorSum,
    totalForecast,
    biasPct,
    meanBiasPerPeriod,
    convention: '(Forecast - Actual) / ΣForecast',
  };
}

export function calcTrackingSignal(
  actuals: number[],
  forecasts: number[]
): { trackingSignal: number; mad: number; alertTriggered: boolean } {
  assertMatchingSeries(actuals, forecasts, 'calcTrackingSignal');
  const n = actuals.length;
  if (n === 0) return { trackingSignal: 0, mad: 0, alertTriggered: false };

  let signedSum = 0;
  let absSum = 0;
  for (let i = 0; i < n; i++) {
    const err = forecasts[i] - actuals[i];
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

/**
 * Leave-One-Out Outlier Sigma detection.
 * Requires targetIndex to be an integer within [0, series.length).
 * Handles constant-baseline (zero standard deviation) explicitly:
 * If looStd === 0 and target !== looMean, returns isConstantBaseline = true, isOutlier = true, zScore = null.
 */
export function calcLeaveOneOutSigma(
  series: number[],
  targetIndex: number
): {
  looMean: number;
  looStd: number;
  zScore: number | null;
  isConstantBaseline: boolean;
  isOutlier: boolean;
} {
  assertNonNegativeSeries(series, 'series');
  if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= series.length) {
    throw new Error(
      `calcLeaveOneOutSigma: targetIndex ${targetIndex} must be an integer within bounds`
    );
  }
  const others = series.filter((_, idx) => idx !== targetIndex);
  if (others.length < 2) {
    return {
      looMean: 0,
      looStd: 0,
      zScore: 0,
      isConstantBaseline: false,
      isOutlier: false,
    };
  }
  const mean = others.reduce((a, b) => a + b, 0) / others.length;
  const variance =
    others.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / (others.length - 1);
  const std = Math.sqrt(variance);
  const target = series[targetIndex];

  if (std === 0) {
    const differs = target !== mean;
    return {
      looMean: mean,
      looStd: 0,
      zScore: differs ? null : 0,
      isConstantBaseline: true,
      isOutlier: differs,
    };
  }

  const zScore = Math.abs(target - mean) / std;
  return {
    looMean: mean,
    looStd: std,
    zScore,
    isConstantBaseline: false,
    isOutlier: zScore > 3,
  };
}

export function calcL0TrendRecovery(
  overhangForecasts: number[],
  cleanBaselines: number[]
): number {
  assertMatchingSeries(cleanBaselines, overhangForecasts, 'calcL0TrendRecovery');
  let saved = 0;
  for (let i = 0; i < overhangForecasts.length; i++) {
    saved += Math.max(0, overhangForecasts[i] - cleanBaselines[i]);
  }
  return Math.round(saved);
}

export function calcPromoNetLift(
  grossLiftPct: number,
  postPromoDipPct: number
): number {
  if (!Number.isFinite(grossLiftPct) || !Number.isFinite(postPromoDipPct)) {
    throw new Error('calcPromoNetLift: inputs must be finite numbers');
  }
  return Number((grossLiftPct - postPromoDipPct).toFixed(1));
}

export function calcCannibalizationNet(
  launchUnits: number,
  sisterBaseUnits: number,
  cannibalizationRatePct: number
): { sisterLossUnits: number; netPortfolioGain: number } {
  if (
    !Number.isFinite(launchUnits) ||
    !Number.isFinite(sisterBaseUnits) ||
    !Number.isFinite(cannibalizationRatePct)
  ) {
    throw new Error('calcCannibalizationNet: inputs must be finite numbers');
  }
  if (launchUnits < 0 || sisterBaseUnits < 0 || cannibalizationRatePct < 0 || cannibalizationRatePct > 100) {
    throw new Error('calcCannibalizationNet: units must be >= 0 and cannibalizationRatePct in [0, 100]');
  }
  const sisterLossUnits = Math.round(sisterBaseUnits * (cannibalizationRatePct / 100));
  return {
    sisterLossUnits,
    netPortfolioGain: Math.round(launchUnits - sisterLossUnits),
  };
}

/**
 * Coefficient of Variation (CoV = σ / μ * 100).
 * Rejects negative values in demand series; returns null when series has < 2 points or mean === 0.
 */
export function calcSeriesCoV(series: number[]): number | null {
  assertNonNegativeSeries(series, 'series');
  if (series.length < 2) return null;
  const mean = series.reduce((a, b) => a + b, 0) / series.length;
  if (mean === 0) return null;
  const variance =
    series.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / (series.length - 1);
  return (Math.sqrt(variance) / mean) * 100;
}

/**
 * Bullwhip Variance Amplification Ratio (Primary Billing CoV / POS Sell-Out CoV).
 * Returns ratio = null when either CoV is undefined or when POS Sell-Out CoV is 0.
 */
export function calcBullwhipRatio(
  primaryBillingSeries: number[],
  posSellOutSeries: number[]
): { primaryCoV: number | null; posCoV: number | null; ratio: number | null } {
  assertMatchingSeries(primaryBillingSeries, posSellOutSeries, 'calcBullwhipRatio');
  const primaryCoV = calcSeriesCoV(primaryBillingSeries);
  const posCoV = calcSeriesCoV(posSellOutSeries);
  if (primaryCoV === null || posCoV === null || posCoV === 0) {
    return { primaryCoV, posCoV, ratio: null };
  }
  return { primaryCoV, posCoV, ratio: primaryCoV / posCoV };
}

export function calcMeioSafetyStockDelta(
  zValue: number,
  rmseReduction: number,
  leadTimeMonths: number
): number {
  if (!Number.isFinite(zValue) || !Number.isFinite(rmseReduction) || !Number.isFinite(leadTimeMonths)) {
    throw new Error('calcMeioSafetyStockDelta: inputs must be finite numbers');
  }
  if (zValue < 0 || rmseReduction < 0 || leadTimeMonths < 0) {
    throw new Error('calcMeioSafetyStockDelta: zValue, rmseReduction, and leadTimeMonths cannot be negative');
  }
  return -Math.round(zValue * rmseReduction * Math.sqrt(leadTimeMonths));
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
  for (let i = 0; i < buckets.length; i++) {
    const b = buckets[i];
    if (!Number.isFinite(b.forecast) || b.forecast < 0) {
      throw new Error(`calcWeeklyOrderConsumption: invalid negative/non-finite forecast in ${b.week}`);
    }
    if (!Number.isFinite(b.orders) || b.orders < 0) {
      throw new Error(`calcWeeklyOrderConsumption: invalid negative/non-finite orders in ${b.week}`);
    }
  }

  let carryOverOrders = 0;
  const rows: WeeklyBucketResult[] = [];

  for (const b of buckets) {
    const effectiveOrders = b.orders + carryOverOrders;
    const consumedForecast = Math.min(b.forecast, effectiveOrders);
    const spilloverOut = Math.max(0, effectiveOrders - b.forecast);
    const remainingForecast = Math.max(0, b.forecast - consumedForecast);
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
