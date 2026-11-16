import * as XLSX from 'xlsx';
import { ErpAppState, InventoryItem } from '../types/erp';
import { getTodayDateStr } from './erpCalculator';

export type ImportedReceiptRowStatus = 'NEW' | 'DUPLICATE' | 'UNREGISTERED';

export interface ParsedReceiptImportRow {
  rowIndex: number; // Excel 1-based row number
  receiptDate: string; // YYYY-MM-DD
  rawName: string;
  resolvedName: string; // '육각볼트' -> '헥사 볼트' 적용됨
  specification: string;
  unit: string;
  quantity: number;
  supplier: string;
  worker: string;
  note: string;
  matchedItem: InventoryItem | null;
  status: ImportedReceiptRowStatus;
}

export interface ParseReceiptExcelResult {
  sheetName: string;
  totalRows: number;
  newRows: ParsedReceiptImportRow[];
  duplicateRows: ParsedReceiptImportRow[];
  unregisteredRows: ParsedReceiptImportRow[];
  skippedInvalidCount: number;
  allRows: ParsedReceiptImportRow[];
  error?: string;
}

export function normalizeBoltText(text: string): string {
  return text.replace(/육각\s*볼트/g, '헥사 볼트');
}

function normKey(text: string): string {
  return normalizeBoltText(text)
    .toLowerCase()
    .replace(/[*x×]/g, 'x')
    .replace(/[\s_\-()\[\]]+/g, '');
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function parseExcelDate(cell: unknown, defaultYear: number): string {
  if (typeof cell === 'number' && cell > 20000 && cell < 80000) {
    const parsed = XLSX.SSF.parse_date_code(cell);
    if (parsed && parsed.y && parsed.m && parsed.d) {
      return `${parsed.y}-${pad2(parsed.m)}-${pad2(parsed.d)}`;
    }
  }

  if (cell instanceof Date && !isNaN(cell.getTime())) {
    return `${cell.getFullYear()}-${pad2(cell.getMonth() + 1)}-${pad2(cell.getDate())}`;
  }

  const raw = String(cell ?? '').trim();
  if (!raw) return getTodayDateStr();

  // YYYY-MM-DD, YYYY.MM.DD, YYYY/MM/DD
  const fullMatch = raw.match(/^(\d{4})[.\-/년\s]+(\d{1,2})[.\-/월\s]+(\d{1,2})/);
  if (fullMatch) {
    return `${fullMatch[1]}-${pad2(Number(fullMatch[2]))}-${pad2(Number(fullMatch[3]))}`;
  }

  // YY-MM-DD, YY.MM.DD, YY/MM/DD
  const shortYearMatch = raw.match(/^(\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (shortYearMatch) {
    return `20${shortYearMatch[1]}-${pad2(Number(shortYearMatch[2]))}-${pad2(
      Number(shortYearMatch[3])
    )}`;
  }

  // MM/DD, MM-DD, MM.DD, M월 D일
  const mdMatch = raw.match(/^(\d{1,2})[.\-/월\s]+(\d{1,2})일?$/);
  if (mdMatch) {
    const m = Number(mdMatch[1]);
    const d = Number(mdMatch[2]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${defaultYear}-${pad2(m)}-${pad2(d)}`;
    }
  }

  return getTodayDateStr();
}

function parsePositiveInt(cell: unknown): number {
  if (typeof cell === 'number') {
    return isFinite(cell) ? Math.round(cell) : 0;
  }
  const cleaned = String(cell ?? '')
    .replace(/,/g, '')
    .replace(/[^0-9.-]/g, '')
    .trim();
  if (!cleaned) return 0;
  const num = Math.round(Number(cleaned));
  return isFinite(num) && num > 0 ? num : 0;
}

function findMatchingItem(
  rawName: string,
  rawSpec: string,
  items: InventoryItem[]
): InventoryItem | null {
  const candidates = items.filter((i) => i.active && i.kind !== 'FINAL');
  const nName = normKey(rawName);
  const nSpec = normKey(rawSpec);
  const nCombined = normKey(`${rawName} ${rawSpec}`);

  if (!nName) return null;

  // 1. 이름 + 규격 정확 일치
  if (nSpec) {
    const exactBoth = candidates.find(
      (i) => normKey(i.name) === nName && normKey(i.specification) === nSpec
    );
    if (exactBoth) return exactBoth;
  }

  // 2. 이름 정확 일치
  const exactName = candidates.find((i) => normKey(i.name) === nName);
  if (exactName) return exactName;

  // 3. 이름+규격 결합 일치 (예: 엑셀 자재명 칸에 '헥사 볼트 M10×40L' / '철파이프 520L'로 적힌 경우)
  const combinedMatch = candidates.find(
    (i) =>
      normKey(`${i.name}${i.specification}`) === nName ||
      normKey(`${i.name}${i.specification}`) === nCombined
  );
  if (combinedMatch) return combinedMatch;

  // 4. 등록된 자재의 정확한 표기 변형(동의어)만 매칭 — 미등록 다른 자재는 절대 오매칭하지 않음
  if (nName === '헥사볼트' || nName === 'hexbolt') {
    const bolt = candidates.find(
      (i) => i.id === 'item_bolt' || normKey(i.name) === '헥사볼트'
    );
    if (bolt) return bolt;
  }

  if (nName === '플랜지너트' || nName === 'flangenut') {
    const nut = candidates.find(
      (i) => i.id === 'item_nut' || normKey(i.name) === '플랜지너트'
    );
    if (nut) return nut;
  }

  if (
    (nName === '철파이프520l' ||
      nName === '철파이프520' ||
      nName === '스틸파이프520l' ||
      nName === 'steelpipe520l') ||
    ((nName === '철파이프' || nName === 'steelpipe' || nName === '스틸파이프') &&
      nSpec.includes('520'))
  ) {
    const p520 = candidates.find(
      (i) =>
        i.id === 'item_pipe_520' ||
        (normKey(i.name).includes('파이프') && normKey(`${i.name}${i.specification}`).includes('520'))
    );
    if (p520) return p520;
  }

  if (
    (nName === '철파이프420l' ||
      nName === '철파이프420' ||
      nName === '스틸파이프420l' ||
      nName === 'steelpipe420l') ||
    ((nName === '철파이프' || nName === 'steelpipe' || nName === '스틸파이프') &&
      nSpec.includes('420'))
  ) {
    const p420 = candidates.find(
      (i) =>
        i.id === 'item_pipe_420' ||
        (normKey(i.name).includes('파이프') && normKey(`${i.name}${i.specification}`).includes('420'))
    );
    if (p420) return p420;
  }

  if (nName === '락링' || nName === '록링' || nName === 'lockring') {
    const lr = candidates.find((i) => i.id === 'item_lockring' || normKey(i.name) === '락링');
    if (lr) return lr;
  }

  if (nName === '하부베이스') {
    const base = candidates.find(
      (i) => i.id === 'item_base' || normKey(i.name) === '하부베이스'
    );
    if (base) return base;
  }

  if (nName === '150x250클램프') {
    const clamp = candidates.find(
      (i) => i.id === 'item_clamp' || normKey(i.name) === '150x250클램프'
    );
    if (clamp) return clamp;
  }

  return null;
}

interface ColumnMap {
  headerRowIdx: number;
  dateCol: number;
  nameCol: number;
  specCol: number;
  unitCol: number;
  qtyCol: number;
  supplierCol: number;
  workerCol: number;
  noteCol: number;
}

function detectHeaderColumns(rows: unknown[][]): ColumnMap | null {
  const limit = Math.min(rows.length, 20);
  for (let r = 0; r < limit; r++) {
    const row = rows[r];
    if (!Array.isArray(row)) continue;

    let dateCol = -1;
    let nameCol = -1;
    let specCol = -1;
    let unitCol = -1;
    let qtyCol = -1;
    let supplierCol = -1;
    let workerCol = -1;
    let noteCol = -1;

    row.forEach((cell, idx) => {
      const h = String(cell ?? '')
        .replace(/\s+/g, '')
        .toLowerCase();
      if (!h) return;

      if (
        dateCol === -1 &&
        (h.includes('입고일') || h === '일자' || h === '날짜' || h.includes('date'))
      ) {
        dateCol = idx;
      } else if (
        nameCol === -1 &&
        (h.includes('자재명') ||
          h.includes('품목명') ||
          h.includes('품명') ||
          h === '자재' ||
          h === '품목' ||
          h === 'item' ||
          h === 'name')
      ) {
        nameCol = idx;
      } else if (
        specCol === -1 &&
        (h.includes('규격') || h.includes('사이즈') || h.includes('spec') || h.includes('치수'))
      ) {
        specCol = idx;
      } else if (unitCol === -1 && (h === '단위' || h === 'unit')) {
        unitCol = idx;
      } else if (
        qtyCol === -1 &&
        (h.includes('입고수량') ||
          h.includes('입고량') ||
          h === '수량' ||
          h.includes('qty') ||
          h.includes('quantity'))
      ) {
        qtyCol = idx;
      } else if (
        supplierCol === -1 &&
        (h.includes('공급업체') ||
          h.includes('거래처') ||
          h.includes('납품처') ||
          h.includes('업체') ||
          h.includes('supplier') ||
          h.includes('vendor'))
      ) {
        supplierCol = idx;
      } else if (
        workerCol === -1 &&
        (h.includes('담당자') ||
          h.includes('작업자') ||
          h.includes('입고자') ||
          h.includes('작성자') ||
          h.includes('worker'))
      ) {
        workerCol = idx;
      } else if (
        noteCol === -1 &&
        (h.includes('비고') ||
          h.includes('메모') ||
          h.includes('적요') ||
          h.includes('참고') ||
          h.includes('note') ||
          h.includes('remark'))
      ) {
        noteCol = idx;
      }
    });

    if (nameCol !== -1 && qtyCol !== -1) {
      return {
        headerRowIdx: r,
        dateCol,
        nameCol,
        specCol,
        unitCol,
        qtyCol,
        supplierCol,
        workerCol,
        noteCol,
      };
    }
  }
  return null;
}

export async function parseReceiptsFromExcelFile(
  file: File,
  state: ErpAppState
): Promise<ParseReceiptExcelResult> {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: 'array', cellDates: false });

  if (!wb.SheetNames.length) {
    return {
      sheetName: '',
      totalRows: 0,
      newRows: [],
      duplicateRows: [],
      unregisteredRows: [],
      skippedInvalidCount: 0,
      allRows: [],
      error: '엑셀 파일에 시트가 없습니다.',
    };
  }

  // '입고' 이름이 포함된 시트를 우선 검색, 없으면 인식 가능한 헤더가 있는 첫 시트 선택
  const orderedSheetNames = [
    ...wb.SheetNames.filter((s) => s.includes('입고')),
    ...wb.SheetNames.filter((s) => !s.includes('입고')),
  ];

  let chosenSheetName = wb.SheetNames[0];
  let chosenRows: unknown[][] = [];
  let colMap: ColumnMap | null = null;

  for (const sName of orderedSheetNames) {
    const ws = wb.Sheets[sName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' });
    const detected = detectHeaderColumns(rows);
    if (detected) {
      chosenSheetName = sName;
      chosenRows = rows;
      colMap = detected;
      break;
    }
  }

  if (!colMap) {
    return {
      sheetName: chosenSheetName,
      totalRows: 0,
      newRows: [],
      duplicateRows: [],
      unregisteredRows: [],
      skippedInvalidCount: 0,
      allRows: [],
      error:
        '엑셀에서 [자재명(품명)]과 [입고수량(수량)] 열을 찾지 못했습니다. 첫 행 근처에 열 제목을 포함해 주세요.',
    };
  }

  const defaultYear = new Date().getFullYear();

  // 기존 입고 이력을 멀티셋(건수 카운트)으로 구축: 같은 날짜 + 같은 자재 + 같은 수량은 기존 건수만큼 건너뜀
  const existingCounts = new Map<string, number>();
  state.receiptRecords.forEach((rec) => {
    const keyById = `${rec.receiptDate}__${rec.itemId}__${rec.quantity}`;
    existingCounts.set(keyById, (existingCounts.get(keyById) || 0) + 1);
  });

  const allRows: ParsedReceiptImportRow[] = [];
  const newRows: ParsedReceiptImportRow[] = [];
  const duplicateRows: ParsedReceiptImportRow[] = [];
  const unregisteredRows: ParsedReceiptImportRow[] = [];
  let skippedInvalidCount = 0;

  for (let r = colMap.headerRowIdx + 1; r < chosenRows.length; r++) {
    const row = chosenRows[r];
    if (!Array.isArray(row)) continue;

    const rawNameCell = String(row[colMap.nameCol] ?? '').trim();
    const rawDateCell = colMap.dateCol !== -1 ? String(row[colMap.dateCol] ?? '').trim() : '';

    // 빈 행 또는 합계/총계 행 건너뛰기
    if (!rawNameCell && !rawDateCell) continue;
    const summaryCheck = `${rawDateCell}${rawNameCell}`.replace(/\s+/g, '');
    if (
      summaryCheck.startsWith('합계') ||
      summaryCheck.startsWith('총계') ||
      summaryCheck.startsWith('소계') ||
      summaryCheck.toLowerCase().startsWith('total')
    ) {
      continue;
    }

    if (!rawNameCell) {
      skippedInvalidCount += 1;
      continue;
    }

    const quantity = parsePositiveInt(row[colMap.qtyCol]);
    if (quantity <= 0) {
      skippedInvalidCount += 1;
      continue;
    }

    const rawSpec = colMap.specCol !== -1 ? String(row[colMap.specCol] ?? '').trim() : '';
    const rawUnit = colMap.unitCol !== -1 ? String(row[colMap.unitCol] ?? '').trim() : '';
    const supplier =
      colMap.supplierCol !== -1 ? String(row[colMap.supplierCol] ?? '').trim() : '';
    const worker = colMap.workerCol !== -1 ? String(row[colMap.workerCol] ?? '').trim() : '';
    const note = colMap.noteCol !== -1 ? String(row[colMap.noteCol] ?? '').trim() : '';

    const receiptDate =
      colMap.dateCol !== -1 ? parseExcelDate(row[colMap.dateCol], defaultYear) : getTodayDateStr();

    // 자재명 '육각볼트' -> '헥사 볼트' 자동 변환
    const resolvedInputName = normalizeBoltText(rawNameCell);
    const matchedItem = findMatchingItem(resolvedInputName, rawSpec, state.items);

    const resolvedName = matchedItem ? matchedItem.name : resolvedInputName;
    const specification = matchedItem
      ? matchedItem.specification || rawSpec || '-'
      : rawSpec || '-';
    const unit = matchedItem ? matchedItem.unit : rawUnit || 'EA';

    let status: ImportedReceiptRowStatus;
    if (!matchedItem) {
      // 등록되지 않은 자재는 입고 대상에서 제외
      status = 'UNREGISTERED';
    } else {
      const dedupeKey = `${receiptDate}__${matchedItem.id}__${quantity}`;
      const existingCount = existingCounts.get(dedupeKey) || 0;
      if (existingCount > 0) {
        existingCounts.set(dedupeKey, existingCount - 1);
        status = 'DUPLICATE';
      } else {
        status = 'NEW';
      }
    }

    const parsedRow: ParsedReceiptImportRow = {
      rowIndex: r + 1,
      receiptDate,
      rawName: rawNameCell,
      resolvedName,
      specification,
      unit,
      quantity,
      supplier: supplier === '-' ? '' : supplier,
      worker: worker || '현장 관리자',
      note: note === '-' ? '' : note,
      matchedItem,
      status,
    };

    allRows.push(parsedRow);
    if (status === 'NEW') {
      newRows.push(parsedRow);
    } else if (status === 'DUPLICATE') {
      duplicateRows.push(parsedRow);
    } else {
      unregisteredRows.push(parsedRow);
    }
  }

  return {
    sheetName: chosenSheetName,
    totalRows: allRows.length,
    newRows,
    duplicateRows,
    unregisteredRows,
    skippedInvalidCount,
    allRows,
  };
}

export function downloadReceiptImportTemplate(): void {
  const rows = [
    ['입고일', '자재명', '규격', '단위', '입고수량', '공급업체', '담당자', '비고'],
    [getTodayDateStr(), '헥사 볼트', 'M10×40L', 'EA', 5000, '다인철강', '현장 관리자', '예시 행 (수정 후 사용)'],
    [getTodayDateStr(), '플랜지너트', 'M10×17', 'EA', 5000, '다인철강', '현장 관리자', ''],
  ];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [
    { wch: 14 },
    { wch: 18 },
    { wch: 14 },
    { wch: 8 },
    { wch: 12 },
    { wch: 16 },
    { wch: 14 },
    { wch: 24 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, '자재입고양식');
  XLSX.writeFile(wb, `DAIN_자재입고_업로드양식.xlsx`);
}
