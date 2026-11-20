import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const auditScript = path.join(repoRoot, 'scripts', 'run-dependency-audit.sh');
const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'phase1-audit-regression-'));
const fakeBin = path.join(tempRoot, 'bin');
mkdirSync(fakeBin, { recursive: true });

try {
  const fakeNpm = path.join(fakeBin, 'npm');
  const fakeNpmSource = [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'if [[ "${1:-}" == "install" ]]; then exit 0; fi',
    'if [[ "${1:-}" == "audit" ]]; then',
    "  cat <<'JSON'",
    '{"auditReportVersion":2,"vulnerabilities":{"fixture-package":{"name":"fixture-package","severity":"high","isDirect":true,"range":"<2.0.0","fixAvailable":false,"via":[{"title":"Synthetic high-severity fixture","range":"<2.0.0","url":"https://example.invalid/advisory"}]}}}',
    'JSON',
    '  exit 1',
    'fi',
    'echo "Unexpected fake npm invocation" >&2',
    'exit 90',
  ].join('\n');
  writeFileSync(fakeNpm, fakeNpmSource);
  chmodSync(fakeNpm, 0o755);

  const result = spawnSync('bash', [auditScript], {
    cwd: tempRoot,
    env: { ...process.env, PATH: fakeBin + path.delimiter + (process.env.PATH || '') },
    encoding: 'utf8',
  });
  assert.equal(result.status, 1, 'expected npm audit exit status 1 to propagate; stderr=' + result.stderr);
  assert.match(result.stdout, /Dependency audit summary: 1 package advisory group/);
  assert.match(result.stdout, /fixture-package: severity=high/);
  const report = JSON.parse(readFileSync(path.join(tempRoot, 'npm-audit.json'), 'utf8'));
  assert.equal(report.vulnerabilities['fixture-package'].severity, 'high');
  console.log('Dependency-audit failure-path regression passed: report retained, diagnostics printed, non-zero status propagated.');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
