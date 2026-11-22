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

      if ((flags & 0x0001) !== 0) {
        throw new Error('Unsupported encrypted ZIP/XLSX archive entry.');
      }
      if (compressionMethod !== 0 && compressionMethod !== 8) {
        throw new Error(`Unsupported ZIP/XLSX compression method (${compressionMethod}); only STORE and DEFLATE are allowed.`);
      }
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

    // Read only the header row directly from worksheet cells. Calling sheet_to_json
    // with header: 1 here would materialize a second full-workbook matrix at large scale.
    const worksheetRange = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']) : null;
    const rawHeaderCells: string[] = [];
    if (worksheetRange) {
      for (let col = worksheetRange.s.c; col <= worksheetRange.e.c; col++) {
        const address = XLSX.utils.encode_cell({ r: worksheetRange.s.r, c: col });
        const headerCell = ws[address] as XLSX.CellObject | undefined;
        rawHeaderCells.push(String(headerCell?.v ?? '').trim());
      }
    }
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
    if (!worksheetRange || firstRowHeaders.length === 0) {
      continue;
    }

    // Reject formulas and normalize Excel date-formatted cells in one pass. A for..in
    // traversal avoids allocating a potentially multi-million-entry Object.keys array.
    let formulaCellCount = 0;
    for (const address in ws) {
      if (!Object.prototype.hasOwnProperty.call(ws, address) || address.startsWith('!')) continue;
      const cell = ws[address] as XLSX.CellObject | undefined;
      if (!cell) continue;
      if (cell.f) {
        formulaCellCount++;
        continue;
      }
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
    if (formulaCellCount > 0) {
      throw new Error(
        `Worksheet "${rawSheetName}" contains ${formulaCellCount} formula cell(s). Convert formulas to verified values before upload so Data Assurance does not rely on stale cached calculations.`
      );
    }

    const rows = XLSX.utils.sheet_to_json<SheetRecord>(ws, { defval: '' });

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

    // Normalize the already-created row objects in place instead of cloning every
    // row a second time; this materially reduces peak RSS on multi-million-cell uploads.
    for (const record of rows) {
      for (const col of dateColSet) {
        const rawVal = record[col];
        if (rawVal !== undefined && rawVal !== null && String(rawVal).trim() !== '') {
          const parsed = parseWorkbookDate(rawVal, uses1904DateSystem);
          if (parsed) {
            record[col] = formatUtcIso(parsed);
          }
        }
      }
    }
    const normalizedRows = rows;

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

    // The normalized records are now the authoritative in-memory representation.
    // Drop SheetJS's parsed cell-address map for this worksheet immediately rather
    // than retaining both the parser graph and the row-object dataset through the
    // later validation/profile/reconciliation stages. This is especially important
    // for large workbooks where the sparse cell map can be a substantial second copy.
    delete wb.Sheets[rawSheetName];
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
    const sourceRows = sheets[name].records || [];
    const hasRemovedRows = sourceRows.some((row) => Boolean(row._removed));
    const liveRows = hasRemovedRows
      ? sourceRows.filter((row) => !row._removed)
      : sourceRows;
    const hasInternalFields = liveRows.some((row) =>
      Object.keys(row).some((key) => key.startsWith('_'))
    );
    const cleanRows =
      liveRows.length > 0
        ? hasInternalFields
          ? liveRows.map((row) => {
              const keys = Object.keys(row);
              if (!keys.some((key) => key.startsWith('_'))) return row;
              const copy: SheetRecord = {};
              for (const key of keys) {
                if (!key.startsWith('_')) copy[key] = row[key];
              }
              return copy;
            })
          : liveRows
        : [
            Object.fromEntries(
              sheets[name].cols.map((c) => [c.col, ''])
            ),
          ];
    const ws = XLSX.utils.json_to_sheet(cleanRows);
    const exportName = name.slice(0, 31);
    if (wb.SheetNames.includes(exportName)) {
      throw new Error('Worksheet export name collision after Excel\'s 31-character limit: "' + exportName + '". Rename the source tables before export.');
    }
    XLSX.utils.book_append_sheet(wb, ws, exportName);
  }
  const binary = XLSX.write(wb, { type: 'binary', bookType: 'xlsx', compression: true }) as string;
  const out = new Uint8Array(binary.length);
  const chunkSize = 64 * 1024;
  for (let offset = 0; offset < binary.length; offset += chunkSize) {
    const end = Math.min(offset + chunkSize, binary.length);
    for (let index = offset; index < end; index++) {
      out[index] = binary.charCodeAt(index);
    }
  }
  return out;
}

interface StreamingSheetPlan {
  sourceName: string;
  exportName: string;
  records: SheetRecord[];
  headers: string[];
  columnRefs: string[];
  liveRowCount: number;
}

interface StreamingZipEntry {
  nameBytes: Uint8Array;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}

const ZIP_CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let value = n;
    for (let bit = 0; bit < 8; bit++) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[n] = value >>> 0;
  }
  return table;
})();

function updateZipCrc32(crc: number, bytes: Uint8Array): number {
  let next = crc;
  for (const byte of bytes) {
    next = ZIP_CRC32_TABLE[(next ^ byte) & 0xff] ^ (next >>> 8);
  }
  return next >>> 0;
}

function writeZipUint16(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
}

function writeZipUint32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

function encodeExcelColumn(index: number): string {
  let value = index + 1;
  let result = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function escapeWorkbookXml(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '\ufffd')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function workbookCellXml(reference: string, value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'number' && Number.isFinite(value)) {
    const serialized = Object.is(value, -0) ? '-0' : String(value);
    return '<c r="' + reference + '"><v>' + serialized + '</v></c>';
  }
  if (typeof value === 'boolean') {
    return '<c r="' + reference + '" t="b"><v>' + (value ? '1' : '0') + '</v></c>';
  }
  const serialized = value instanceof Date ? value.toISOString() : String(value);
  return '<c r="' + reference + '" t="inlineStr"><is><t xml:space="preserve">' +
    escapeWorkbookXml(serialized) + '</t></is></c>';
}

function planStreamingSheets(sheets: EnterpriseSheets): StreamingSheetPlan[] {
  const sourceNames = Object.keys(sheets);
  if (sourceNames.length === 0) {
    throw new Error('Cannot export a workbook with no worksheets.');
  }
  if (sourceNames.length > MAX_WORKSHEETS) {
    throw new Error('The workbook has ' + sourceNames.length + ' worksheets; the export limit is ' + MAX_WORKSHEETS + '.');
  }

  const usedNames = new Set<string>();
  const plans: StreamingSheetPlan[] = [];
  let totalRows = 0;
  let totalCells = 0;

  for (const sourceName of sourceNames) {
    const table = sheets[sourceName];
    const records = table.records || [];
    const headers: string[] = [];
    const seenHeaders = new Set<string>();
    let liveRowCount = 0;

    for (const record of records) {
      if (Boolean((record as Record<string, unknown>)._removed)) continue;
      liveRowCount++;
      for (const key of Object.keys(record)) {
        if (key.startsWith('_') || seenHeaders.has(key)) continue;
        seenHeaders.add(key);
        headers.push(key);
      }
    }

    if (liveRowCount === 0) {
      for (const column of table.cols) {
        if (column.col.startsWith('_') || seenHeaders.has(column.col)) continue;
        seenHeaders.add(column.col);
        headers.push(column.col);
      }
    }

    if (headers.length > MAX_COLUMNS_PER_SHEET) {
      throw new Error('Worksheet "' + sourceName + '" exceeds the ' + MAX_COLUMNS_PER_SHEET + '-column export limit.');
    }

    const rowsIncludingHeader = headers.length > 0 ? liveRowCount + 1 : 0;
    totalRows += rowsIncludingHeader;
    totalCells += rowsIncludingHeader * headers.length;
    if (totalRows > MAX_TOTAL_ROWS) {
      throw new Error('The workbook exceeds the ' + MAX_TOTAL_ROWS.toLocaleString() + '-row export limit.');
    }
    if (totalCells > MAX_TOTAL_CELLS) {
      throw new Error('The workbook exceeds the ' + MAX_TOTAL_CELLS.toLocaleString() + '-cell export limit.');
    }

    const exportName = sourceName.slice(0, 31);
    if (usedNames.has(exportName)) {
      throw new Error('Worksheet export name collision after Excel\'s 31-character limit: "' + exportName + '". Rename the source tables before export.');
    }
    usedNames.add(exportName);

    plans.push({
      sourceName,
      exportName,
      records,
      headers,
      columnRefs: headers.map((_, index) => encodeExcelColumn(index)),
      liveRowCount,
    });
  }

  if (plans.length + 4 > MAX_ARCHIVE_ENTRIES) {
    throw new Error('The workbook exceeds the ' + MAX_ARCHIVE_ENTRIES + '-entry ZIP export limit.');
  }
  return plans;
}

async function* singleWorkbookXmlChunk(value: string): AsyncGenerator<Uint8Array> {
  yield new TextEncoder().encode(value);
}

async function* worksheetXmlChunks(plan: StreamingSheetPlan): AsyncGenerator<Uint8Array> {
  const encoder = new TextEncoder();
  const lastColumn = plan.columnRefs[plan.columnRefs.length - 1] || 'A';
  const lastRow = Math.max(1, plan.liveRowCount + 1);
  const dimension = plan.headers.length > 0 ? 'A1:' + lastColumn + lastRow : 'A1';

  yield encoder.encode(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<dimension ref="' + dimension + '"/><sheetViews><sheetView workbookViewId="0"/></sheetViews>' +
    '<sheetFormatPr defaultRowHeight="15"/><sheetData>'
  );

  if (plan.headers.length > 0) {
    yield encoder.encode('<row r="1">');
    let batch = '';
    for (let index = 0; index < plan.headers.length; index++) {
      batch += workbookCellXml(plan.columnRefs[index] + '1', plan.headers[index]);
      if (batch.length >= 65_536) {
        yield encoder.encode(batch);
        batch = '';
      }
    }
    if (batch) yield encoder.encode(batch);
    yield encoder.encode('</row>');

    let rowNumber = 2;
    for (const record of plan.records) {
      if (Boolean((record as Record<string, unknown>)._removed)) continue;
      yield encoder.encode('<row r="' + rowNumber + '">');
      batch = '';
      for (let index = 0; index < plan.headers.length; index++) {
        const cell = workbookCellXml(
          plan.columnRefs[index] + rowNumber,
          record[plan.headers[index]]
        );
        if (!cell) continue;
        batch += cell;
        if (batch.length >= 65_536) {
          yield encoder.encode(batch);
          batch = '';
        }
      }
      if (batch) yield encoder.encode(batch);
      yield encoder.encode('</row>');
      rowNumber++;
    }
  }

  yield encoder.encode('</sheetData></worksheet>');
}

function createZipLocalHeader(
  nameBytes: Uint8Array,
  crc32: number,
  compressedSize: number,
  uncompressedSize: number
): Uint8Array {
  const header = new Uint8Array(30 + nameBytes.length);
  writeZipUint32(header, 0, 0x04034b50);
  writeZipUint16(header, 4, 20);
  writeZipUint16(header, 6, 0x0800); // UTF-8 filename; sizes are known before the header is written.
  writeZipUint16(header, 8, 8);
  writeZipUint32(header, 14, crc32);
  writeZipUint32(header, 18, compressedSize);
  writeZipUint32(header, 22, uncompressedSize);
  writeZipUint16(header, 26, nameBytes.length);
  nameBytes.forEach((byte, index) => { header[30 + index] = byte; });
  return header;
}

function createZipCentralDirectoryEntry(entry: StreamingZipEntry): Uint8Array {
  const central = new Uint8Array(46 + entry.nameBytes.length);
  writeZipUint32(central, 0, 0x02014b50);
  writeZipUint16(central, 4, 20);
  writeZipUint16(central, 6, 20);
  writeZipUint16(central, 8, 0x0800);
  writeZipUint16(central, 10, 8);
  writeZipUint32(central, 16, entry.crc32);
  writeZipUint32(central, 20, entry.compressedSize);
  writeZipUint32(central, 24, entry.uncompressedSize);
  writeZipUint16(central, 28, entry.nameBytes.length);
  writeZipUint32(central, 42, entry.localOffset);
  entry.nameBytes.forEach((byte, index) => { central[46 + index] = byte; });
  return central;
}

async function appendDeflatedZipEntry(
  name: string,
  source: AsyncIterable<Uint8Array>,
  append: (part: Uint8Array) => void,
  currentOffset: () => number,
  totalUncompressed: { value: number }
): Promise<StreamingZipEntry> {
  const nameBytes = new TextEncoder().encode(name);
  const localOffset = currentOffset();

  let compression: CompressionStream;
  try {
    compression = new CompressionStream('deflate-raw' as CompressionFormat);
  } catch {
    throw new Error('Streaming XLSX export requires browser support for raw DEFLATE compression.');
  }
  const writer = compression.writable.getWriter();
  const reader = compression.readable.getReader();
  const compressedParts: Uint8Array[] = [];
  let crc = 0xffffffff;
  let compressedSize = 0;
  let uncompressedSize = 0;
  let readerError: unknown;

  const readTask = (async () => {
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        if (!result.value || result.value.byteLength === 0) continue;
        compressedParts.push(result.value);
        compressedSize += result.value.byteLength;
      }
    } catch (error) {
      readerError = error;
    }
  })();

  try {
    for await (const chunk of source) {
      if (chunk.byteLength === 0) continue;
      uncompressedSize += chunk.byteLength;
      totalUncompressed.value += chunk.byteLength;
      if (
        !Number.isSafeInteger(uncompressedSize) ||
        totalUncompressed.value > MAX_UNCOMPRESSED_ARCHIVE_BYTES
      ) {
        throw new Error('Workbook export exceeds the ' +
          Math.round(MAX_UNCOMPRESSED_ARCHIVE_BYTES / (1024 * 1024)) +
          ' MiB uncompressed ZIP safety limit.');
      }
      crc = updateZipCrc32(crc, chunk);
      await writer.write(chunk);
      if (readerError) throw readerError;
    }
    await writer.close();
    await readTask;
    if (readerError) throw readerError;
  } catch (error) {
    await writer.abort(error).catch(() => undefined);
    await reader.cancel(error).catch(() => undefined);
    await readTask.catch(() => undefined);
    throw error;
  }

  const checksum = (crc ^ 0xffffffff) >>> 0;
  append(createZipLocalHeader(nameBytes, checksum, compressedSize, uncompressedSize));
  for (const part of compressedParts) append(part);
  compressedParts.length = 0;
  return {
    nameBytes,
    crc32: checksum,
    compressedSize,
    uncompressedSize,
    localOffset,
  };
}

function createZipEndRecord(
  entryCount: number,
  centralDirectorySize: number,
  centralDirectoryOffset: number
): Uint8Array {
  const end = new Uint8Array(22);
  writeZipUint32(end, 0, 0x06054b50);
  writeZipUint16(end, 8, entryCount);
  writeZipUint16(end, 10, entryCount);
  writeZipUint32(end, 12, centralDirectorySize);
  writeZipUint32(end, 16, centralDirectoryOffset);
  return end;
}

function joinZipParts(parts: Uint8Array[], totalBytes: number): Uint8Array {
  const output = new Uint8Array(totalBytes);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

async function buildStreamingWorkbookBinary(sheets: EnterpriseSheets): Promise<Uint8Array> {
  const plans = planStreamingSheets(sheets);
  const zipParts: Uint8Array[] = [];
  let offset = 0;
  const totalUncompressed = { value: 0 };
  const append = (part: Uint8Array): void => {
    zipParts.push(part);
    offset += part.byteLength;
  };
  const entries: StreamingZipEntry[] = [];

  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    plans.map((_, index) =>
      '<Override PartName="/xl/worksheets/sheet' + (index + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
    ).join('') +
    '</Types>';
  const rootRelationships =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>';
  const workbook =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets>' +
    plans.map((plan, index) =>
      '<sheet name="' + escapeWorkbookXml(plan.exportName) + '" sheetId="' + (index + 1) + '" r:id="rId' + (index + 1) + '"/>'
    ).join('') +
    '</sheets></workbook>';
  const workbookRelationships =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    plans.map((_, index) =>
      '<Relationship Id="rId' + (index + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (index + 1) + '.xml"/>'
    ).join('') +
    '</Relationships>';

  const fixedEntries: Array<[string, string]> = [
    ['[Content_Types].xml', contentTypes],
    ['_rels/.rels', rootRelationships],
    ['xl/workbook.xml', workbook],
    ['xl/_rels/workbook.xml.rels', workbookRelationships],
  ];
  for (const [name, value] of fixedEntries) {
    entries.push(
      await appendDeflatedZipEntry(
        name,
        singleWorkbookXmlChunk(value),
        append,
        () => offset,
        totalUncompressed
      )
    );
  }

  for (let index = 0; index < plans.length; index++) {
    entries.push(
      await appendDeflatedZipEntry(
        'xl/worksheets/sheet' + (index + 1) + '.xml',
        worksheetXmlChunks(plans[index]),
        append,
        () => offset,
        totalUncompressed
      )
    );
  }

  const centralDirectoryOffset = offset;
  const centralParts = entries.map(createZipCentralDirectoryEntry);
  const centralDirectorySize = centralParts.reduce((sum, part) => sum + part.byteLength, 0);
  for (const part of centralParts) append(part);
  append(createZipEndRecord(entries.length, centralDirectorySize, centralDirectoryOffset));

  if (offset > MAX_WORKBOOK_BYTES) {
    throw new Error('Workbook export exceeds the ' +
      Math.round(MAX_WORKBOOK_BYTES / (1024 * 1024)) + ' MiB workbook limit.');
  }
  if (offset > 0xffffffff || centralDirectoryOffset > 0xffffffff) {
    throw new Error('Workbook export exceeds the supported non-ZIP64 archive size.');
  }

  return joinZipParts(zipParts, offset);
}

export async function buildWorkbookBinaryAsync(
  sheets: EnterpriseSheets,
  options: { forceStreaming?: boolean } = {}
): Promise<Uint8Array> {
  if (!options.forceStreaming) {
    let estimatedCells = 0;
    for (const table of Object.values(sheets)) {
      const liveRows = (table.records || []).reduce(
        (count, row) => count + (row._removed ? 0 : 1),
        0
      );
      estimatedCells += (liveRows + 1) * Math.max(1, table.cols.length);
    }
    if (estimatedCells < 250_000) return buildWorkbookBinary(sheets);
  }
  return buildStreamingWorkbookBinary(sheets);
}
