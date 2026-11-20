import * as XLSX from 'xlsx';
import { createSeededEnterpriseSheets } from './schema';
import { EnterpriseSheets, SheetRecord } from './types';
import { parseFlexibleDate } from './validation';

const MAX_WORKBOOK_BYTES = 100 * 1024 * 1024;
const MAX_UNCOMPRESSED_ARCHIVE_BYTES = 200 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 2_000;
const MAX_WORKSHEETS = 100;
const MAX_TOTAL_ROWS = 500_000;
const MAX_COLUMNS_PER_SHEET = 1_000;
const MAX_TOTAL_CELLS = 5_000_000;

function readUint16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
}

/**
 * Pre-validates ZIP/XLSX container headers, Central Directory bounds, and cumulative
 * uncompressed size before handing bytes to SheetJS (XLSX.read), preventing CPU/memory
 * hangs or ZIP-bomb expansion on truncated or hostile archives.
 */
function validateArchiveContainerSafety(bytes: Uint8Array, fileName: string): void {
  const lowerName = fileName.trim().toLowerCase();
  const isZipMagic =
    bytes.byteLength >= 4 &&
    bytes[0] === 0x50 && bytes[1] === 0x4b &&
    (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07);
  const isCfbMagic =
    bytes.byteLength >= 8 &&
    bytes[0] === 0xd0 && bytes[1] === 0xcf &&
    bytes[2] === 0x11 && bytes[3] === 0xe0;

  if (lowerName.endsWith('.xlsx') && !isZipMagic) {
    throw new Error('Corrupted or invalid .xlsx workbook: missing ZIP container header.');
  }
  if (!isZipMagic && !isCfbMagic) return;

  if (isZipMagic) {
    if (bytes.byteLength < 22 || bytes[2] !== 0x03 || bytes[3] !== 0x04) {
      throw new Error('Corrupted ZIP/XLSX archive: truncated local file header.');
    }
    const minEocdOffset = Math.max(0, bytes.byteLength - 65_557);
    let eocdOffset = -1;
    for (let i = bytes.byteLength - 22; i >= minEocdOffset; i--) {
      if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) {
        const commentLen = readUint16LE(bytes, i + 20);
        if (i + 22 + commentLen === bytes.byteLength) {
          eocdOffset = i;
          break;
        }
      }
    }
    if (eocdOffset < 0) {
      throw new Error('Corrupted ZIP/XLSX archive: missing, truncated, or non-terminal End of Central Directory record.');
    }

    const diskNumber = readUint16LE(bytes, eocdOffset + 4);
    const centralDirectoryDisk = readUint16LE(bytes, eocdOffset + 6);
    const entriesOnDisk = readUint16LE(bytes, eocdOffset + 8);
    const totalEntries = readUint16LE(bytes, eocdOffset + 10);
    const cdSize = readUint32LE(bytes, eocdOffset + 12);
    const cdOffset = readUint32LE(bytes, eocdOffset + 16);

    if (diskNumber !== 0 || centralDirectoryDisk !== 0 || entriesOnDisk !== totalEntries) {
      throw new Error('Unsupported multi-disk ZIP/XLSX archive.');
    }
    if (totalEntries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
      throw new Error('Hostile or unsupported ZIP64 archive: ZIP64 directory metadata is not supported.');
    }
    if (totalEntries === 0 || totalEntries > MAX_ARCHIVE_ENTRIES) {
      throw new Error(`Hostile or malformed ZIP/XLSX archive: entry count (${totalEntries}) is outside allowed bounds (1..${MAX_ARCHIVE_ENTRIES}).`);
    }

    const cdEnd = cdOffset + cdSize;
    if (!Number.isSafeInteger(cdEnd) || cdOffset < 4 || cdEnd !== eocdOffset || cdEnd > bytes.byteLength) {
      throw new Error('Corrupted ZIP/XLSX archive: Central Directory bounds do not exactly match the EOCD boundary.');
    }

    let ptr = cdOffset;
    let totalUncompressedBytes = 0;
    const localEntryRanges: Array<{ start: number; end: number }> = [];
    for (let entryIdx = 0; entryIdx < totalEntries; entryIdx++) {
      if (
        ptr + 46 > cdEnd ||
        bytes[ptr] !== 0x50 || bytes[ptr + 1] !== 0x4b ||
        bytes[ptr + 2] !== 0x01 || bytes[ptr + 3] !== 0x02
      ) {
        throw new Error('Corrupted ZIP/XLSX archive: invalid or truncated Central Directory entry header.');
      }

      const flags = readUint16LE(bytes, ptr + 8);
      const compressionMethod = readUint16LE(bytes, ptr + 10);
      const compressedSize = readUint32LE(bytes, ptr + 20);
      const uncompressedSize = readUint32LE(bytes, ptr + 24);
      const fileNameLen = readUint16LE(bytes, ptr + 28);
      const extraLen = readUint16LE(bytes, ptr + 30);
      const commentLen = readUint16LE(bytes, ptr + 32);
      const entryDisk = readUint16LE(bytes, ptr + 34);
      const localHeaderOffset = readUint32LE(bytes, ptr + 42);
      const entryEnd = ptr + 46 + fileNameLen + extraLen + commentLen;

      if (entryDisk !== 0) throw new Error('Unsupported multi-disk ZIP/XLSX archive entry.');
      if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localHeaderOffset === 0xffffffff) {
        throw new Error('Hostile or unsupported ZIP64 archive: ZIP64 entry metadata is not supported.');
      }
      if (fileNameLen === 0 || entryEnd > cdEnd || entryEnd < ptr) {
        throw new Error('Corrupted ZIP/XLSX archive: Central Directory filename, extra field, or comment exceeds directory bounds.');
      }

      const localFixedEnd = localHeaderOffset + 30;
      if (
        !Number.isSafeInteger(localFixedEnd) || localHeaderOffset < 0 || localFixedEnd > cdOffset ||
        bytes[localHeaderOffset] !== 0x50 || bytes[localHeaderOffset + 1] !== 0x4b ||
        bytes[localHeaderOffset + 2] !== 0x03 || bytes[localHeaderOffset + 3] !== 0x04
      ) {
        throw new Error('Corrupted ZIP/XLSX archive: invalid or out-of-bounds local file header.');
      }

      const localFlags = readUint16LE(bytes, localHeaderOffset + 6);
      const localMethod = readUint16LE(bytes, localHeaderOffset + 8);
      const localNameLen = readUint16LE(bytes, localHeaderOffset + 26);
      const localExtraLen = readUint16LE(bytes, localHeaderOffset + 28);
      const localNameStart = localHeaderOffset + 30;
      const localDataStart = localNameStart + localNameLen + localExtraLen;
      const localDataEnd = localDataStart + compressedSize;

      if (
        localNameLen !== fileNameLen || localDataStart > cdOffset || localDataEnd > cdOffset ||
        localDataEnd < localDataStart || localDataEnd > bytes.byteLength ||
        localMethod !== compressionMethod || (localFlags & 0x0809) !== (flags & 0x0809)
      ) {
        throw new Error('Corrupted ZIP/XLSX archive: local header does not match Central Directory metadata.');
      }
      for (let nameIdx = 0; nameIdx < fileNameLen; nameIdx++) {
        if (bytes[localNameStart + nameIdx] !== bytes[ptr + 46 + nameIdx]) {
          throw new Error('Corrupted ZIP/XLSX archive: local and Central Directory filenames do not match.');
        }
      }

      localEntryRanges.push({ start: localHeaderOffset, end: localDataEnd });
      totalUncompressedBytes += uncompressedSize;
      if (!Number.isSafeInteger(totalUncompressedBytes) || totalUncompressedBytes > MAX_UNCOMPRESSED_ARCHIVE_BYTES) {
        throw new Error(`Hostile archive expansion (ZIP bomb) rejected: cumulative uncompressed payload exceeds ${Math.round(MAX_UNCOMPRESSED_ARCHIVE_BYTES / (1024 * 1024))} MB.`);
      }
      ptr = entryEnd;
    }

    if (ptr !== cdEnd) {
      throw new Error('Corrupted ZIP/XLSX archive: Central Directory entry count and declared size do not agree.');
    }
    localEntryRanges.sort((a, b) => a.start - b.start);
    for (let i = 1; i < localEntryRanges.length; i++) {
      if (localEntryRanges[i].start < localEntryRanges[i - 1].end) {
        throw new Error('Corrupted ZIP/XLSX archive: overlapping local file entries are not allowed.');
      }
    }
  }
}

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

function parseWorkbookDate(raw: unknown, uses1904DateSystem: boolean): Date | null {
  if (uses1904DateSystem) {
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      return parseFlexibleDate(raw + 1462);
    }
    if (typeof raw === 'string' && /^\d{5,6}(?:\.\d+)?$/.test(raw.trim())) {
      return parseFlexibleDate(Number(raw.trim()) + 1462);
    }
  }
  return parseFlexibleDate(raw);
}

function matchCanonicalTableName(
  sheetName: string,
  canonicalNames: string[]
): string | undefined {
  const clean = sheetName.trim().toLowerCase();
  const exact = canonicalNames.find((name) => name.toLowerCase() === clean);
  if (exact) return exact;

  // Only accept an unambiguous canonical name followed by a clear suffix.
  // Never map an arbitrary "01_*" worksheet or a fuzzy partial name to a canonical table.
  return canonicalNames.find((name) => {
    const canonical = name.toLowerCase();
    return ['_', ' ', '-', '(', '['].some((separator) =>
      clean.startsWith(canonical + separator)
    );
  });
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
  if (bytes.byteLength === 0) throw new Error('The selected workbook is empty.');
  if (bytes.byteLength > MAX_WORKBOOK_BYTES) {
    throw new Error('The workbook exceeds the 100 MB ingestion limit.');
  }
  validateArchiveContainerSafety(bytes, fileName);
  const wb = XLSX.read(bytes, { type: 'array', cellNF: true, cellDates: false });
  if (wb.SheetNames.length > MAX_WORKSHEETS) {
    throw new Error(`The workbook has ${wb.SheetNames.length} worksheets; the ingestion limit is ${MAX_WORKSHEETS}.`);
  }
  let totalEstimatedRows = 0;
  let totalEstimatedCells = 0;
  for (const sheetName of wb.SheetNames) {
    const worksheet = wb.Sheets[sheetName];
    const ref = worksheet?.['!ref'];
    if (!ref) continue;
    const range = XLSX.utils.decode_range(ref);
    const rowsInSheet = range.e.r - range.s.r + 1;
    const columnsInSheet = range.e.c - range.s.c + 1;
    if (columnsInSheet > MAX_COLUMNS_PER_SHEET) {
      throw new Error(`Worksheet "${sheetName}" exceeds the ${MAX_COLUMNS_PER_SHEET}-column ingestion limit.`);
    }
    totalEstimatedRows += rowsInSheet;
    totalEstimatedCells += rowsInSheet * columnsInSheet;
    if (totalEstimatedRows > MAX_TOTAL_ROWS) {
      throw new Error(`The workbook exceeds the ${MAX_TOTAL_ROWS.toLocaleString()}-row ingestion limit.`);
    }
    if (totalEstimatedCells > MAX_TOTAL_CELLS) {
      throw new Error(`The workbook exceeds the ${MAX_TOTAL_CELLS.toLocaleString()}-cell ingestion limit.`);
    }
  }
  const uses1904DateSystem = Boolean(
    (wb as unknown as { Workbook?: { WBProps?: { date1904?: boolean } } }).Workbook?.WBProps?.date1904
  );
  const canonicalTemplate = createSeededEnterpriseSheets();
  const canonicalNames = Object.keys(canonicalTemplate);

  const nextSheets = Object.create(null) as EnterpriseSheets;
  let totalRows = 0;
  let ingestedSheetCount = 0;

  // First, ingest every worksheet from the uploaded workbook
  for (const rawSheetName of wb.SheetNames) {
    const ws = wb.Sheets[rawSheetName];
    if (!ws) continue;

    // Reject formulas rather than trusting potentially stale cached results without a calculation engine.
    const formulaCells = Object.keys(ws).filter((addr) => {
      if (addr.startsWith('!')) return false;
      const cell = ws[addr] as XLSX.CellObject | undefined;
      return Boolean(cell?.f);
    });
    if (formulaCells.length > 0) {
      throw new Error(
        `Worksheet "${rawSheetName}" contains ${formulaCells.length} formula cell(s). Convert formulas to verified values before upload so Data Assurance does not rely on stale cached calculations.`
      );
    }

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
        const dt = parseWorkbookDate(cell.v, uses1904DateSystem);
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
    const rawHeaderCells = Array.isArray(headerMatrix[0])
      ? headerMatrix[0].map((h) => String(h ?? '').trim())
      : [];
    while (rawHeaderCells.length > 0 && rawHeaderCells[rawHeaderCells.length - 1] === '') {
      rawHeaderCells.pop();
    }
    if (rawHeaderCells.some((header) => header === '')) {
      throw new Error(`Worksheet "${rawSheetName}" has a blank header cell within the header row. Name every column before uploading.`);
    }
    const normalizedHeaders = rawHeaderCells.map((header) => header.toLowerCase().replace(/[^a-z0-9]/g, ''));
    if (new Set(normalizedHeaders).size !== normalizedHeaders.length) {
      throw new Error(`Worksheet "${rawSheetName}" contains duplicate column headers after trimming/case normalization. Rename duplicate columns before uploading.`);
    }
    const firstRowHeaders = rawHeaderCells;

    if (rows.length === 0 && firstRowHeaders.length === 0) {
      continue;
    }

    totalRows += rows.length;
    ingestedSheetCount++;

    const matchedCanonical = matchCanonicalTableName(rawSheetName, canonicalNames);
    const targetName = matchedCanonical || rawSheetName;
    if (Object.prototype.hasOwnProperty.call(nextSheets, targetName)) {
      throw new Error(`Multiple worksheets (${rawSheetName}) map to the same target table "${targetName}". Rename or remove the duplicate worksheet before upload.`);
    }
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
          const parsed = parseWorkbookDate(rawVal, uses1904DateSystem);
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
    const exportName = name.slice(0, 31);
    if (wb.SheetNames.includes(exportName)) {
      throw new Error(`Worksheet export name collision after Excel's 31-character limit: "${exportName}". Rename the source tables before export.`);
    }
    XLSX.utils.book_append_sheet(wb, ws, exportName);
  }
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return new Uint8Array(out);
}
