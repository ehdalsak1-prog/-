import * as XLSX from 'xlsx';
import { MaterialItem } from '../App';

export interface ParsedRawSheet {
  sheetName: string;
  rows: string[][];
}

export interface ColumnMapping {
  nameCol: number; // 필수: 품목명 / 품명
  supplierCol: number; // 선택: 구매처 / 거래처 / 납품처 (-1 = 없음)
  specCol: number; // 선택: 규격 / 사양 (-1 = 없음)
  qtyCol: number; // 선택: 반입 수량 / 구매수량 (-1 = 없음)
  unitCol: number; // 선택: 단위 (-1 = 없음)
  packQtyCol: number; // 선택: 단위당 입수량 (-1 = 없음)
  dateCol: number; // 선택: 반입일자 (-1 = 없음)
  usageCol: number; // 선택: 용도 / 부가정보 (-1 = 없음, 비고와 병합)
  remarksCol: number; // 선택: 비고 / 특이사항 (-1 = 없음)
}

export interface MarkerFilterOption {
  colIndex: number;
  colLabel: string;
  markerValue: string;
  matchCount: number;
}

export interface CandidateRow {
  rowIndex: number;
  rawCells: string[];
  selected: boolean;
  excludeReason?: string;
  previewItem: Omit<MaterialItem, 'id' | 'createdAt'>;
}

export interface AppliedRuleSummary {
  label: string;
  mode: 'exclude' | 'include_only';
  affectedCount: number;
  unmatchedKeyword?: string;
}

export interface InstructionEvaluationResult {
  updatedCandidates: CandidateRow[];
  appliedRules: AppliedRuleSummary[];
  excludedTotal: number;
}

/**
 * RFC-4180 compliant TSV / CSV parser that preserves multi-line quoted cells
 * when copying & pasting directly from Microsoft Excel / Google Sheets / Hancom Cell.
 */
export function parseClipboardTableText(rawText: string): string[][] {
  const text = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!text.trim()) return [];

  // Determine delimiter: Excel clipboard uses '\t'; fallback to ',' if no tabs exist
  const hasTabs = text.includes('\t');
  const delimiter = hasTabs ? '\t' : ',';

  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          currentCell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        currentCell += ch;
      }
    } else {
      if (ch === '"' && currentCell === '') {
        inQuotes = true;
      } else if (ch === delimiter) {
        currentRow.push(currentCell.trim());
        currentCell = '';
      } else if (ch === '\n') {
        currentRow.push(currentCell.trim());
        if (currentRow.some((c) => c !== '')) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentCell = '';
      } else {
        currentCell += ch;
      }
    }
  }

  if (currentCell !== '' || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    if (currentRow.some((c) => c !== '')) {
      rows.push(currentRow);
    }
  }

  // Normalize column count across all rows
  const maxCols = rows.reduce((max, r) => Math.max(max, r.length), 0);
  return rows.map((r) => {
    if (r.length < maxCols) {
      return [...r, ...Array(maxCols - r.length).fill('')];
    }
    return r;
  });
}

/**
 * Reads .xlsx, .xls, .xlsm, or .csv files into an array of raw 2D string grids (one per worksheet).
 */
export async function parseExcelFileToRawSheets(file: File): Promise<ParsedRawSheet[]> {
  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, {
    type: 'array',
    cellDates: true,
    raw: false,
  });

  const result: ParsedRawSheet[] = [];

  workbook.SheetNames.forEach((sheetName) => {
    const ws = workbook.Sheets[sheetName];
    if (!ws) return;

    const rawGrid = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      defval: '',
      raw: false,
      blankrows: false,
    });

    const cleanedRows: string[][] = rawGrid
      .map((row) =>
        (Array.isArray(row) ? row : []).map((cell) => {
          if (cell === null || cell === undefined) return '';
          if (cell instanceof Date && !isNaN(cell.getTime())) {
            return cell.toISOString().split('T')[0];
          }
          return String(cell).trim();
        })
      )
      .filter((row) => row.some((c) => c !== ''));

    if (cleanedRows.length > 0) {
      const maxCols = cleanedRows.reduce((max, r) => Math.max(max, r.length), 0);
      const normalized = cleanedRows.map((r) =>
        r.length < maxCols ? [...r, ...Array(maxCols - r.length).fill('')] : r
      );
      result.push({
        sheetName,
        rows: normalized,
      });
    }
  });

  return result;
}

const HEADER_KEYWORDS = {
  no: ['no', 'no.', '연번', '순번', '번호', '#'],
  name: ['품명', '품목명', '자재품목명', '자재명', '제품명', '품목', '항목', '명칭', '내역', 'item', 'description'],
  supplier: ['구매처', '매입처', '거래처', '납품처', '공급처', '공급사', '발주처', '업체명', '제조사', '상호', 'supplier', 'vendor'],
  spec: ['규격', '사양', '규격/사양', '스펙', '모델', '치수', '사이즈', '호칭', 'spec', 'size'],
  qty: [
    '반입수량',
    '제작및구매수량',
    '구매수량',
    '수량',
    '발주수량',
    '예정수량',
    '입고수량',
    '반출수량',
    '개수',
    '물량',
    'qty',
    "q'ty",
    'quantity',
  ],
  unit: ['단위', '포장단위', '기준단위', 'unit'],
  packQty: ['단위당입수량', '입수량', '입수', '파레트당', '박스당', '포장입수'],
  date: ['반입일자', '입고일자', '입고일', '반입일', '일자', '날짜', '예정일', '발주일', 'date'],
  usage: ['용도', '사용처', '적용처', '배치', '구분'],
  remarks: ['비고', '특이사항', '비고/특이사항', '메모', '참고', '비고사항', 'remark', 'remarks', 'note'],
};

function normHeader(val: string): string {
  return val.replace(/\s+/g, '').toLowerCase();
}

function matchesAny(headerNorm: string, keywords: string[]): boolean {
  if (!headerNorm) return false;
  return keywords.some((kw) => headerNorm === kw || headerNorm.includes(kw));
}

export interface DetectedSheetStructure {
  headerRowIndex: number; // -1 if headerless raw rows
  columnLabels: string[];
  mapping: ColumnMapping;
  markerOptions: MarkerFilterOption[];
}

/**
 * Automatically locates the table header row (skipping top title banners if present)
 * and maps columns to MaterialItem fields.
 */
export function detectSheetStructure(rows: string[][]): DetectedSheetStructure {
  if (rows.length === 0) {
    return {
      headerRowIndex: -1,
      columnLabels: [],
      mapping: {
        nameCol: 0,
        supplierCol: -1,
        specCol: -1,
        qtyCol: -1,
        unitCol: -1,
        packQtyCol: -1,
        dateCol: -1,
        usageCol: -1,
        remarksCol: -1,
      },
      markerOptions: [],
    };
  }

  const maxCols = rows[0].length;
  let bestRowIdx = -1;
  let bestScore = 0;

  const scanLimit = Math.min(rows.length, 15);
  for (let r = 0; r < scanLimit; r++) {
    const row = rows[r];
    let score = 0;
    const nonEmpty = row.filter((c) => c !== '').length;
    if (nonEmpty < 2) continue;

    row.forEach((cell) => {
      const h = normHeader(cell);
      if (!h || h.length > 20) return;
      if (matchesAny(h, HEADER_KEYWORDS.name)) score += 5;
      else if (matchesAny(h, HEADER_KEYWORDS.qty)) score += 4;
      else if (matchesAny(h, HEADER_KEYWORDS.unit)) score += 3;
      else if (matchesAny(h, HEADER_KEYWORDS.spec)) score += 3;
      else if (matchesAny(h, HEADER_KEYWORDS.supplier)) score += 3;
      else if (matchesAny(h, HEADER_KEYWORDS.remarks)) score += 2;
      else if (matchesAny(h, HEADER_KEYWORDS.usage)) score += 2;
      else if (matchesAny(h, HEADER_KEYWORDS.date)) score += 2;
      else if (matchesAny(h, HEADER_KEYWORDS.no)) score += 2;
    });

    if (score > bestScore && score >= 5) {
      bestScore = score;
      bestRowIdx = r;
    }
  }

  const mapping: ColumnMapping = {
    nameCol: -1,
    supplierCol: -1,
    specCol: -1,
    qtyCol: -1,
    unitCol: -1,
    packQtyCol: -1,
    dateCol: -1,
    usageCol: -1,
    remarksCol: -1,
  };

  let columnLabels: string[] = [];

  if (bestRowIdx >= 0) {
    const headerRow = rows[bestRowIdx];
    columnLabels = headerRow.map((cell, idx) =>
      cell ? `${cell} (${idx + 1}열)` : `빈 머리글 (${idx + 1}열)`
    );

    headerRow.forEach((cell, idx) => {
      const h = normHeader(cell);
      if (!h) return;

      // Check packQty BEFORE qty because '단위당입수량' contains '수량'
      if (mapping.packQtyCol === -1 && matchesAny(h, HEADER_KEYWORDS.packQty)) {
        mapping.packQtyCol = idx;
        return;
      }
      if (
        mapping.qtyCol === -1 &&
        matchesAny(h, HEADER_KEYWORDS.qty) &&
        !h.includes('총수량') &&
        !h.includes('총환산')
      ) {
        mapping.qtyCol = idx;
        return;
      }
      if (mapping.nameCol === -1 && matchesAny(h, HEADER_KEYWORDS.name)) {
        mapping.nameCol = idx;
        return;
      }
      if (mapping.supplierCol === -1 && matchesAny(h, HEADER_KEYWORDS.supplier)) {
        mapping.supplierCol = idx;
        return;
      }
      if (mapping.specCol === -1 && matchesAny(h, HEADER_KEYWORDS.spec)) {
        mapping.specCol = idx;
        return;
      }
      if (mapping.unitCol === -1 && matchesAny(h, HEADER_KEYWORDS.unit)) {
        mapping.unitCol = idx;
        return;
      }
      if (mapping.dateCol === -1 && matchesAny(h, HEADER_KEYWORDS.date)) {
        mapping.dateCol = idx;
        return;
      }
      if (mapping.usageCol === -1 && matchesAny(h, HEADER_KEYWORDS.usage)) {
        mapping.usageCol = idx;
        return;
      }
      if (mapping.remarksCol === -1 && matchesAny(h, HEADER_KEYWORDS.remarks)) {
        mapping.remarksCol = idx;
        return;
      }
    });
  } else {
    // Headerless paste heuristic (e.g., user highlighted only data rows in Excel without header)
    columnLabels = Array.from({ length: maxCols }, (_, idx) => `${idx + 1}열`);
    const sampleRows = rows.slice(0, Math.min(rows.length, 20));
    const unitRegex = /^(파레트|파렛트|팔레트|PLT|EA|BOX|박스|개|곽|묶음|롤|대|set|마대|톤백|kg|m|본|장|매)$/i;
    const dateRegex = /^20\d{2}[-./]\d{1,2}[-./]\d{1,2}$/;

    for (let c = 0; c < maxCols; c++) {
      const vals = sampleRows.map((r) => r[c] || '').filter(Boolean);
      if (vals.length === 0) continue;

      const dateMatches = vals.filter((v) => dateRegex.test(v)).length;
      if (mapping.dateCol === -1 && dateMatches >= vals.length * 0.6) {
        mapping.dateCol = c;
        continue;
      }

      const unitMatches = vals.filter((v) => unitRegex.test(v)).length;
      if (mapping.unitCol === -1 && unitMatches >= vals.length * 0.5) {
        mapping.unitCol = c;
        continue;
      }
    }

    // Find nameCol (first non-sequential text column) & qtyCol (numeric column)
    for (let c = 0; c < maxCols; c++) {
      if (c === mapping.dateCol || c === mapping.unitCol) continue;
      const vals = sampleRows.map((r) => r[c] || '').filter(Boolean);
      if (vals.length === 0) continue;

      const numericCount = vals.filter((v) => /^[\d,]+(\.\d+)?$/.test(v)).length;
      const isSequentialNo =
        c === 0 &&
        numericCount === vals.length &&
        vals.every((v, i) => parseInt(v, 10) === i + 1);

      if (isSequentialNo) continue;

      if (mapping.nameCol === -1 && numericCount < vals.length * 0.5) {
        mapping.nameCol = c;
      } else if (mapping.qtyCol === -1 && numericCount >= vals.length * 0.5) {
        mapping.qtyCol = c;
      } else if (mapping.specCol === -1 && c > mapping.nameCol && mapping.qtyCol === -1) {
        mapping.specCol = c;
      } else if (mapping.remarksCol === -1 && c > (mapping.qtyCol >= 0 ? mapping.qtyCol : 1)) {
        mapping.remarksCol = c;
      }
    }
  }

  if (mapping.nameCol === -1) {
    mapping.nameCol = maxCols > 1 ? 1 : 0;
  }

  // Detect check/marker columns (such as rightmost 'O' / '○' / 'V' column in user's Excel sheets!)
  const dataRows = rows.slice(bestRowIdx + 1);
  const markerOptions: MarkerFilterOption[] = [];
  const checkSymbols = new Set(['o', '○', 'ㅇ', '●', 'v', '✓', '✔', '체크', 'y', 'yes', '대상']);

  for (let c = 0; c < maxCols; c++) {
    if (
      c === mapping.nameCol ||
      c === mapping.qtyCol ||
      c === mapping.unitCol ||
      c === mapping.dateCol
    ) {
      continue;
    }

    const counts: Record<string, number> = {};
    dataRows.forEach((r) => {
      const val = (r[c] || '').trim();
      if (!val) return;
      const normalized = val.toUpperCase() === 'O' || val === '○' || val === 'ㅇ' ? 'O' : val;
      counts[normalized] = (counts[normalized] || 0) + 1;
    });

    Object.entries(counts).forEach(([val, count]) => {
      if (
        count >= 1 &&
        count < dataRows.length &&
        (checkSymbols.has(val.toLowerCase()) || (bestRowIdx >= 0 && !rows[bestRowIdx][c] && val.length <= 4))
      ) {
        markerOptions.push({
          colIndex: c,
          colLabel: columnLabels[c] || `${c + 1}열`,
          markerValue: val,
          matchCount: count,
        });
      }
    });
  }

  return {
    headerRowIndex: bestRowIdx,
    columnLabels,
    mapping,
    markerOptions,
  };
}

function normalizeUnit(raw: string): string {
  const t = raw.trim();
  if (!t) return 'EA';
  if (t === '파렛트' || t === '팔레트' || t.toUpperCase() === 'PLT') return '파레트';
  if (t.toLowerCase() === 'box' || t === '박스') return 'BOX';
  if (t.toLowerCase() === 'ea') return 'EA';
  return t;
}

function normalizeDateString(raw: string, fallbackDate: string): string {
  const t = raw.trim();
  if (!t) return fallbackDate;
  const isoMatch = t.match(/^(20\d{2})[-./](\d{1,2})[-./](\d{1,2})/);
  if (isoMatch) {
    const yyyy = isoMatch[1];
    const mm = isoMatch[2].padStart(2, '0');
    const dd = isoMatch[3].padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  return fallbackDate;
}

function parseQtyCell(raw: string): { qty: number; embeddedUnit?: string } {
  const cleaned = raw.replace(/,/g, '').trim();
  if (!cleaned || cleaned === '-') return { qty: 0 };

  const numAndUnit = cleaned.match(/^([\d.]+)\s*([a-zA-Z가-힣]+)?$/);
  if (numAndUnit) {
    const parsed = parseFloat(numAndUnit[1]);
    return {
      qty: isNaN(parsed) ? 0 : parsed,
      embeddedUnit: numAndUnit[2] ? normalizeUnit(numAndUnit[2]) : undefined,
    };
  }

  const fallback = parseFloat(cleaned);
  return { qty: isNaN(fallback) ? 0 : fallback };
}

function extractPackQtyFromText(
  text: string
): { containerUnit: string; packQty: number; subUnit: string } | null {
  if (!text) return null;
  // Matches patterns like "1파레트 = 630 EA", "1곽 - 12EA", "1BOX = 20개"
  const m = text.match(
    /1\s*(파레트|파렛트|팔레트|PLT|박스|BOX|곽|묶음|마대|톤백|랙|단)\s*[=:-]\s*([\d,]+(?:\.\d+)?)\s*([a-zA-Z가-힣]+)/i
  );
  if (!m) return null;
  const pq = parseFloat(m[2].replace(/,/g, ''));
  if (isNaN(pq) || pq <= 0) return null;
  return {
    containerUnit: normalizeUnit(m[1]),
    packQty: pq,
    subUnit: normalizeUnit(m[3]),
  };
}

function isSummaryOrFooterRow(row: string[], nameVal: string): boolean {
  const joined = row.join(' ').replace(/\s+/g, '');
  if (joined.includes('등록된자재내역이없습니다')) {
    return true;
  }
  if (!nameVal) {
    if (
      joined.includes('합계') ||
      joined.includes('총계') ||
      joined.includes('소계') ||
      joined.toLowerCase().includes('total')
    ) {
      return true;
    }
    return true;
  }
  const cleanName = nameVal.replace(/\s+/g, '');
  if (
    cleanName === '합계' ||
    cleanName.startsWith('합계(') ||
    cleanName === '총계' ||
    cleanName === '소계' ||
    cleanName.includes('등록된자재내역이없습니다')
  ) {
    return true;
  }
  return false;
}

/**
 * Builds candidate MaterialItems from raw 2D grid rows using the chosen ColumnMapping.
 */
export function buildCandidateRows(
  rows: string[][],
  headerRowIndex: number,
  mapping: ColumnMapping,
  defaultDate: string
): CandidateRow[] {
  const startRow = headerRowIndex >= 0 ? headerRowIndex + 1 : 0;
  const candidates: CandidateRow[] = [];

  for (let r = startRow; r < rows.length; r++) {
    const row = rows[r];
    const rowJoined = row.join(' ').replace(/\s+/g, '');
    if (
      rowJoined.includes('■단위별') ||
      rowJoined.includes('단위별전체총량') ||
      rowJoined.includes('■품목별') ||
      rowJoined.includes('품목별반입수량') ||
      rowJoined.includes('품목별누적합계')
    ) {
      break;
    }

    const nameVal = mapping.nameCol >= 0 ? (row[mapping.nameCol] || '').trim() : '';

    if (isSummaryOrFooterRow(row, nameVal)) {
      continue;
    }

    const rawSupplierVal =
      mapping.supplierCol >= 0 ? (row[mapping.supplierCol] || '').trim() : '';
    const supplierVal = rawSupplierVal === '-' ? '' : rawSupplierVal;
    const specVal = mapping.specCol >= 0 ? (row[mapping.specCol] || '').trim() : '';
    const rawQtyStr = mapping.qtyCol >= 0 ? (row[mapping.qtyCol] || '').trim() : '';
    const rawUnitStr = mapping.unitCol >= 0 ? (row[mapping.unitCol] || '').trim() : '';
    const rawPackStr = mapping.packQtyCol >= 0 ? (row[mapping.packQtyCol] || '').trim() : '';
    const rawDateStr = mapping.dateCol >= 0 ? (row[mapping.dateCol] || '').trim() : '';
    const usageVal = mapping.usageCol >= 0 ? (row[mapping.usageCol] || '').trim() : '';
    const remarksVal = mapping.remarksCol >= 0 ? (row[mapping.remarksCol] || '').trim() : '';

    const { qty, embeddedUnit } = parseQtyCell(rawQtyStr);
    const finalUnit = rawUnitStr
      ? normalizeUnit(rawUnitStr)
      : embeddedUnit
      ? embeddedUnit
      : qty > 0
      ? 'EA'
      : '-';

    // Parse packQty from dedicated column OR auto-detect from remarks when container unit matches finalUnit
    let packQty: number | undefined;
    let subUnit: string | undefined;

    if (rawPackStr && rawPackStr !== '-') {
      const parsedPack = parseQtyCell(rawPackStr);
      if (parsedPack.qty > 0) {
        packQty = parsedPack.qty;
        subUnit = parsedPack.embeddedUnit || 'EA';
      }
    } else {
      const hint = extractPackQtyFromText(remarksVal) || extractPackQtyFromText(usageVal);
      if (
        hint &&
        finalUnit.toUpperCase() === hint.containerUnit.toUpperCase() &&
        finalUnit.toUpperCase() !== hint.subUnit.toUpperCase()
      ) {
        packQty = hint.packQty;
        subUnit = hint.subUnit;
      }
    }

    // Combine usage + remarks cleanly without losing multi-line notes (flatten internal newlines to ' / ')
    const cleanUsage = usageVal.replace(/\s*\n\s*/g, ' / ').trim();
    const cleanRemarks = remarksVal.replace(/\s*\n\s*/g, ' / ').trim();
    let combinedRemarks = '';
    if (cleanUsage && cleanRemarks) {
      combinedRemarks = `${cleanUsage} · ${cleanRemarks}`;
    } else {
      combinedRemarks = cleanRemarks || cleanUsage;
    }

    candidates.push({
      rowIndex: r,
      rawCells: row,
      selected: true,
      previewItem: {
        name: nameVal,
        supplier: supplierVal,
        spec: specVal || '-',
        quantity: qty,
        unit: finalUnit,
        packQty,
        subUnit,
        isCompleted: false,
        location: '',
        remarks: combinedRemarks,
        date: normalizeDateString(rawDateStr, defaultDate),
      },
    });
  }

  return candidates;
}

/**
 * Matches a keyword against a candidate row's fields & raw cells.
 * Uses boundary matching for short ASCII codes (e.g., 'AA' won't falsely match 'AAA' or 'EA')
 * and space-insensitive matching for Korean/longer phrases (e.g., '박스테이프' matches '박스 테이프').
 */
function rowMatchesKeyword(cand: CandidateRow, rawKeyword: string): boolean {
  const kw = rawKeyword.trim();
  if (!kw) return false;

  const fields = [
    cand.previewItem.name,
    cand.previewItem.supplier || '',
    cand.previewItem.spec !== '-' ? cand.previewItem.spec : '',
    cand.previewItem.unit !== '-' ? cand.previewItem.unit : '',
    cand.previewItem.remarks,
    ...cand.rawCells,
  ].filter(Boolean);

  const joinedLower = fields.join(' | ').toLowerCase();
  const kwLower = kw.toLowerCase();
  const kwNoSpace = kwLower.replace(/\s+/g, '');

  // Short ASCII code like 'AA', 'AAA', 'A3', 'A4', '5M' -> strict alphanumeric boundary check
  if (/^[a-z0-9]{1,3}$/i.test(kwNoSpace)) {
    const escaped = kwNoSpace.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const boundaryRegex = new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, 'i');
    return fields.some((f) => boundaryRegex.test(f));
  }

  if (joinedLower.includes(kwLower)) return true;

  const joinedNoSpace = fields.map((f) => f.toLowerCase().replace(/\s+/g, '')).join('|');
  return joinedNoSpace.includes(kwNoSpace);
}

function getCandidateNumber(cand: CandidateRow, idx: number): number {
  const firstCell = (cand.rawCells[0] || '').trim();
  if (/^\d+$/.test(firstCell)) {
    const parsed = parseInt(firstCell, 10);
    if (parsed > 0) return parsed;
  }
  return idx + 1;
}

function rowHasCheckMarker(cand: CandidateRow, markerOptions: MarkerFilterOption[]): boolean {
  const checkSet = new Set(['o', '○', 'ㅇ', '●', 'v', '✓', '✔', '체크', 'y', 'yes', '대상']);
  if (markerOptions.length > 0) {
    return markerOptions.some((opt) => {
      const val = (cand.rawCells[opt.colIndex] || '').trim();
      if (!val) return false;
      const norm = val.toUpperCase() === 'O' || val === '○' || val === 'ㅇ' ? 'O' : val;
      return norm === opt.markerValue || checkSet.has(norm.toLowerCase());
    });
  }
  // Fallback: check last 2 columns for O / V symbols
  const len = cand.rawCells.length;
  for (let c = Math.max(0, len - 2); c < len; c++) {
    const val = (cand.rawCells[c] || '').trim().toLowerCase();
    if (checkSet.has(val)) return true;
  }
  return false;
}

function cleanExtractedKeyword(raw: string): string {
  let s = raw
    .trim()
    .replace(/^['"「『[\]()]+|['"」』[\]()]+$/g, '')
    .trim();

  // Strip trailing Korean particles safely when stem is >= 2 chars
  if (s.length >= 3) {
    if (/(?:은|는|을|를)$/.test(s)) {
      s = s.slice(0, -1).trim();
    } else if (
      s.endsWith('도') &&
      !['제도', '용도', '온도', '습도', '강도', '속도', '각도'].some((w) => s.endsWith(w))
    ) {
      s = s.slice(0, -1).trim();
    }
  }
  return s;
}

/**
 * Evaluates natural-language Korean exclusion/inclusion instructions written by the user
 * (e.g. "수량 빈칸 빼줘, 1~5번 제외, 스티커랑 건전지 빼고 넣어줘, 동그라미 친거만")
 * and updates CandidateRow.selected + CandidateRow.excludeReason accordingly.
 */
export function applyExclusionInstructions(
  candidates: CandidateRow[],
  instructionText: string,
  markerOptions: MarkerFilterOption[] = []
): InstructionEvaluationResult {
  const baseCandidates: CandidateRow[] = candidates.map((c) => ({
    ...c,
    selected: true,
    excludeReason: undefined,
  }));

  const trimmed = instructionText.trim();
  if (!trimmed || baseCandidates.length === 0) {
    return {
      updatedCandidates: baseCandidates,
      appliedRules: [],
      excludedTotal: 0,
    };
  }

  // Normalize conjunction verbs into clause breaks while keeping the verb on the left clause
  const normalizedText = trimmed
    .replace(/\r\n/g, '\n')
    .replace(/(빼고|제외하고|말고|넣고|넣어주고|선택하고|남기고)\s+/g, '$1\n')
    .replace(/\s+(?:그리고|및)\s+/g, '\n');

  const rawSegments = normalizedText
    .split(/[\n;]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const appliedRules: AppliedRuleSummary[] = [];

  const markExcluded = (
    predicate: (cand: CandidateRow, idx: number) => boolean,
    reasonLabel: string,
    summaryLabel: string,
    mode: 'exclude' | 'include_only',
    unmatchedKeyword?: string
  ) => {
    let count = 0;
    baseCandidates.forEach((cand, idx) => {
      if (predicate(cand, idx)) {
        count += 1;
        cand.selected = false;
        if (!cand.excludeReason) {
          cand.excludeReason = reasonLabel;
        }
      }
    });
    appliedRules.push({
      label: summaryLabel,
      mode,
      affectedCount: count,
      unmatchedKeyword: count === 0 ? unmatchedKeyword : undefined,
    });
  };

  for (const segment of rawSegments) {
    const segClean = segment.replace(/[.!~]+$/g, '').trim();
    if (!segClean) continue;
    const segNoSpace = segClean.replace(/\s+/g, '').toLowerCase();

    const hasExcludeVerb = /(?:빼|제외|삭제|넣지\s*마|넣지말|안\s*넣|불포함|말고|패스)/.test(segClean);
    const hasIncludeOnly =
      !hasExcludeVerb &&
      /만(?:\s*(?:넣어.*|선택.*|가져.*|남겨.*|추출.*|등록.*|포함.*|유지.*))?$/.test(segClean);

    // 1. Check / Circle Marker ('O', '동그라미', '체크') rules
    if (/(?:동그라미|o표시|ㅇ표시|체크표시|체크된|체크항목|표시친|표시된)/i.test(segNoSpace)) {
      const refersToUnmarked = /(?:안된|안친|없는|아닌|미표시|안한)/.test(segNoSpace);
      if ((refersToUnmarked && hasExcludeVerb) || (!refersToUnmarked && hasIncludeOnly)) {
        markExcluded(
          (cand) => !rowHasCheckMarker(cand, markerOptions),
          '체크(O) 미표시',
          '체크(O) 표시 항목만 유지',
          'include_only'
        );
        continue;
      }
      if (!refersToUnmarked && hasExcludeVerb) {
        markExcluded(
          (cand) => rowHasCheckMarker(cand, markerOptions),
          '체크(O) 표시 제외',
          '체크(O) 표시 항목 제외',
          'exclude'
        );
        continue;
      }
    }

    // 2. Blank / Undecided Quantity ('수량 빈칸 빼줘', '수량 없는거 제외', '수량 미정 제외', '수량 있는것만')
    if (
      (/(?:수량).*(?:없는|빈칸|비어|미정|안적힌|모르는|^0$|0인)/.test(segNoSpace) && !hasIncludeOnly) ||
      /^미정(?:품목|항목)?(?:빼|제외|삭제)?/.test(segNoSpace) ||
      (/(?:수량).*(?:있는|확정|적힌)/.test(segNoSpace) && hasIncludeOnly)
    ) {
      markExcluded(
        (cand) => cand.previewItem.quantity <= 0,
        '수량 빈칸/미정',
        '수량 빈칸(미정) 제외',
        'exclude'
      );
      continue;
    }

    // 3. Blank Spec / Blank Remarks rules
    if (/(?:규격|사양).*(?:없는|빈칸|비어)/.test(segNoSpace) && !hasIncludeOnly) {
      markExcluded(
        (cand) => !cand.previewItem.spec || cand.previewItem.spec === '-',
        '규격 없음',
        '규격 빈칸 제외',
        'exclude'
      );
      continue;
    }
    if (/(?:규격|사양).*(?:있는|적힌)/.test(segNoSpace) && hasIncludeOnly) {
      markExcluded(
        (cand) => !cand.previewItem.spec || cand.previewItem.spec === '-',
        '규격 없음',
        '규격 있는 항목만 유지',
        'include_only'
      );
      continue;
    }
    if (/비고.*(?:없는|빈칸|비어)/.test(segNoSpace) && !hasIncludeOnly) {
      markExcluded(
        (cand) => !cand.previewItem.remarks.trim(),
        '비고 없음',
        '비고 빈칸 제외',
        'exclude'
      );
      continue;
    }
    if (/비고.*(?:있는|적힌)/.test(segNoSpace) && hasIncludeOnly) {
      markExcluded(
        (cand) => !cand.previewItem.remarks.trim(),
        '비고 없음',
        '비고 있는 항목만 유지',
        'include_only'
      );
      continue;
    }

    // 4. Numeric Quantity Comparison ('수량 10개 이상 빼줘', '수량 5 이하 제외', '수량 10 이상만')
    const qtyCompMatch = segClean.match(
      /수량(?:이|은|는)?\s*([\d,]+(?:\.\d+)?)\s*(?:개|박스|box|ea|파레트|곽|묶음|건)?\s*(이상|이하|초과|미만)/i
    );
    if (qtyCompMatch) {
      const targetNum = parseFloat(qtyCompMatch[1].replace(/,/g, ''));
      const op = qtyCompMatch[2];
      if (!isNaN(targetNum)) {
        const matchesQty = (q: number) => {
          if (op === '이상') return q >= targetNum;
          if (op === '이하') return q <= targetNum;
          if (op === '초과') return q > targetNum;
          return q < targetNum;
        };
        if (hasIncludeOnly) {
          markExcluded(
            (cand) => !matchesQty(cand.previewItem.quantity),
            `수량 ${targetNum}${op} 외 제외`,
            `수량 ${targetNum} ${op}만 유지`,
            'include_only'
          );
        } else {
          markExcluded(
            (cand) => matchesQty(cand.previewItem.quantity),
            `수량 ${targetNum}${op}`,
            `수량 ${targetNum} ${op} 제외`,
            'exclude'
          );
        }
        continue;
      }
    }

    // 5. Row Number Range ('1~5번 빼줘', '44~49번 제외', '1번부터 5번까지')
    const rangeMatch = segClean.match(
      /^(\d+)\s*(?:번|행)?\s*(?:~|-|에서|부터)\s*(\d+)\s*(?:번|행)?(?:까지)?/
    );
    if (rangeMatch) {
      const startNo = parseInt(rangeMatch[1], 10);
      const endNo = parseInt(rangeMatch[2], 10);
      const minNo = Math.min(startNo, endNo);
      const maxNo = Math.max(startNo, endNo);
      if (hasIncludeOnly) {
        markExcluded(
          (cand, idx) => {
            const no = getCandidateNumber(cand, idx);
            return no < minNo || no > maxNo;
          },
          `${minNo}~${maxNo}번 외 제외`,
          `${minNo}~${maxNo}번 행만 유지`,
          'include_only'
        );
      } else {
        markExcluded(
          (cand, idx) => {
            const no = getCandidateNumber(cand, idx);
            return no >= minNo && no <= maxNo;
          },
          `${minNo}~${maxNo}번 제외`,
          `${minNo}~${maxNo}번 행 제외`,
          'exclude'
        );
      }
      continue;
    }

    // Open-ended row number ('44번 이후 빼줘', '5번 이하 제외')
    const openNoMatch = segClean.match(/^(\d+)\s*(?:번|행)\s*(이후|이상|부터|이전|이하)/);
    if (openNoMatch) {
      const boundNo = parseInt(openNoMatch[1], 10);
      const dir = openNoMatch[2];
      const isUpper = dir === '이후' || dir === '이상' || dir === '부터';
      markExcluded(
        (cand, idx) => {
          const no = getCandidateNumber(cand, idx);
          return isUpper ? no >= boundNo : no <= boundNo;
        },
        `${boundNo}번 ${dir} 제외`,
        `${boundNo}번 ${dir} 행 제외`,
        'exclude'
      );
      continue;
    }

    // Explicit row number list ('1번, 3번, 10번 빼줘' or '1, 2, 5번 제외')
    if (/^(?:\d+\s*(?:번|행)?\s*[,/·\s]+)*\d+\s*(?:번|행)/.test(segClean)) {
      const nums = Array.from(segClean.matchAll(/(\d+)/g)).map((m) => parseInt(m[1], 10));
      if (nums.length > 0) {
        const numSet = new Set(nums);
        const labelNums = nums.join(', ');
        if (hasIncludeOnly) {
          markExcluded(
            (cand, idx) => !numSet.has(getCandidateNumber(cand, idx)),
            `${labelNums}번 외 제외`,
            `${labelNums}번 행만 유지`,
            'include_only'
          );
        } else {
          markExcluded(
            (cand, idx) => numSet.has(getCandidateNumber(cand, idx)),
            `No.${labelNums} 제외`,
            `${labelNums}번 행 제외`,
            'exclude'
          );
        }
        continue;
      }
    }

    // 6. General Keyword / Phrase List (Inclusion or Exclusion across 품명·규격·단위·용도·비고)
    let strippedBody = segClean;
    if (hasIncludeOnly) {
      strippedBody = strippedBody
        .replace(
          /\s*(?:들어간\s*(?:것|거|항목)?|포함된\s*(?:것|거|항목)?|적힌\s*(?:것|거|항목)?|관련\s*(?:품목|항목)?)?\s*만(?:\s*(?:넣어.*|선택.*|가져.*|남겨.*|추출.*|등록.*|포함.*|유지.*))?$/,
          ''
        )
        .trim();
    } else {
      strippedBody = strippedBody
        .replace(
          /(?:은|는|을|를|도)?\s*(?:들어간\s*(?:것|거|항목)?|포함된\s*(?:것|거|항목)?|적힌\s*(?:것|거|항목)?|관련\s*(?:품목|항목)?)?\s*(?:은|는|을|를|도)?\s*(?:모두\s*|전부\s*|다\s*)?(?:빼줘|빼주세요|빼달라.*|빼고|빼기|빼|제외해.*|제외하고|제외|삭제해.*|삭제|넣지\s*마.*|넣지말.*|안\s*넣.*|불포함|말고|패스)$/,
          ''
        )
        .trim();
    }

    const rawKeywords = strippedBody
      .replace(/([가-힣a-zA-Z0-9\])])(?:이랑|랑)\s+/g, '$1, ')
      .replace(/\s+(?:하고|와|과)\s+/g, ', ')
      .split(/[,/·]+/)
      .map(cleanExtractedKeyword)
      .filter(Boolean);

    if (rawKeywords.length === 0) continue;

    if (hasIncludeOnly) {
      const joinedLabel = rawKeywords.map((k) => `'${k}'`).join('·');
      const anyMatchedInTable = baseCandidates.some((c) =>
        rawKeywords.some((kw) => rowMatchesKeyword(c, kw))
      );
      markExcluded(
        (cand) => !rawKeywords.some((kw) => rowMatchesKeyword(cand, kw)),
        `${joinedLabel} 미포함`,
        `${joinedLabel} 포함 항목만 유지`,
        'include_only',
        anyMatchedInTable ? undefined : rawKeywords.join(', ')
      );
    } else {
      rawKeywords.forEach((kw) => {
        // Check if keyword is a specific row number like '15번'
        const singleRowMatch = kw.match(/^(\d+)\s*(?:번|행)$/);
        if (singleRowMatch) {
          const targetNo = parseInt(singleRowMatch[1], 10);
          markExcluded(
            (cand, idx) => getCandidateNumber(cand, idx) === targetNo,
            `${targetNo}번 제외`,
            `${targetNo}번 행 제외`,
            'exclude',
            `${targetNo}번`
          );
          return;
        }

        markExcluded(
          (cand) => rowMatchesKeyword(cand, kw),
          `'${kw}' 제외`,
          `'${kw}' 포함 제외`,
          'exclude',
          kw
        );
      });
    }
  }

  const excludedTotal = baseCandidates.filter((c) => !c.selected).length;

  return {
    updatedCandidates: baseCandidates,
    appliedRules,
    excludedTotal,
  };
}

/**
 * Helper to convert a ParsedRawSheet directly into ready-to-save preview items
 * (used when importing all sheets from a multi-tab Excel workbook at once).
 */
export function autoConvertRawSheetItems(
  rawSheet: ParsedRawSheet,
  defaultDate: string,
  instructionText = ''
): Omit<MaterialItem, 'id' | 'createdAt'>[] {
  const detected = detectSheetStructure(rawSheet.rows);
  const candidates = buildCandidateRows(
    rawSheet.rows,
    detected.headerRowIndex,
    detected.mapping,
    defaultDate
  );
  if (instructionText.trim()) {
    const evaluated = applyExclusionInstructions(
      candidates,
      instructionText,
      detected.markerOptions
    );
    return evaluated.updatedCandidates
      .filter((c) => c.selected)
      .map((c) => c.previewItem);
  }
  return candidates.map((c) => c.previewItem);
}
