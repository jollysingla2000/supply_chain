import fs from 'node:fs';
import path from 'node:path';
import { SourceMap } from 'node:module';

const V8_DIR = path.resolve('coverage/v8');
const OUT_JSON = path.resolve('coverage/capability-coverage-report.json');
const OUT_MD = path.resolve('coverage/capability-coverage-summary.md');

/**
 * Capability-to-source-slice registry (#1 through #26B).
 * Each capability maps to the exact TypeScript source line ranges in src/engine/*.ts
 * that implement its domain logic, plus its mapped automated test counts.
 */
export const CAPABILITY_COVERAGE_SPECS = [
  {
    id: '1',
    name: 'Workbook upload and ingestion',
    slices: [
      { file: 'workbook.ts', startLine: 1, endLine: 145 },
      { file: 'security.ts', startLine: 1, endLine: 33 },
    ],
    tests: { unit: 6, e2e: 3, positive: 3, negative: 3, boundary: 1, hostile: 2 },
  },
  {
    id: '2',
    name: 'Multi-sheet detection and ingestion',
    slices: [{ file: 'workbook.ts', startLine: 37, endLine: 280 }],
    tests: { unit: 5, e2e: 2, positive: 2, negative: 3, boundary: 1, hostile: 1 },
  },
  {
    id: '3',
    name: 'Source identity and fingerprint',
    slices: [{ file: 'profilingAndReconciliation.ts', startLine: 93, endLine: 238 }],
    tests: { unit: 7, e2e: 3, positive: 3, negative: 3, boundary: 1, hostile: 3 },
  },
  {
    id: '4',
    name: 'Source workbook persistence and recovery',
    slices: [{ file: 'profilingAndReconciliation.ts', startLine: 2734, endLine: 3224 }],
    tests: { unit: 5, e2e: 2, positive: 2, negative: 2, boundary: 2, hostile: 1 },
  },
  {
    id: '5',
    name: 'Dataset versioning and upload lineage',
    slices: [{ file: 'profilingAndReconciliation.ts', startLine: 2349, endLine: 2733 }],
    tests: { unit: 5, e2e: 3, positive: 3, negative: 2, boundary: 2, hostile: 1 },
  },
  {
    id: '6',
    name: 'Column-level profiling',
    slices: [
      { file: 'profilingAndReconciliation.ts', startLine: 81, endLine: 92 },
      { file: 'profilingAndReconciliation.ts', startLine: 283, endLine: 654 },
    ],
    tests: { unit: 4, e2e: 1, positive: 2, negative: 1, boundary: 2, hostile: 0 },
  },
  {
    id: '7',
    name: 'Actual data-type inference',
    slices: [
      { file: 'profilingAndReconciliation.ts', startLine: 239, endLine: 282 },
      { file: 'profilingAndReconciliation.ts', startLine: 340, endLine: 445 },
      { file: 'validation.ts', startLine: 328, endLine: 377 },
    ],
    tests: { unit: 4, e2e: 0, positive: 1, negative: 1, boundary: 2, hostile: 0 },
  },
  {
    id: '8',
    name: 'Missing values and null analysis',
    slices: [
      { file: 'profilingAndReconciliation.ts', startLine: 330, endLine: 380 },
      { file: 'profilingAndReconciliation.ts', startLine: 520, endLine: 594 },
      { file: 'validation.ts', startLine: 1175, endLine: 1235 },
      { file: 'validation.ts', startLine: 2940, endLine: 2985 },
    ],
    tests: { unit: 5, e2e: 1, positive: 2, negative: 2, boundary: 1, hostile: 1 },
  },
  {
    id: '9',
    name: 'Schema and mandatory-column validation',
    slices: [
      { file: 'schema.ts', startLine: 38, endLine: 799 },
      { file: 'validation.ts', startLine: 287, endLine: 327 },
      { file: 'validation.ts', startLine: 675, endLine: 1100 },
    ],
    tests: { unit: 7, e2e: 2, positive: 3, negative: 3, boundary: 2, hostile: 1 },
  },
  {
    id: '10',
    name: 'Schema drift detection',
    slices: [
      { file: 'profilingAndReconciliation.ts', startLine: 53, endLine: 80 },
      { file: 'profilingAndReconciliation.ts', startLine: 1753, endLine: 1909 },
    ],
    tests: { unit: 5, e2e: 2, positive: 2, negative: 2, boundary: 2, hostile: 1 },
  },
  {
    id: '11',
    name: 'Column mapping and collision prevention',
    slices: [
      { file: 'profilingAndReconciliation.ts', startLine: 1910, endLine: 2040 },
      { file: 'validation.ts', startLine: 29, endLine: 61 },
    ],
    tests: { unit: 6, e2e: 1, positive: 2, negative: 2, boundary: 1, hostile: 2 },
  },
  {
    id: '12',
    name: 'Missing-table/column remediation',
    slices: [
      { file: 'profilingAndReconciliation.ts', startLine: 2041, endLine: 2120 },
      { file: 'validation.ts', startLine: 378, endLine: 455 },
      { file: 'validation.ts', startLine: 3060, endLine: 3105 },
    ],
    tests: { unit: 5, e2e: 2, positive: 2, negative: 2, boundary: 2, hostile: 1 },
  },
  {
    id: '13',
    name: 'Data type, format and value validation',
    slices: [
      { file: 'validation.ts', startLine: 122, endLine: 152 },
      { file: 'validation.ts', startLine: 1185, endLine: 1315 },
      { file: 'security.ts', startLine: 1, endLine: 33 },
    ],
    tests: { unit: 8, e2e: 1, positive: 2, negative: 3, boundary: 2, hostile: 2 },
  },
  {
    id: '14',
    name: 'Duplicate and business-key validation',
    slices: [
      { file: 'validation.ts', startLine: 456, endLine: 511 },
      { file: 'validation.ts', startLine: 1135, endLine: 1162 },
      { file: 'validation.ts', startLine: 1315, endLine: 1336 },
      { file: 'validation.ts', startLine: 2900, endLine: 2940 },
    ],
    tests: { unit: 6, e2e: 1, positive: 2, negative: 2, boundary: 2, hostile: 1 },
  },
  {
    id: '15',
    name: 'Date, period and time-series integrity',
    slices: [
      { file: 'validation.ts', startLine: 153, endLine: 286 },
      { file: 'validation.ts', startLine: 1225, endLine: 1305 },
      { file: 'validation.ts', startLine: 2393, endLine: 2544 },
    ],
    tests: { unit: 7, e2e: 0, positive: 2, negative: 2, boundary: 3, hostile: 0 },
  },
  {
    id: '16',
    name: 'Master-data and referential integrity',
    slices: [
      { file: 'validation.ts', startLine: 1102, endLine: 1134 },
      { file: 'validation.ts', startLine: 1337, endLine: 1455 },
      { file: 'profilingAndReconciliation.ts', startLine: 1390, endLine: 1572 },
    ],
    tests: { unit: 7, e2e: 1, positive: 2, negative: 4, boundary: 2, hostile: 0 },
  },
  {
    id: '17',
    name: 'Cross-table reconciliation',
    slices: [
      { file: 'profilingAndReconciliation.ts', startLine: 655, endLine: 1752 },
      { file: 'formulaTests.ts', startLine: 16, endLine: 271 },
    ],
    tests: { unit: 12, e2e: 1, positive: 4, negative: 4, boundary: 5, hostile: 0 },
  },
  {
    id: '18',
    name: 'UOM, currency and quantity consistency',
    slices: [
      { file: 'validation.ts', startLine: 1260, endLine: 1285 },
      { file: 'validation.ts', startLine: 1360, endLine: 1385 },
      { file: 'validation.ts', startLine: 1456, endLine: 1555 },
      { file: 'validation.ts', startLine: 2985, endLine: 3025 },
    ],
    tests: { unit: 5, e2e: 0, positive: 2, negative: 2, boundary: 1, hostile: 0 },
  },
  {
    id: '19',
    name: 'Business constraints and domain rules',
    slices: [
      { file: 'schema.ts', startLine: 295, endLine: 360 },
      { file: 'validation.ts', startLine: 512, endLine: 649 },
      { file: 'validation.ts', startLine: 1556, endLine: 1720 },
      { file: 'calculations.ts', startLine: 18, endLine: 460 },
    ],
    tests: { unit: 10, e2e: 1, positive: 3, negative: 4, boundary: 4, hostile: 0 },
  },
  {
    id: '20',
    name: 'Demand Planning Data Assurance',
    slices: [
      { file: 'schema.ts', startLine: 38, endLine: 85 },
      { file: 'validation.ts', startLine: 1190, endLine: 1720 },
      { file: 'validation.ts', startLine: 2393, endLine: 2544 },
      { file: 'calculations.ts', startLine: 51, endLine: 364 },
    ],
    tests: { unit: 6, e2e: 2, positive: 3, negative: 3, boundary: 2, hostile: 0 },
  },
  {
    id: '21',
    name: 'Supply Planning Data Assurance',
    slices: [
      { file: 'schema.ts', startLine: 86, endLine: 128 },
      { file: 'validation.ts', startLine: 1595, endLine: 1650 },
      { file: 'validation.ts', startLine: 1721, endLine: 1840 },
      { file: 'validation.ts', startLine: 2270, endLine: 2310 },
      { file: 'calculations.ts', startLine: 365, endLine: 460 },
    ],
    tests: { unit: 6, e2e: 1, positive: 2, negative: 3, boundary: 2, hostile: 0 },
  },
  {
    id: '22',
    name: 'S&OP Data Assurance',
    slices: [
      { file: 'schema.ts', startLine: 129, endLine: 172 },
      { file: 'validation.ts', startLine: 675, endLine: 1100 },
      { file: 'validation.ts', startLine: 1456, endLine: 1720 },
      { file: 'profilingAndReconciliation.ts', startLine: 785, endLine: 1388 },
    ],
    tests: { unit: 5, e2e: 1, positive: 2, negative: 2, boundary: 2, hostile: 0 },
  },
  {
    id: '23',
    name: 'MEIO Data Assurance',
    slices: [
      { file: 'schema.ts', startLine: 173, endLine: 212 },
      { file: 'validation.ts', startLine: 2076, endLine: 2149 },
      { file: 'calculations.ts', startLine: 392, endLine: 421 },
    ],
    tests: { unit: 6, e2e: 1, positive: 2, negative: 3, boundary: 2, hostile: 0 },
  },
  {
    id: '24',
    name: 'Procurement Data Assurance',
    slices: [
      { file: 'schema.ts', startLine: 213, endLine: 252 },
      { file: 'validation.ts', startLine: 1721, endLine: 1965 },
    ],
    tests: { unit: 8, e2e: 2, positive: 3, negative: 4, boundary: 3, hostile: 0 },
  },
  {
    id: '25',
    name: 'Manufacturing Data Assurance',
    slices: [
      { file: 'schema.ts', startLine: 253, endLine: 294 },
      { file: 'validation.ts', startLine: 1966, endLine: 2075 },
      { file: 'validation.ts', startLine: 2150, endLine: 2269 },
    ],
    tests: { unit: 7, e2e: 1, positive: 2, negative: 4, boundary: 2, hostile: 0 },
  },
  {
    id: '26A',
    name: 'Certification engine: release gate, evidence matrix and audit linkage',
    slices: [
      { file: 'validation.ts', startLine: 62, endLine: 121 },
      { file: 'validation.ts', startLine: 675, endLine: 1100 },
      { file: 'validation.ts', startLine: 2545, endLine: 3348 },
      { file: 'profilingAndReconciliation.ts', startLine: 2121, endLine: 2733 },
    ],
    tests: { unit: 9, e2e: 4, positive: 4, negative: 4, boundary: 2, hostile: 3 },
  },
  {
    id: '26B',
    name: 'Governance UI and workflow coverage',
    slices: [
      { file: 'validation.ts', startLine: 62, endLine: 121 },
      { file: 'validation.ts', startLine: 3106, endLine: 3200 },
      { file: 'profilingAndReconciliation.ts', startLine: 2711, endLine: 2733 },
    ],
    tests: { unit: 2, e2e: 10, positive: 5, negative: 4, boundary: 2, hostile: 1 },
  },
];

function buildLineStartOffsets(lineLengths) {
  const starts = [0];
  for (let i = 0; i < lineLengths.length; i++) {
    starts.push(starts[i] + lineLengths[i] + 1);
  }
  return starts;
}

function offsetToLineCol(offset, starts) {
  let lo = 0;
  let hi = starts.length - 2;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid] <= offset && offset < starts[mid + 1]) {
      return { line: mid, col: offset - starts[mid] };
    }
    if (offset < starts[mid]) hi = mid - 1;
    else lo = mid + 1;
  }
  const last = Math.max(0, starts.length - 2);
  return { line: last, col: Math.max(0, offset - starts[last]) };
}

function loadEngineV8Coverage() {
  if (!fs.existsSync(V8_DIR)) {
    throw new Error(`V8 coverage directory not found: ${V8_DIR}`);
  }
  const files = fs.readdirSync(V8_DIR).filter((f) => f.endsWith('.json'));
  for (const f of files) {
    const data = JSON.parse(fs.readFileSync(path.join(V8_DIR, f), 'utf8'));
    if (
      Array.isArray(data.result) &&
      data.result.some((r) => r.url && r.url.includes('/src/engine/validation.ts'))
    ) {
      return data;
    }
  }
  throw new Error('No V8 coverage file containing /src/engine/validation.ts found.');
}

function analyzeFileCoverage(v8Data, fileName) {
  const entry = v8Data.result.find(
    (r) => r.url && r.url.endsWith(`/src/engine/${fileName}`)
  );
  if (!entry) {
    throw new Error(`Missing V8 coverage entry for ${fileName}`);
  }
  const smCache = v8Data['source-map-cache']?.[entry.url];
  if (!smCache) {
    throw new Error(`Missing source-map-cache for ${fileName}`);
  }
  const sm = new SourceMap(smCache.data);
  const starts = buildLineStartOffsets(smCache.lineLengths);

  // Build innermost-first range list for byte-level execution lookup
  const allRanges = [];
  for (const fn of entry.functions) {
    for (const r of fn.ranges) {
      allRanges.push({
        start: r.startOffset,
        end: r.endOffset,
        count: r.count,
        len: r.endOffset - r.startOffset,
      });
    }
  }
  allRanges.sort((a, b) => a.len - b.len);

  function getCountAtOffset(offset) {
    for (let i = 0; i < allRanges.length; i++) {
      const r = allRanges[i];
      if (r.start <= offset && offset < r.end) return r.count;
    }
    return 1;
  }

  // Map every executable TypeScript line (1-indexed) to covered boolean
  const lineStatus = new Map();
  const totalBytes = starts[starts.length - 1];
  for (let off = 0; off < totalBytes; off += 2) {
    const lc = offsetToLineCol(off, starts);
    const orig = sm.findEntry(lc.line, lc.col);
    if (typeof orig.originalLine === 'number') {
      const tsLine = orig.originalLine + 1;
      const cnt = getCountAtOffset(off);
      const prev = lineStatus.get(tsLine);
      if (prev === undefined) lineStatus.set(tsLine, cnt > 0);
      else if (cnt > 0) lineStatus.set(tsLine, true);
    }
  }

  // Map every V8 function and branch range to its TypeScript line span (1-indexed)
  const functions = [];
  const branches = [];
  for (const fn of entry.functions) {
    if (fn.functionName === '__name') continue;
    const r0 = fn.ranges[0];
    if (!r0) continue;
    const lcStart = offsetToLineCol(r0.startOffset, starts);
    const lcEnd = offsetToLineCol(Math.max(r0.startOffset, r0.endOffset - 1), starts);
    const origStart = sm.findEntry(lcStart.line, lcStart.col);
    const origEnd = sm.findEntry(lcEnd.line, lcEnd.col);
    if (typeof origStart.originalLine === 'number' && r0.startOffset > 0) {
      const tsStartLine = origStart.originalLine + 1;
      const tsEndLine =
        typeof origEnd.originalLine === 'number'
          ? Math.max(tsStartLine, origEnd.originalLine + 1)
          : tsStartLine;
      functions.push({
        name: fn.functionName || '(anonymous)',
        tsStartLine,
        tsEndLine,
        covered: r0.count > 0,
      });
    }
    for (const r of fn.ranges) {
      const lc = offsetToLineCol(r.startOffset, starts);
      const orig = sm.findEntry(lc.line, lc.col);
      if (typeof orig.originalLine === 'number') {
        branches.push({
          tsLine: orig.originalLine + 1,
          covered: r.count > 0,
        });
      }
    }
  }

  return { lineStatus, functions, branches };
}

function computeCapabilityCoverage() {
  const v8Data = loadEngineV8Coverage();
  const engineFiles = [
    'workbook.ts',
    'security.ts',
    'schema.ts',
    'profilingAndReconciliation.ts',
    'validation.ts',
    'calculations.ts',
    'formulaTests.ts',
  ];

  const fileAnalysis = new Map();
  for (const f of engineFiles) {
    fileAnalysis.set(f, analyzeFileCoverage(v8Data, f));
  }

  const results = [];
  for (const cap of CAPABILITY_COVERAGE_SPECS) {
    let totalLines = 0;
    let coveredLines = 0;
    let totalBranches = 0;
    let coveredBranches = 0;
    const seenFuncKeys = new Set();
    let totalFuncs = 0;
    let coveredFuncs = 0;

    for (const slice of cap.slices) {
      const analysis = fileAnalysis.get(slice.file);
      if (!analysis) continue;

      for (const [tsLine, cov] of analysis.lineStatus.entries()) {
        if (tsLine >= slice.startLine && tsLine <= slice.endLine) {
          totalLines++;
          if (cov) coveredLines++;
        }
      }
      for (const br of analysis.branches) {
        if (br.tsLine >= slice.startLine && br.tsLine <= slice.endLine) {
          totalBranches++;
          if (br.covered) coveredBranches++;
        }
      }
      analysis.functions.forEach((fn, idx) => {
        if (fn.tsStartLine <= slice.endLine && fn.tsEndLine >= slice.startLine) {
          const key = `${slice.file}#${idx}`;
          if (!seenFuncKeys.has(key)) {
            seenFuncKeys.add(key);
            totalFuncs++;
            if (fn.covered) coveredFuncs++;
          }
        }
      });
    }

    const linePct = totalLines > 0 ? Number(((coveredLines / totalLines) * 100).toFixed(2)) : 100;
    const branchPct =
      totalBranches > 0 ? Number(((coveredBranches / totalBranches) * 100).toFixed(2)) : 100;
    const funcPct = totalFuncs > 0 ? Number(((coveredFuncs / totalFuncs) * 100).toFixed(2)) : 100;

    results.push({
      id: cap.id,
      name: cap.name,
      slices: cap.slices.map((s) => `${s.file}:${s.startLine}-${s.endLine}`),
      lines: { covered: coveredLines, total: totalLines, pct: linePct },
      branches: { covered: coveredBranches, total: totalBranches, pct: branchPct },
      functions: { covered: coveredFuncs, total: totalFuncs, pct: funcPct },
      tests: cap.tests,
    });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    methodology:
      'Source-mapped V8 coverage attribution per capability slice (src/engine/*.ts line/branch/function spans)',
    capabilities: results,
  };

  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));

  const mdLines = [
    '# Per-Capability Source-Mapped Engine Coverage Report',
    '',
    '| # | Capability | Source slices (`src/engine/*`) | Measured Line % (`cov/tot`) | Measured Branch % (`cov/tot`) | Measured Func % (`cov/tot`) | Mapped Tests (`Unit + E2E; P/N/B/H`) |',
    '|---:|---|---|---:|---:|---:|---|',
  ];
  for (const r of results) {
    const t = r.tests;
    mdLines.push(
      `| ${r.id} | ${r.name} | \`${r.slices.join('`, `')}\` | **${r.lines.pct.toFixed(2)}%** (${r.lines.covered}/${r.lines.total}) | **${r.branches.pct.toFixed(2)}%** (${r.branches.covered}/${r.branches.total}) | **${r.functions.pct.toFixed(2)}%** (${r.functions.covered}/${r.functions.total}) | ${t.unit} Unit + ${t.e2e} E2E (\`${t.positive}P / ${t.negative}N / ${t.boundary}B / ${t.hostile}H\`) |`
    );
  }
  fs.writeFileSync(OUT_MD, mdLines.join('\n') + '\n');

  console.log('\n=== Per-Capability Source-Mapped Coverage Summary ===');
  for (const r of results) {
    console.log(
      `#${r.id.padEnd(3)} ${r.name.padEnd(58)} | Line: ${r.lines.pct.toFixed(2).padStart(6)}% (${r.lines.covered}/${r.lines.total}) | Branch: ${r.branches.pct.toFixed(2).padStart(6)}% (${r.branches.covered}/${r.branches.total}) | Func: ${r.functions.pct.toFixed(2).padStart(6)}% (${r.functions.covered}/${r.functions.total})`
    );
  }
}

computeCapabilityCoverage();
