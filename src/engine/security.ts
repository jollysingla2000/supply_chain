const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '/': '&#x2F;',
};

export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"'/]/g, (ch) => HTML_ESCAPE_MAP[ch] ?? ch);
}

const UNSAFE_HTML_PATTERN =
  /<\s*script\b|<\s*iframe\b|<\s*object\b|<\s*embed\b|<\s*img\b[^>]*\bon\w+\s*=|\bon(?:error|load|click|mouseover|focus)\s*=|javascript\s*:/i;

export function hasUnsafePayload(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  return UNSAFE_HTML_PATTERN.test(String(value));
}

export function sanitizeCellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value).replace(/\0/g, '');
  return str
    .replace(/<\s*script\b[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/javascript\s*:/gi, '')
    .replace(/\bon\w+\s*=\s*(['"]).*?\1/gi, '')
    .trim();
}
