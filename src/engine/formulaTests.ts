import {
  calcBullwhipRatio,
  calcCannibalizationNet,
  calcCumulativeBias,
  calcL0TrendRecovery,
  calcLeaveOneOutSigma,
  calcMeioSafetyStockDelta,
  calcPromoNetLift,
  calcTrackingSignal,
  calcWeeklyOrderConsumption,
  calcWmapeAccuracy,
  evaluateDemandMetrics,
} from './calculations';
import { FormulaTestCase } from './types';

function expectThrow(fn: () => unknown): string {
  try {
    fn();
    return 'NO_ERROR';
  } catch (err) {
    return err instanceof Error ? 'THREW_ERROR' : 'THREW_ERROR';
  }
}

export function runIndependentFormulaTests(): FormulaTestCase[] {
  const results: FormulaTestCase[] = [];

  // TC-01: WMAPE Accuracy computed from actual series arrays
  const tc01Actuals = [2400, 2350, 2410, 2380, 2420, 2390, 2430, 2370, 2440, 2360, 2450, 2340];
  const tc01Forecasts = [2540, 2220, 2560, 2240, 2550, 2260, 2580, 2210, 2600, 2210, 2590, 2230];
  const tc01Out = calcWmapeAccuracy(tc01Actuals, tc01Forecasts);
  const tc01ActualStr = tc01Out === null ? 'N/A' : `${tc01Out.toFixed(2)}%`;
  const tc01Expected = '94.12%';
  results.push({
    id: 'TC-01',
    name: 'WMAPE & Forecast Accuracy',
    scenario: '12M series (ΣActual = 28,740 u, Σ|Error| = 1,690 u)',
    expected: tc01Expected,
    actual: tc01ActualStr,
    passed: tc01ActualStr === tc01Expected,
  });

  // TC-02: Cumulative Forecast Bias ((Forecast - Actual) / ΣForecast)
  const tc02Out = calcCumulativeBias([1000, 1200, 1100, 1300], [900, 1100, 1000, 1200]);
  const tc02ActualStr = `${tc02Out.biasPct !== null ? tc02Out.biasPct.toFixed(2) : 'N/A'}% (${tc02Out.meanBiasPerPeriod.toFixed(1)} u/mo)`;
  const tc02Expected = '-9.52% (-100.0 u/mo)';
  results.push({
    id: 'TC-02',
    name: 'Cumulative Forecast Bias',
    scenario: '4-period persistent under-forecasting (100 u/period, ΣFcst = 4,200)',
    expected: tc02Expected,
    actual: tc02ActualStr,
    passed: tc02ActualStr === tc02Expected,
  });

  // TC-03: Tracking Signal
  const tc03Out = calcTrackingSignal([500, 520, 510, 530, 540, 550], [400, 420, 410, 430, 440, 450]);
  const tc03ActualStr = `${tc03Out.trackingSignal.toFixed(2)} (${tc03Out.alertTriggered ? 'Alert > ±4' : 'Normal'})`;
  const tc03Expected = '-6.00 (Alert > ±4)';
  results.push({
    id: 'TC-03',
    name: 'Tracking Signal (TS)',
    scenario: '6 periods of -100 u error (ΣErr = -600, MAD = 100)',
    expected: tc03Expected,
    actual: tc03ActualStr,
    passed: tc03ActualStr === tc03Expected,
  });

  // TC-04: 0 / 0 Zero-Sales Guard (MUST return N/A accuracy & 0 unit error)
  const tc04Out = evaluateDemandMetrics(0, 0, 0, 150);
  const tc04ActualStr = `${tc04Out.unitError} u Err | ${tc04Out.accuracyLabel} Acc`;
  const tc04Expected = '0 u Err | N/A Acc';
  results.push({
    id: 'TC-04',
    name: '0 / 0 Zero-Sales Guard',
    scenario: 'Actual = 0 u, Forecast = 0 u (Strict N/A accuracy rule)',
    expected: tc04Expected,
    actual: tc04ActualStr,
    passed: tc04ActualStr === tc04Expected,
  });

  // TC-05: Negative Return Clamping
  const tc05Out = evaluateDemandMetrics(-410, 1740, 0, 210);
  const tc05ActualStr = `${tc05Out.safeActual} u Actual | ${tc05Out.returnQty} u Return`;
  const tc05Expected = '0 u Actual | 410 u Return';
  results.push({
    id: 'TC-05',
    name: 'Negative Return Clamping',
    scenario: 'Raw Invoice = -410 u clamped to ≥ 0 u & split to Returns',
    expected: tc05Expected,
    actual: tc05ActualStr,
    passed: tc05ActualStr === tc05Expected,
  });

  // TC-06: Leave-One-Out Outlier Sigma (σ) Clipping
  const tc06Series = [2300, 2400, 2350, 2450, 2380, 2320, 5435, 2390, 2360, 2410, 2370, 2340];
  const tc06Out = calcLeaveOneOutSigma(tc06Series, 6);
  const tc06ActualStr = `${tc06Out.zScore !== null ? tc06Out.zScore.toFixed(2) : 'Inf'}σ LOO Residual`;
  const tc06Expected = '71.84σ LOO Residual';
  results.push({
    id: 'TC-06',
    name: 'Outlier Sigma (σ) Clipping',
    scenario: 'Sep Spike 5,435 u against 11-mo LOO base (μ = 2,370, σ = 42.66)',
    expected: tc06Expected,
    actual: tc06ActualStr,
    passed: tc06ActualStr === tc06Expected,
  });

  // TC-07: L0 Trend Overhang Recovery
  const tc07Out = calcL0TrendRecovery([3105, 2945, 2683], [2363, 2399, 2400]);
  const tc07ActualStr = `${tc07Out.toLocaleString()} u Saved`;
  const tc07Expected = '1,571 u Saved';
  results.push({
    id: 'TC-07',
    name: 'L0 Trend Baseline Recovery',
    scenario: 'Q4 Post-Spike Overhang ([3105,2945,2683] vs [2363,2399,2400])',
    expected: tc07Expected,
    actual: tc07ActualStr,
    passed: tc07ActualStr === tc07Expected,
  });

  // TC-08: Promo Lift Decomposition
  const tc08Out = calcPromoNetLift(32.0, 6.5);
  const tc08ActualStr = `+${tc08Out.toFixed(1)}% Net Lift`;
  const tc08Expected = '+25.5% Net Lift';
  results.push({
    id: 'TC-08',
    name: 'Promo Lift Decomposition',
    scenario: 'Gross +32.0% Lift minus -6.5% Post-Promo Pantry Dip',
    expected: tc08Expected,
    actual: tc08ActualStr,
    passed: tc08ActualStr === tc08Expected,
  });

  // TC-09: Cross-SKU Cannibalization Netting
  const tc09Out = calcCannibalizationNet(2498, 4858, 12);
  const tc09ActualStr = `+${tc09Out.netPortfolioGain.toLocaleString()} u Net Gain`;
  const tc09Expected = '+1,915 u Net Gain';
  results.push({
    id: 'TC-09',
    name: 'Cannibalization Netting',
    scenario: 'Launch +2,498 u minus 12% of 4,858 u Sister SKU (-583 u)',
    expected: tc09Expected,
    actual: tc09ActualStr,
    passed: tc09ActualStr === tc09Expected,
  });

  // TC-10: Bullwhip Variance Ratio
  const tc10Out = calcBullwhipRatio(
    [800, 1600, 600, 1800, 700, 1700],
    [1150, 1250, 1180, 1220, 1190, 1210]
  );
  const tc10ActualStr =
    tc10Out.ratio !== null ? `${tc10Out.ratio.toFixed(2)}x Amplification` : 'N/A';
  const tc10Expected = '16.02x Amplification';
  results.push({
    id: 'TC-10',
    name: 'Bullwhip Variance Ratio',
    scenario: 'Primary Billing CoV (46.25%) / POS Sell-Out CoV (2.89%)',
    expected: tc10Expected,
    actual: tc10ActualStr,
    passed: tc10ActualStr === tc10Expected,
  });

  // TC-11: MEIO Safety Stock Delta
  const tc11Out = calcMeioSafetyStockDelta(2.05, 170, 0.75);
  const tc11ActualStr = `${tc11Out} u Buffer Cut`;
  const tc11Expected = '-302 u Buffer Cut';
  results.push({
    id: 'TC-11',
    name: 'MEIO Safety Stock (Z·σ·√LT)',
    scenario: 'Z = 2.05 (98% OTIF), ΔRMSE = 170 u, Lead Time = 0.75 mo',
    expected: tc11Expected,
    actual: tc11ActualStr,
    passed: tc11ActualStr === tc11Expected,
  });

  // TC-12: W1–W3 Order Consumption Netting
  const tc12Out = calcWeeklyOrderConsumption([
    { week: 'W1', forecast: 800, orders: 920 },
    { week: 'W2', forecast: 850, orders: 610 },
    { week: 'W3', forecast: 900, orders: 340 },
  ]);
  const tc12ActualStr = `W2 Rem = ${tc12Out.rows[1].remainingForecast} u | RTF = ${tc12Out.totalRtf.toLocaleString()} u`;
  const tc12Expected = 'W2 Rem = 120 u | RTF = 2,550 u';
  results.push({
    id: 'TC-12',
    name: 'W1–W3 Order Consumption',
    scenario: 'W1 Fcst 800, Orders 920 (+120 spillover) → W2/W3 Net RTF',
    expected: tc12Expected,
    actual: tc12ActualStr,
    passed: tc12ActualStr === tc12Expected,
  });

  // TC-13: Zero Actual + Positive Forecast -> +100 u Error, N/A Accuracy
  const tc13Out = evaluateDemandMetrics(0, 100, 0, 50);
  const tc13ActualStr = `+${tc13Out.unitError} u Err | ${tc13Out.accuracyLabel} Acc`;
  const tc13Expected = '+100 u Err | N/A Acc';
  results.push({
    id: 'TC-13',
    name: 'Zero Actual + Positive Forecast',
    scenario: 'Actual = 0 u, Forecast = 100 u (Strict N/A accuracy rule)',
    expected: tc13Expected,
    actual: tc13ActualStr,
    passed: tc13ActualStr === tc13Expected,
  });

  // TC-14: Mismatched Array Lengths Rejected
  const tc14Out = expectThrow(() => calcWmapeAccuracy([100, 200], [100]));
  results.push({
    id: 'TC-14',
    name: 'Mismatched Series Length Guard',
    scenario: 'Actuals len=2 vs Forecasts len=1 must throw rather than truncate',
    expected: 'THREW_ERROR',
    actual: tc14Out,
    passed: tc14Out === 'THREW_ERROR',
  });

  // TC-15: Invalid / Non-Finite Numeric Guard
  const tc15Out = expectThrow(() => evaluateDemandMetrics(Number.NaN, 100, 0, 50));
  results.push({
    id: 'TC-15',
    name: 'Invalid / NaN Numeric Guard',
    scenario: 'Non-finite Actual (NaN) must be rejected explicitly',
    expected: 'THREW_ERROR',
    actual: tc15Out,
    passed: tc15Out === 'THREW_ERROR',
  });

  // TC-16: Zero Standard Deviation Constant-Baseline Outlier Detection
  const tc16Out = calcLeaveOneOutSigma([100, 100, 100, 500], 3);
  const tc16ActualStr = `${tc16Out.isConstantBaseline ? 'ConstBase' : 'Var'} | ${tc16Out.isOutlier ? 'Outlier' : 'Normal'} | z=${tc16Out.zScore === null ? 'Inf' : tc16Out.zScore}`;
  const tc16Expected = 'ConstBase | Outlier | z=Inf';
  results.push({
    id: 'TC-16',
    name: 'Zero-Variance Outlier Guard',
    scenario: 'Baseline [100,100,100] (σ=0) vs Target 500 must flag outlier',
    expected: tc16Expected,
    actual: tc16ActualStr,
    passed: tc16ActualStr === tc16Expected,
  });

  // TC-17: Cumulative Bias with Zero Total Forecast
  const tc17Out = calcCumulativeBias([200, 300], [0, 0]);
  const tc17ActualStr = `Err=${tc17Out.signedErrorSum} | Bias=${tc17Out.biasPct === null ? 'N/A' : tc17Out.biasPct}`;
  const tc17Expected = 'Err=-500 | Bias=N/A';
  results.push({
    id: 'TC-17',
    name: 'Cumulative Bias Zero Forecast',
    scenario: 'ΣForecast = 0 u with Actuals = 500 u must return Bias=N/A',
    expected: tc17Expected,
    actual: tc17ActualStr,
    passed: tc17ActualStr === tc17Expected,
  });

  // TC-18: Negative Weekly Orders / Forecasts Rejected
  const tc18Out = expectThrow(() =>
    calcWeeklyOrderConsumption([{ week: 'W1', forecast: 800, orders: -50 }])
  );
  results.push({
    id: 'TC-18',
    name: 'Negative Weekly Order Guard',
    scenario: 'Negative weekly confirmed orders (-50 u) must be rejected',
    expected: 'THREW_ERROR',
    actual: tc18Out,
    passed: tc18Out === 'THREW_ERROR',
  });

  return results;
}
