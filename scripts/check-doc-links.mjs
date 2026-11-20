import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const IGNORED = new Set(['.git', 'node_modules', 'build', 'dist', 'coverage', 'test-results', 'playwright-report']);

function collectMarkdown(directory, result = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!IGNORED.has(entry.name)) collectMarkdown(path.join(directory, entry.name), result);
    } else if (entry.isFile() && /\\.mdx?$/.test(entry.name)) {
      result.push(path.join(directory, entry.name));
    }
  }
  return result;
}

function parseDestination(raw) {
  const trimmed = raw.trim();
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) return trimmed.slice(1, -1);
  return trimmed;
}

const failures = [];
const markdownFiles = collectMarkdown(ROOT);
for (const markdownFile of markdownFiles) {
  const source = fs.readFileSync(markdownFile, 'utf8');
  const pattern = /!?\\[[^\\]]*\\]\\((<[^>]+>|[^)\\s]+)(?:\\s+["'][^)]*["'])?\\)/g;
  for (const match of source.matchAll(pattern)) {
    const destination = parseDestination(match[1]);
    if (!destination || /^(?:https?:|mailto:|tel:|data:|#)/i.test(destination)) continue;

    const withoutFragment = destination.split('#', 1)[0].split('?', 1)[0];
    if (!withoutFragment) continue;
    let decoded;
    try {
      decoded = decodeURIComponent(withoutFragment);
    } catch {
      failures.push(`${path.relative(ROOT, markdownFile)}: malformed URL encoding in ${destination}`);
      continue;
    }

    const resolved = path.resolve(path.dirname(markdownFile), decoded);
    const relativeToRoot = path.relative(ROOT, resolved);
    if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
      failures.push(`${path.relative(ROOT, markdownFile)}: link escapes repository root: ${destination}`);
      continue;
    }
    if (!fs.existsSync(resolved)) {
      failures.push(`${path.relative(ROOT, markdownFile)}: missing local target: ${destination}`);
    }
  }
}

if (failures.length) {
  console.error('Local Markdown link validation failed:');
  for (const failure of failures) console.error(' - ' + failure);
  process.exitCode = 1;
} else {
  console.log(`Validated ${markdownFiles.length} Markdown files; all local file links resolve.`);
}
