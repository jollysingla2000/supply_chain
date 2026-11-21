import fs from 'node:fs';
import path from 'node:path';
import { SourceMap } from 'node:module';

const V8_DIR = path.resolve('coverage/v8');
const OUT_JSON = path.resolve('coverage/capability-coverage-report.json');
const OUT_MD = path.resolve('coverage/capability-coverage-summary.md');
const UNIT_TEST_FILE = path.resolve('src/engine/engine.test.ts');
const E2E_TEST_FILE = path.resolve('e2e/data-assurance-upload.spec.ts');
const TEST_MAP = JSON.parse(fs.readFileSync(path.resolve('scripts/capability-test-map.json'), 'utf8'));

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
      { file: 'workbook.ts', startLine: 1, endLine: 265 },
      { file: 'security.ts', startLine: 1, endLine: 33 },
    ],
  },
  {
    id: '2',
    name: 'Multi-sheet detection and ingestion',
    slices: [{ file: 'workbook.ts', startLine: 160, endLine: 403 }],
  },
  {
    id: '3',
    name: 'Source identity and fingerprint',
    slices: [{ file: 'profilingAndReconciliation.ts', startLine: 93, endLine: 238 }],
  },
  {
    id: '4',
    name: 'Source workbook persistence and recovery',
    slices: [{ file: 'profilingAndReconciliation.ts', startLine: 2774, endLine: 3264 }],
  },
  {
    id: '5',
    name: 'Dataset versioning and upload lineage',
    slices: [{ file: 'profilingAndReconciliation.ts', startLine: 2375, endLine: 2773 }],
  },
  {
    id: '6',
    name: 'Column-level profiling',
    slices: [
      { file: 'profilingAndReconciliation.ts', startLine: 81, endLine: 92 },
      { file: 'profilingAndReconciliation.ts', startLine: 283, endLine: 654 },
    ],
  },
  {
    id: '7',
    name: 'Actual data-type inference',
    slices: [
      { file: 'profilingAndReconciliation.ts', startLine: 239, endLine: 282 },
      { file: 'profilingAndReconciliation.ts', startLine: 340, endLine: 445 },
      { file: 'validation.ts', startLine: 328, endLine: 377 },
    ],
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
  },
  {
    id: '9',
    name: 'Schema and mandatory-column validation',
    slices: [
      { file: 'schema.ts', startLine: 38, endLine: 799 },
      { file: 'validation.ts', startLine: 287, endLine: 327 },
      { file: 'validation.ts', startLine: 675, endLine: 1100 },
    ],
  },
  {
    id: '10',
    name: 'Schema drift detection',
    slices: [
      { file: 'profilingAndReconciliation.ts', startLine: 53, endLine: 80 },
      { file: 'profilingAndReconciliation.ts', startLine: 1779, endLine: 1935 },
    ],
  },
  {
    id: '11',
    name: 'Column mapping and collision prevention',
    slices: [
      { file: 'profilingAndReconciliation.ts', startLine: 1936, endLine: 2066 },
      { file: 'validation.ts', startLine: 29, endLine: 61 },
    ],
  },
  {
    id: '12',
    name: 'Missing-table/column remediation',
    slices: [
      { file: 'profilingAndReconciliation.ts', startLine: 2067, endLine: 2146 },
      { file: 'validation.ts', startLine: 378, endLine: 455 },
      { file: 'validation.ts', startLine: 3060, endLine: 3105 },
    ],
  },
  {
    id: '13',
    name: 'Data type, format and value validation',
    slices: [
      { file: 'validation.ts', startLine: 122, endLine: 152 },
      { file: 'validation.ts', startLine: 1185, endLine: 1315 },
      { file: 'security.ts', startLine: 1, endLine: 33 },
    ],
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
  },
  {
    id: '15',
    name: 'Date, period and time-series integrity',
    slices: [
      { file: 'validation.ts', startLine: 153, endLine: 286 },
      { file: 'validation.ts', startLine: 1225, endLine: 1305 },
      { file: 'validation.ts', startLine: 2393, endLine: 2544 },
    ],
  },
  {
    id: '16',
    name: 'Master-data and referential integrity',
    slices: [
      { file: 'validation.ts', startLine: 1102, endLine: 1134 },
      { file: 'validation.ts', startLine: 1337, endLine: 1455 },
      { file: 'profilingAndReconciliation.ts', startLine: 1410, endLine: 1592 },
    ],
  },
  {
    id: '17',
    name: 'Cross-table reconciliation',
    slices: [
      { file: 'profilingAndReconciliation.ts', startLine: 655, endLine: 1778 },
      { file: 'formulaTests.ts', startLine: 16, endLine: 271 },
    ],
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
  },
  {
    id: '22',
    name: 'S&OP Data Assurance',
    slices: [
      { file: 'schema.ts', startLine: 129, endLine: 172 },
      { file: 'validation.ts', startLine: 675, endLine: 1100 },
      { file: 'validation.ts', startLine: 1456, endLine: 1720 },
      { file: 'profilingAndReconciliation.ts', startLine: 805, endLine: 1408 },
    ],
  },
  {
    id: '23',
    name: 'MEIO Data Assurance',
    slices: [
      { file: 'schema.ts', startLine: 173, endLine: 212 },
      { file: 'validation.ts', startLine: 2076, endLine: 2149 },
      { file: 'calculations.ts', startLine: 392, endLine: 421 },
    ],
  },
  {
    id: '24',
    name: 'Procurement Data Assurance',
    slices: [
      { file: 'schema.ts', startLine: 213, endLine: 252 },
      { file: 'validation.ts', startLine: 1721, endLine: 1965 },
    ],
  },
  {
    id: '25',
    name: 'Manufacturing Data Assurance',
    slices: [
      { file: 'schema.ts', startLine: 253, endLine: 294 },
      { file: 'validation.ts', startLine: 1966, endLine: 2075 },
      { file: 'validation.ts', startLine: 2150, endLine: 2269 },
    ],
  },
  {
    id: '26A',
    name: 'Certification engine: release gate, evidence matrix and audit linkage',
    slices: [
      { file: 'validation.ts', startLine: 62, endLine: 121 },
      { file: 'validation.ts', startLine: 675, endLine: 1100 },
      { file: 'validation.ts', startLine: 2545, endLine: 3348 },
      { file: 'profilingAndReconciliation.ts', startLine: 2147, endLine: 2773 },
    ],
  },
  {
    id: '26B',
    name: 'Governance UI and workflow coverage',
    slices: [
      { file: 'validation.ts', startLine: 62, endLine: 121 },
      { file: 'validation.ts', startLine: 3106, endLine: 3200 },
      { file: 'profilingAndReconciliation.ts', startLine: 2751, endLine: 2773 },
    ],
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

function extractTestNames(source) {
  const names = new Set();
  const pattern = /\btest(?:\.skip|\.only)?\s*\(\s*(['"])([\s\S]*?)\1/g;
  for (const match of source.matchAll(pattern)) names.add(match[2].replace(/\s+/g, ' ').trim());
  return names;
}

function computeCapabilityCoverage() {
  const v8Data = loadEngineV8Coverage();
  const unitTestNames = extractTestNames(fs.readFileSync(UNIT_TEST_FILE, 'utf8'));
  const e2eTestNames = extractTestNames(fs.readFileSync(E2E_TEST_FILE, 'utf8'));
  const engineFiles = [
    'workbook.ts',
    'security.ts',
    'schema.ts',
    'profilingAndReconciliation.ts',
    'validation.ts',
    'calculations.ts',
    'formulaTests.ts',
  ];

  const sourceLineCounts = new Map(engineFiles.map((file) => [file, fs.readFileSync(path.resolve('src/engine', file), 'utf8').split(/\r?\n/).length]));
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
      const sourceLineCount = sourceLineCounts.get(slice.file);
      if (!sourceLineCount || slice.startLine < 1 || slice.endLine < slice.startLine || slice.endLine > sourceLineCount) {
        throw new Error(`Invalid source slice for capability #${cap.id}: ${slice.file}:${slice.startLine}-${slice.endLine} (file has ${sourceLineCount ?? 0} lines).`);
      }
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

    const testCounts = { unit: 0, e2e: 0, positive: 0, negative: 0, boundary: 0, hostile: 0 };
    const mappedCases = TEST_MAP[cap.id] ?? [];
    const seenCases = new Set();
    for (const item of mappedCases) {
      const key = `${item.suite}:${item.name}`;
      if (seenCases.has(key)) throw new Error(`Duplicate mapped test for capability #${cap.id}: ${key}`);
      seenCases.add(key);
      const known = item.suite === 'unit' ? unitTestNames : item.suite === 'e2e' ? e2eTestNames : null;
      if (!known || !known.has(item.name)) throw new Error(`Unknown mapped test for capability #${cap.id}: ${key}`);
      if (!['positive', 'negative', 'boundary', 'hostile'].includes(item.category)) throw new Error(`Invalid mapped test category for capability #${cap.id}: ${item.category}`);
      testCounts[item.suite]++;
      testCounts[item.category]++;
    }
    if (mappedCases.length === 0) throw new Error(`No named test mappings for capability #${cap.id}`);

    results.push({
      id: cap.id,
      name: cap.name,
      slices: cap.slices.map((s) => `${s.file}:${s.startLine}-${s.endLine}`),
      lines: { covered: coveredLines, total: totalLines, pct: linePct },
      v8RangeProxy: { covered: coveredBranches, total: totalBranches, pct: branchPct },
      functions: { covered: coveredFuncs, total: totalFuncs, pct: funcPct },
      tests: testCounts,
      testCases: mappedCases,
    });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    methodology:
      'Source-mapped V8 source-slice line/function execution. The range-derived metric below is a V8 execution-range proxy, not conventional branch coverage. Exact named tests are validated against unit/E2E sources; coverage is not isolated by test.',
    capabilities: results,
  };

  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));

  const mdLines = [
    '# Per-Capability Source-Mapped Engine Coverage Report',
    '',
    '| # | Capability | Source slices (`src/engine/*`) | Measured Line % (`cov/tot`) | V8 Range Proxy % (`cov/tot`) | Measured Func % (`cov/tot`) | Named Tests (`Unit + E2E; P/N/B/H`) |',
    '|---:|---|---|---:|---:|---:|---|',
  ];
  for (const r of results) {
    const t = r.tests;
    mdLines.push(
      `| ${r.id} | ${r.name} | \`${r.slices.join('`, `')}\` | **${r.lines.pct.toFixed(2)}%** (${r.lines.covered}/${r.lines.total}) | **${r.v8RangeProxy.pct.toFixed(2)}%** (${r.v8RangeProxy.covered}/${r.v8RangeProxy.total}) | **${r.functions.pct.toFixed(2)}%** (${r.functions.covered}/${r.functions.total}) | ${t.unit} Unit + ${t.e2e} E2E (\`${t.positive}P / ${t.negative}N / ${t.boundary}B / ${t.hostile}H\`) |`
    );
  }
  fs.writeFileSync(OUT_MD, mdLines.join('\n') + '\n');

  console.log('\n=== Per-Capability Source-Slice Coverage Summary ===');
  for (const r of results) {
    console.log(
      `#${r.id.padEnd(3)} ${r.name.padEnd(58)} | Line: ${r.lines.pct.toFixed(2).padStart(6)}% (${r.lines.covered}/${r.lines.total}) | V8 range proxy: ${r.v8RangeProxy.pct.toFixed(2).padStart(6)}% (${r.v8RangeProxy.covered}/${r.v8RangeProxy.total}) | Func: ${r.functions.pct.toFixed(2).padStart(6)}% (${r.functions.covered}/${r.functions.total})`
    );
  }
}

computeCapabilityCoverage();
