import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const IGNORED = new Set(['.git', 'node_modules', 'build', 'dist', 'coverage', 'test-results', 'playwright-report']);

function collectMarkdown(directory, result = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!IGNORED.has(entry.name)) collectMarkdown(path.join(directory, entry.name), result);
    } else if (entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.mdx'))) {
      result.push(path.join(directory, entry.name));
    }
  }
  return result;
}

function extractDestinations(source) {
  const destinations = [];
  let cursor = 0;
  while ((cursor = source.indexOf('](', cursor)) !== -1) {
    const start = cursor + 2;
    const end = source.indexOf(')', start);
    if (end === -1) break;
    let raw = source.slice(start, end).trim();
    if (raw.startsWith('<') && raw.includes('>')) {
      raw = raw.slice(1, raw.indexOf('>'));
    } else {
      const titleStart = [...raw].findIndex((ch) => ch === ' ' || ch === '\\t' || ch === '\\n');
      if (titleStart >= 0) raw = raw.slice(0, titleStart);
    }
    if (raw) destinations.push(raw);
    cursor = end + 1;
  }
  return destinations;
}

function isExternal(destination) {
  const lower = destination.toLowerCase();
  return lower.startsWith('https://') ||
    lower.startsWith('http://') ||
    lower.startsWith('mailto:') ||
    lower.startsWith('tel:') ||
    lower.startsWith('data:') ||
    destination.startsWith('#');
}

const failures = [];
const markdownFiles = collectMarkdown(ROOT);
for (const markdownFile of markdownFiles) {
  const source = fs.readFileSync(markdownFile, 'utf8');
  for (const destination of extractDestinations(source)) {
    if (isExternal(destination)) continue;
    const withoutFragment = destination.split('#', 1)[0].split('?', 1)[0];
    if (!withoutFragment) continue;
    let decoded;
    try {
      decoded = decodeURIComponent(withoutFragment);
    } catch {
      failures.push(path.relative(ROOT, markdownFile) + ': malformed URL encoding in ' + destination);
      continue;
    }

    const resolved = path.resolve(path.dirname(markdownFile), decoded);
    const relativeToRoot = path.relative(ROOT, resolved);
    if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
      failures.push(path.relative(ROOT, markdownFile) + ': link escapes repository root: ' + destination);
      continue;
    }
    if (!fs.existsSync(resolved)) {
      failures.push(path.relative(ROOT, markdownFile) + ': missing local target: ' + destination);
    }
  }
}

if (failures.length) {
  console.error('Local Markdown link validation failed:');
  for (const failure of failures) console.error(' - ' + failure);
  process.exitCode = 1;
} else {
  console.log('Validated ' + markdownFiles.length + ' Markdown files; all local file links resolve.');
}
