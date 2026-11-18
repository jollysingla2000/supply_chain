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

export function runIndependentFormulaTests(): FormulaTestCase[] {
  const results: FormulaTestCase[] = [];

  // TC-01: WMAPE Accuracy computed from actual series arrays via calcWmapeAccuracy
  const tc01Actuals = [2400, 2350, 2410, 2380, 2420, 2390, 2430, 2370, 2440, 2360, 2450, 2340];
  const tc01Forecasts = [2540, 2220, 2560, 2240, 2550, 2260, 2580, 2210, 2600, 2210, 2590, 2230];
  // Sum(actuals) = 28,740; Sum(|f - a|) = 140+130+150+140+130+130+150+160+160+150+140+110 = 1,690
  // Independent expected = (1 - 1690 / 28740) * 100 = 94.12%
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

  // TC-02: Cumulative Forecast Bias
  const tc02Actuals = [1000, 1200, 1100, 1300];
  const tc02Forecasts = [900, 1100, 1000, 1200];
  // Sum(f - a) = -400; Sum(f) = 4200; biasPct = -9.52%; mean = -100.0 u/mo
  const tc02Out = calcCumulativeBias(tc02Actuals, tc02Forecasts);
  const tc02ActualStr = `${tc02Out.biasPct !== null ? tc02Out.biasPct.toFixed(2) : 'N/A'}% (${tc02Out.meanBiasPerPeriod.toFixed(1)} u/mo)`;
  const tc02Expected = '-9.52% (-100.0 u/mo)';
  results.push({
    id: 'TC-02',
    name: 'Cumulative Forecast Bias',
    scenario: '4-period persistent under-forecasting (100 u/period)',
    expected: tc02Expected,
    actual: tc02ActualStr,
    passed: tc02ActualStr === tc02Expected,
  });

  // TC-03: Tracking Signal (TS = Cumulative Signed Error / MAD)
  const tc03Actuals = [500, 520, 510, 530, 540, 550];
  const tc03Forecasts = [400, 420, 410, 430, 440, 450];
  // Signed errors all -100 -> sum = -600, MAD = 100 -> TS = -6.00 (Alert > ±4)
  const tc03Out = calcTrackingSignal(tc03Actuals, tc03Forecasts);
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

  // TC-04: 0 / 0 Zero-Sales Guard (MUST return N/A for accuracy %, 0 for unit error)
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

  // TC-06: Leave-One-Out Outlier Sigma (σ) Clipping (real calculation, not hardcoded string!)
  const tc06Series = [2300, 2400, 2350, 2450, 2380, 2320, 5435, 2390, 2360, 2410, 2370, 2340];
  // Excluding index 6 (5435): 11 values = [2300,2400,2350,2450,2380,2320,2390,2360,2410,2370,2340]
  // Mean = 26,070 / 11 = 2370.0; Deviations: -70, +30, -20, +80, +10, -50, +20, -10, +40, 0, -30
  // Sum sq = 4900+900+400+6400+100+2500+400+100+1600+0+900 = 18,200; var = 18200 / 10 = 1820; std = sqrt(1820) = 42.6615
  // Z = (5435 - 2370) / 42.6615 = 3065 / 42.6615 = 71.84σ
  const tc06Out = calcLeaveOneOutSigma(tc06Series, 6);
  const tc06ActualStr = `${tc06Out.zScore.toFixed(2)}σ LOO Residual`;
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
  const tc07Overhang = [3105, 2945, 2683];
  const tc07Clean = [2363, 2399, 2400];
  const tc07Out = calcL0TrendRecovery(tc07Overhang, tc07Clean);
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
  // 4858 * 0.12 = 582.96 -> 583; 2498 - 583 = 1915
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

  // TC-10: Bullwhip Variance Ratio (actual CoV of Primary vs POS series)
  const tc10Primary = [800, 1600, 600, 1800, 700, 1700];
  const tc10Pos = [1150, 1250, 1180, 1220, 1190, 1210];
  // Primary mean = 1200, std = sqrt((400^2+400^2+600^2+600^2+500^2+500^2)/5) = sqrt(1540000/5)=554.977 -> CoV = 46.248%
  // POS mean = 1200, std = sqrt((50^2+50^2+20^2+20^2+10^2+10^2)/5) = sqrt(6000/5)=34.641 -> CoV = 2.887%
  // Ratio = 46.248 / 2.887 = 16.02x
  const tc10Out = calcBullwhipRatio(tc10Primary, tc10Pos);
  const tc10ActualStr = `${tc10Out.ratio.toFixed(2)}x Amplification`;
  const tc10Expected = '16.02x Amplification';
  results.push({
    id: 'TC-10',
    name: 'Bullwhip Variance Ratio',
    scenario: 'Primary Billing CoV (46.25%) / POS Sell-Out CoV (2.89%)',
    expected: tc10Expected,
    actual: tc10ActualStr,
    passed: tc10ActualStr === tc10Expected,
  });

  // TC-11: MEIO Safety Stock Delta (Z * ΔRMSE * √LT)
  const tc11Out = calcMeioSafetyStockDelta(2.05, 170, 0.75);
  // -round(2.05 * 170 * sqrt(0.75)) = -round(301.81) = -302
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
  const w2Rem = tc12Out.rows[1].remainingForecast;
  const tc12ActualStr = `W2 Rem = ${w2Rem} u | RTF = ${tc12Out.totalRtf.toLocaleString()} u`;
  const tc12Expected = 'W2 Rem = 120 u | RTF = 2,550 u';
  results.push({
    id: 'TC-12',
    name: 'W1–W3 Order Consumption',
    scenario: 'W1 Fcst 800, Orders 920 (+120 spillover) → W2/W3 Net RTF',
    expected: tc12Expected,
    actual: tc12ActualStr,
    passed: tc12ActualStr === tc12Expected,
  });

  return results;
}
