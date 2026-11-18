import * as XLSX from 'xlsx';
import { createSeededEnterpriseSheets } from './schema';
import { EnterpriseSheets, SheetRecord } from './types';
import { parseFlexibleDate } from './validation';

function isExcelDateFormat(fmt: string): boolean {
  const cleaned = fmt.replace(/\[[^\]]*\]/g, '').replace(/"[^"]*"/g, '').toLowerCase();
  if (!cleaned || cleaned === 'general' || cleaned.includes('%')) return false;
  return /[ymd]/.test(cleaned) && !/^[#0.,e+\-\s$]+$/.test(cleaned);
}

function formatUtcIso(dt: Date): string {
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function matchCanonicalTableName(
  sheetName: string,
  canonicalNames: string[]
): string | undefined {
  const clean = sheetName.trim().toLowerCase();
  const exact = canonicalNames.find((c) => c.toLowerCase() === clean);
  if (exact) return exact;

  const prefixMatch = /^(\d{2})_/.exec(clean);
  if (prefixMatch) {
    const byPrefix = canonicalNames.find((c) => c.startsWith(`${prefixMatch[1]}_`));
    if (byPrefix) return byPrefix;
  }

  return canonicalNames.find((c) =>
    c.toLowerCase().includes(clean) || clean.includes(c.toLowerCase().slice(0, 12))
  );
}

/**
 * Ingests ALL worksheets from an uploaded .XLSX / .XLS / .CSV workbook.
 * Preserves canonical enterprise schema definitions for matched sheets and integrates
 * every uploaded worksheet (not just the first sheet) into the active schema.
 */
export function ingestWorkbookBuffer(
  buffer: ArrayBuffer | Uint8Array,
  fileName: string
): {
  sheets: EnterpriseSheets;
  totalRows: number;
  sheetCount: number;
  activeSheet: string;
} {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const wb = XLSX.read(bytes, { type: 'array', cellNF: true, cellDates: false });
  const canonicalTemplate = createSeededEnterpriseSheets();
  const canonicalNames = Object.keys(canonicalTemplate);

  const nextSheets: EnterpriseSheets = {};
  let totalRows = 0;
  let ingestedSheetCount = 0;

  // First, ingest every worksheet from the uploaded workbook
  for (const rawSheetName of wb.SheetNames) {
    const ws = wb.Sheets[rawSheetName];
    if (!ws) continue;

    // Normalize Excel date-formatted cells to YYYY-MM-DD before converting to JSON
    for (const addr of Object.keys(ws)) {
      if (addr.startsWith('!')) continue;
      const cell = ws[addr] as XLSX.CellObject | undefined;
      if (!cell) continue;
      if (cell.t === 'd' && cell.v instanceof Date) {
        cell.t = 's';
        cell.v = formatUtcIso(cell.v);
        cell.z = 'General';
        delete cell.w;
      } else if (
        cell.t === 'n' &&
        typeof cell.v === 'number' &&
        cell.z &&
        isExcelDateFormat(String(cell.z))
      ) {
        const dt = parseFlexibleDate(cell.v);
        if (dt) {
          cell.t = 's';
          cell.v = formatUtcIso(dt);
          cell.z = 'General';
          delete cell.w;
        }
      }
    }

    const rows = XLSX.utils.sheet_to_json<SheetRecord>(ws, { defval: '' });
    // Even if a sheet only has headers (0 rows) or populated rows, integrate it into schema!
    const headerMatrix = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 });
    const firstRowHeaders = Array.isArray(headerMatrix[0])
      ? headerMatrix[0].map((h) => String(h ?? '').trim()).filter(Boolean)
      : [];

    if (rows.length === 0 && firstRowHeaders.length === 0) {
      continue;
    }

    totalRows += rows.length;
    ingestedSheetCount++;

    const matchedCanonical = matchCanonicalTableName(rawSheetName, canonicalNames);
    const targetName = matchedCanonical || rawSheetName;
    const canonicalMeta = matchedCanonical ? canonicalTemplate[matchedCanonical] : undefined;

    const headers =
      rows.length > 0 ? Object.keys(rows[0]) : firstRowHeaders;

    const dateColSet = new Set<string>();
    for (const h of headers) {
      const canonicalCol = canonicalMeta?.cols.find(
        (c) => c.col.toLowerCase() === h.toLowerCase()
      );
      if (
        canonicalCol?.dataType === 'DATE' ||
        canonicalCol?.type === 'DATE' ||
        /date|month|period/i.test(h)
      ) {
        dateColSet.add(h);
      }
    }

    const normalizedRows = rows.map((r) => {
      const copy: SheetRecord = { ...r };
      for (const col of dateColSet) {
        const rawVal = copy[col];
        if (rawVal !== undefined && rawVal !== null && String(rawVal).trim() !== '') {
          const parsed = parseFlexibleDate(rawVal);
          if (parsed) {
            copy[col] = formatUtcIso(parsed);
          }
        }
      }
      return copy;
    });

    nextSheets[targetName] = {
      pillar: canonicalMeta ? canonicalMeta.pillar : 'Uploaded Workbook',
      desc: canonicalMeta
        ? `${canonicalMeta.desc} (Ingested ${normalizedRows.length} rows from ${fileName} [${rawSheetName}])`
        : `Ingested ${normalizedRows.length} actual records from ${fileName} [${rawSheetName}]`,
      cols: headers.map((h, i) => {
        const canonicalCol = canonicalMeta?.cols.find(
          (c) => c.col.toLowerCase() === h.toLowerCase()
        );
        return (
          canonicalCol || {
            col: h,
            type: 'AUTO',
            key: i < 3 ? 'PK / FK' : 'Measure',
          }
        );
      }),
      records: normalizedRows,
    };
  }

  if (ingestedSheetCount === 0) {
    throw new Error('No populated worksheets found in uploaded workbook.');
  }

  // Ensure canonical tables not present in a partial upload remain represented if desired,
  // or keep all uploaded worksheets + canonical master tables if workbook had multiple sheets.
  // Actually: keeping every uploaded sheet cleanly in nextSheets ensures uploaded sheets are 100% represented.
  const firstSheet = Object.keys(nextSheets)[0];

  return {
    sheets: nextSheets,
    totalRows,
    sheetCount: ingestedSheetCount,
    activeSheet: firstSheet,
  };
}

export function buildWorkbookBinary(sheets: EnterpriseSheets): Uint8Array {
  const wb = XLSX.utils.book_new();
  for (const name of Object.keys(sheets)) {
    const recs = (sheets[name].records || []).filter((r) => !r._removed);
    const cleanRows =
      recs.length > 0
        ? recs.map((r) => {
            const copy: SheetRecord = {};
            for (const k of Object.keys(r)) {
              if (!k.startsWith('_')) copy[k] = r[k];
            }
            return copy;
          })
        : [
            Object.fromEntries(
              sheets[name].cols.map((c) => [c.col, ''])
            ),
          ];
    const ws = XLSX.utils.json_to_sheet(cleanRows);
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  }
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return new Uint8Array(out);
}
