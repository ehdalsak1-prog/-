import ExcelJS from 'exceljs';
import { MaterialItem, MaterialSheet, getTotalConvertedQty } from '../App';
import { aggregateMaterialItems } from './itemAggregation';
import { OFFICE_SUPPLIES_SHEET_ID } from './officeSuppliesSeed';

interface ExportWorkbookOptions {
  sheets: MaterialSheet[];
  activeTabId: string;
  siteName: string;
  yonginAddress: string;
  favoritePinnedKeys?: string[];
  favoriteMutedAutoKeys?: string[];
}

function sanitizeSheetName(rawName: string, fallbackIndex: number, usedNames: Set<string>): string {
  let cleaned = rawName.replace(/[\\/?*[\]:]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) {
    cleaned = `시트${fallbackIndex + 1}`;
  }
  if (cleaned.length > 28) {
    cleaned = cleaned.slice(0, 28).trim();
  }

  let candidate = cleaned;
  let suffix = 2;
  while (usedNames.has(candidate)) {
    const base = cleaned.slice(0, 25);
    candidate = `${base}(${suffix})`;
    suffix += 1;
  }
  usedNames.add(candidate);
  return candidate;
}

function estimateTextWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    width += ch.charCodeAt(0) > 127 ? 2.15 : 1.1;
  }
  return Math.ceil(width);
}

/**
 * Formats numbers cleanly WITHOUT a trailing decimal dot on whole numbers
 * (e.g., 630 -> '630 EA', 3780 -> '3,780 EA', 2.5 -> '2.5 EA')
 */
function buildNumFmt(val: number, unitLabel?: string): string {
  const base = Number.isInteger(val) ? '#,##0' : '#,##0.###';
  if (!unitLabel) return base;
  const safeUnit = unitLabel.replace(/"/g, '').trim();
  return safeUnit ? `${base}" ${safeUnit}"` : base;
}

/**
 * Resolves the Row 2 Right subtitle text matching the user's Excel sheet specification:
 * - Relocation sheets (e.g. '청주사업부 → 용인사업부 이전'): empty string ('')
 * - Delivery / general sheets (e.g. '고안리공장 납품 LIST'): '신규 발주 자재 반입 관리  |  출력일: YYYY-MM-DD'
 */
function resolveRow2RightMetaText(titleLabel: string, siteName: string, todayStr: string): string {
  if (titleLabel.includes('이전')) {
    return '';
  }
  const trimmedSite = (siteName || '').trim();
  const normalizedLabel =
    !trimmedSite || trimmedSite === '용인공장 이전 및 신규 발주 자재 반입 관리'
      ? '신규 발주 자재 반입 관리'
      : trimmedSite;
  return `${normalizedLabel}  |  출력일: ${todayStr}`;
}

interface RowEntry {
  sheetName: string;
  item: MaterialItem;
}

function populateLedgerWorksheet(
  worksheet: ExcelJS.Worksheet,
  titleLabel: string,
  entries: RowEntry[],
  includeSheetColumn: boolean,
  siteName: string,
  yonginAddress: string
) {
  // Clean filterable ledger table matching user's Excel specification + 구매처 column:
  // Single sheet (8 cols A..H):
  //   [No. | 반입일자 | 구매처 | 자재 품목명 | 규격 / 사양 | 반입 수량 | 단위 | 비고]
  // Integrated sheet (9 cols A..I):
  //   [No. | 시트 구분 | 반입일자 | 구매처 | 자재 품목명 | 규격 / 사양 | 반입 수량 | 단위 | 비고]
  const totalCols = includeSheetColumn ? 9 : 8;
  const lastColLetter = includeSheetColumn ? 'I' : 'H';
  const todayStr = new Date().toISOString().split('T')[0];

  worksheet.pageSetup = {
    paperSize: 9, // A4
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    horizontalCentered: true,
    margins: {
      left: 0.35,
      right: 0.35,
      top: 0.45,
      bottom: 0.45,
      header: 0.2,
      footer: 0.2,
    },
  };

  // ================= ROW 1: Document Title =================
  worksheet.mergeCells(`A1:${lastColLetter}1`);
  const titleRow = worksheet.getRow(1);
  titleRow.height = 38;
  const titleCell = worksheet.getCell('A1');
  titleCell.value = `(주)다인_용인사업부 _반입 반출 대장  [${titleLabel}]`;
  titleCell.font = {
    name: '맑은 고딕',
    size: 15,
    bold: true,
    color: { argb: 'FF0F172A' },
  };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  titleCell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFF1F5F9' },
  };

  // ================= ROW 2: Address (Left) & Sheet Management Note / Print Date (Right) =================
  // Split sits cleanly between '규격 / 사양' and '반입 수량' matching user's Excel screenshots
  const splitLeftEnd = includeSheetColumn ? 'F' : 'E';
  const splitRightStart = includeSheetColumn ? 'G' : 'F';
  worksheet.mergeCells(`A2:${splitLeftEnd}2`);
  worksheet.mergeCells(`${splitRightStart}2:${lastColLetter}2`);
  const infoRow = worksheet.getRow(2);
  infoRow.height = 24;

  const addrCell = worksheet.getCell('A2');
  addrCell.value = `용인사업부 주소 : ${yonginAddress}`;
  addrCell.font = {
    name: '맑은 고딕',
    size: 10,
    bold: true,
    color: { argb: 'FF1E3A8A' },
  };
  addrCell.alignment = { horizontal: 'center', vertical: 'middle' };
  addrCell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFFFFFFF' },
  };

  const metaCell = worksheet.getCell(`${splitRightStart}2`);
  metaCell.value = resolveRow2RightMetaText(titleLabel, siteName, todayStr);
  metaCell.font = {
    name: '맑은 고딕',
    size: 10,
    color: { argb: 'FF475569' },
  };
  metaCell.alignment = { horizontal: 'center', vertical: 'middle' };
  metaCell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFFFFFFF' },
  };

  // Borders around top header box (Rows 1–2)
  for (let r = 1; r <= 2; r++) {
    for (let c = 1; c <= totalCols; c++) {
      const cell = worksheet.getRow(r).getCell(c);
      cell.border = {
        top: {
          style: r === 1 ? 'medium' : 'thin',
          color: { argb: r === 1 ? 'FF1E293B' : 'FFCBD5E1' },
        },
        bottom: {
          style: r === 2 ? 'medium' : 'thin',
          color: { argb: r === 2 ? 'FF1E293B' : 'FFCBD5E1' },
        },
        left: {
          style: c === 1 ? 'medium' : 'thin',
          color: { argb: c === 1 ? 'FF1E293B' : 'FFCBD5E1' },
        },
        right: {
          style: c === totalCols ? 'medium' : 'thin',
          color: { argb: c === totalCols ? 'FF1E293B' : 'FFCBD5E1' },
        },
      };
    }
  }

  // ================= ROW 3: Clean Unbordered Spacer =================
  worksheet.getRow(3).height = 10;

  // ================= ROW 4: Dark Navy Table Header =================
  const headers = includeSheetColumn
    ? [
        'No.',
        '시트 구분',
        '반입일자',
        '구매처',
        '자재 품목명',
        '규격 / 사양',
        '반입 수량',
        '단위',
        '비고',
      ]
    : [
        'No.',
        '반입일자',
        '구매처',
        '자재 품목명',
        '규격 / 사양',
        '반입 수량',
        '단위',
        '비고',
      ];

  const headerRowIndex = 4;
  const headerRow = worksheet.getRow(headerRowIndex);
  headerRow.values = headers;
  headerRow.height = 28;

  headerRow.eachCell((cell, colNumber) => {
    cell.font = {
      name: '맑은 고딕',
      size: 10,
      bold: true,
      color: { argb: 'FFFFFFFF' },
    };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1E293B' },
    };
    cell.alignment = {
      horizontal: 'center',
      vertical: 'middle',
      wrapText: true,
    };
    cell.border = {
      top: { style: 'medium', color: { argb: 'FF0F172A' } },
      bottom: { style: 'medium', color: { argb: 'FF0F172A' } },
      left: {
        style: colNumber === 1 ? 'medium' : 'thin',
        color: { argb: colNumber === 1 ? 'FF0F172A' : 'FF475569' },
      },
      right: {
        style: colNumber === totalCols ? 'medium' : 'thin',
        color: { argb: colNumber === totalCols ? 'FF0F172A' : 'FF475569' },
      },
    };
  });

  // Freeze top 4 rows so table header stays visible when scrolling
  worksheet.views = [{ state: 'frozen', xSplit: 0, ySplit: headerRowIndex }];

  const colIdx = {
    no: 1,
    sheet: includeSheetColumn ? 2 : -1,
    date: includeSheetColumn ? 3 : 2,
    supplier: includeSheetColumn ? 4 : 3,
    name: includeSheetColumn ? 5 : 4,
    spec: includeSheetColumn ? 6 : 5,
    qty: includeSheetColumn ? 7 : 6,
    unit: includeSheetColumn ? 8 : 7,
    remarks: includeSheetColumn ? 9 : 8,
  };

  // Column proportions matched to user's Excel screenshots + 구매처 column
  const minColWidths = headers.map((h, idx) => {
    const headerW = estimateTextWidth(h) + 4;
    const defaults = includeSheetColumn
      ? [9, 18, 15, 17, 34, 18, 22, 11, 22]
      : [9, 15, 17, 34, 18, 22, 11, 22];
    return Math.max(headerW, defaults[idx]);
  });
  const maxColWidths = [...minColWidths];

  // ================= DATA ROWS (Pure Ledger Table — AutoFilter & Sort Safe) =================
  const firstDataRowIndex = headerRowIndex + 1;

  if (entries.length === 0) {
    const emptyRow = worksheet.getRow(firstDataRowIndex);
    emptyRow.height = 28;
    worksheet.mergeCells(`A${firstDataRowIndex}:${lastColLetter}${firstDataRowIndex}`);
    const emptyCell = emptyRow.getCell(1);
    emptyCell.value = '등록된 자재 내역이 없습니다.';
    emptyCell.font = { name: '맑은 고딕', size: 10, italic: true, color: { argb: 'FF94A3B8' } };
    emptyCell.alignment = { horizontal: 'center', vertical: 'middle' };
    for (let c = 1; c <= totalCols; c++) {
      emptyRow.getCell(c).border = {
        top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        bottom: { style: 'medium', color: { argb: 'FF1E293B' } },
        left: {
          style: c === 1 ? 'medium' : 'thin',
          color: { argb: c === 1 ? 'FF1E293B' : 'FFCBD5E1' },
        },
        right: {
          style: c === totalCols ? 'medium' : 'thin',
          color: { argb: c === totalCols ? 'FF1E293B' : 'FFCBD5E1' },
        },
      };
    }
  } else {
    entries.forEach(({ item, sheetName }, idx) => {
      const rIdx = firstDataRowIndex + idx;
      const row = worksheet.getRow(rIdx);
      row.height = 25;

      const supplierText =
        item.supplier && item.supplier.trim() && item.supplier.trim() !== '-'
          ? item.supplier.trim()
          : '-';
      const specText = item.spec && item.spec !== '-' ? item.spec : '-';
      const remarksText = item.remarks && item.remarks.trim() ? item.remarks.trim() : '-';
      const hasQty = item.quantity > 0;
      const mainUnitLabel = hasQty
        ? (item.unit || 'EA').trim()
        : item.unit && item.unit !== '-'
        ? item.unit.trim()
        : '-';

      row.getCell(colIdx.no).value = idx + 1;
      if (includeSheetColumn) {
        row.getCell(colIdx.sheet).value = sheetName;
      }
      row.getCell(colIdx.date).value = item.date || '';
      row.getCell(colIdx.supplier).value = supplierText;
      row.getCell(colIdx.name).value = item.name;
      row.getCell(colIdx.spec).value = specText;
      row.getCell(colIdx.qty).value = hasQty ? item.quantity : '-';
      row.getCell(colIdx.unit).value = mainUnitLabel;
      row.getCell(colIdx.remarks).value = remarksText;

      const isEven = idx % 2 === 1;
      const isLastRow = idx === entries.length - 1;
      const baseBg = isEven ? 'FFF8FAFC' : 'FFFFFFFF';

      for (let c = 1; c <= totalCols; c++) {
        const cell = row.getCell(c);
        cell.font = {
          name: '맑은 고딕',
          size: 10,
          color: { argb: 'FF0F172A' },
        };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: baseBg },
        };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          bottom: {
            style: isLastRow ? 'medium' : 'thin',
            color: { argb: isLastRow ? 'FF1E293B' : 'FFCBD5E1' },
          },
          left: {
            style: c === 1 ? 'medium' : 'thin',
            color: { argb: c === 1 ? 'FF1E293B' : 'FFE2E8F0' },
          },
          right: {
            style: c === totalCols ? 'medium' : 'thin',
            color: { argb: c === totalCols ? 'FF1E293B' : 'FFE2E8F0' },
          },
        };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      }

      if (includeSheetColumn) {
        row.getCell(colIdx.sheet).alignment = { vertical: 'middle', horizontal: 'center' };
        row.getCell(colIdx.sheet).font = {
          name: '맑은 고딕',
          size: 9.5,
          bold: true,
          color: { argb: 'FF334155' },
        };
      }

      // Supplier ('구매처'): centered
      const supplierCell = row.getCell(colIdx.supplier);
      supplierCell.alignment = { vertical: 'middle', horizontal: 'center' };
      supplierCell.font = {
        name: '맑은 고딕',
        size: 10,
        color: { argb: supplierText === '-' ? 'FF64748B' : 'FF0F172A' },
      };

      // Item Name ('자재 품목명'): bold & left aligned
      const nameCell = row.getCell(colIdx.name);
      nameCell.alignment = { vertical: 'middle', horizontal: 'left' };
      nameCell.font = {
        name: '맑은 고딕',
        size: 10,
        bold: true,
        color: { argb: 'FF0F172A' },
      };

      // Spec ('규격 / 사양'): centered
      row.getCell(colIdx.spec).alignment = {
        vertical: 'middle',
        horizontal: 'center',
      };

      // Inbound Qty ('반입 수량'): centered & bold
      const qtyCell = row.getCell(colIdx.qty);
      qtyCell.alignment = { vertical: 'middle', horizontal: 'center' };
      if (hasQty) {
        qtyCell.numFmt = buildNumFmt(item.quantity);
        qtyCell.font = { name: '맑은 고딕', size: 10.5, bold: true, color: { argb: 'FF0F172A' } };
      } else {
        qtyCell.font = { name: '맑은 고딕', size: 10, color: { argb: 'FF94A3B8' } };
      }

      // Unit ('단위'): centered
      row.getCell(colIdx.unit).font = {
        name: '맑은 고딕',
        size: 10,
        color: { argb: hasQty ? 'FF334155' : 'FF94A3B8' },
      };

      row.getCell(colIdx.remarks).alignment = {
        vertical: 'middle',
        horizontal: remarksText === '-' ? 'center' : 'left',
        wrapText: true,
      };

      const textsForWidth = includeSheetColumn
        ? [
            String(idx + 1),
            sheetName,
            item.date || '',
            supplierText,
            item.name,
            specText,
            hasQty ? item.quantity.toLocaleString() : '-',
            mainUnitLabel,
            remarksText,
          ]
        : [
            String(idx + 1),
            item.date || '',
            supplierText,
            item.name,
            specText,
            hasQty ? item.quantity.toLocaleString() : '-',
            mainUnitLabel,
            remarksText,
          ];

      textsForWidth.forEach((txt, cIndex) => {
        const w = Math.min(48, estimateTextWidth(txt) + 4);
        if (w > maxColWidths[cIndex]) {
          maxColWidths[cIndex] = w;
        }
      });
    });

    const lastDataRowIndex = firstDataRowIndex + entries.length - 1;
    worksheet.autoFilter = {
      from: { row: headerRowIndex, column: 1 },
      to: { row: lastDataRowIndex, column: totalCols },
    };

    // ================= ROW: Summary Total with Live Excel Formulas =================
    const sumRowIndex = lastDataRowIndex + 1;
    const sumRow = worksheet.getRow(sumRowIndex);
    sumRow.height = 28;

    const qtyColLetter = includeSheetColumn ? 'G' : 'F';
    const nameColLetter = includeSheetColumn ? 'E' : 'D';
    const preQtyColLetter = includeSheetColumn ? 'F' : 'E';

    // Merge A to E (or F) for "합 계" label
    worksheet.mergeCells(`A${sumRowIndex}:${preQtyColLetter}${sumRowIndex}`);
    const sumLabelCell = sumRow.getCell(1);
    sumLabelCell.value = '합  계';
    sumLabelCell.font = { name: '맑은 고딕', size: 10.5, bold: true, color: { argb: 'FF0F172A' } };
    sumLabelCell.alignment = { horizontal: 'center', vertical: 'middle' };

    // Total quantity cell with =SUM(...) formula
    const totalNumericQty = entries.reduce((acc, cur) => acc + (cur.item.quantity || 0), 0);
    const sumQtyCell = sumRow.getCell(colIdx.qty);
    sumQtyCell.value = {
      formula: `SUM(${qtyColLetter}${firstDataRowIndex}:${qtyColLetter}${lastDataRowIndex})`,
      result: Math.round(totalNumericQty * 1000) / 1000,
    };
    sumQtyCell.numFmt = '#,##0.###';
    sumQtyCell.font = { name: '맑은 고딕', size: 11, bold: true, color: { argb: 'FF1E3A8A' } };
    sumQtyCell.alignment = { horizontal: 'center', vertical: 'middle' };

    // Unit cell
    const sumUnitCell = sumRow.getCell(colIdx.unit);
    sumUnitCell.value = '-';
    sumUnitCell.font = { name: '맑은 고딕', size: 10, color: { argb: 'FF64748B' } };
    sumUnitCell.alignment = { horizontal: 'center', vertical: 'middle' };

    // Remarks cell with =COUNTA(...) formula
    const sumRemarksCell = sumRow.getCell(colIdx.remarks);
    sumRemarksCell.value = {
      formula: `COUNTA(${nameColLetter}${firstDataRowIndex}:${nameColLetter}${lastDataRowIndex})`,
      result: entries.length,
    };
    sumRemarksCell.numFmt = '#,##0"건 반입"';
    sumRemarksCell.font = { name: '맑은 고딕', size: 10, bold: true, color: { argb: 'FF0F172A' } };
    sumRemarksCell.alignment = { horizontal: 'center', vertical: 'middle' };

    // Apply soft slate background and double-underline border (accounting standard)
    for (let c = 1; c <= totalCols; c++) {
      const cell = sumRow.getCell(c);
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF1F5F9' },
      };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF94A3B8' } },
        bottom: { style: 'double', color: { argb: 'FF0F172A' } },
        left: {
          style: c === 1 ? 'medium' : 'thin',
          color: { argb: c === 1 ? 'FF0F172A' : 'FFE2E8F0' },
        },
        right: {
          style: c === totalCols ? 'medium' : 'thin',
          color: { argb: c === totalCols ? 'FF0F172A' : 'FFE2E8F0' },
        },
      };
    }
  }

  maxColWidths.forEach((w, idx) => {
    worksheet.getColumn(idx + 1).width = w;
  });
}


function populateItemSummaryWorksheet(
  worksheet: ExcelJS.Worksheet,
  entries: RowEntry[],
  siteName: string,
  yonginAddress: string
) {
  const totalCols = 10;
  const lastColLetter = 'J';
  const todayStr = new Date().toISOString().split('T')[0];

  worksheet.pageSetup = {
    paperSize: 9,
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    horizontalCentered: true,
    margins: {
      left: 0.35,
      right: 0.35,
      top: 0.45,
      bottom: 0.45,
      header: 0.2,
      footer: 0.2,
    },
  };

  worksheet.mergeCells(`A1:${lastColLetter}1`);
  worksheet.getRow(1).height = 38;
  const titleCell = worksheet.getCell('A1');
  titleCell.value = `(주)다인_용인사업부 _반입 반출 대장  [품목별 합계 현황]`;
  titleCell.font = { name: '맑은 고딕', size: 15, bold: true, color: { argb: 'FF0F172A' } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };

  worksheet.mergeCells('A2:E2');
  worksheet.mergeCells('F2:J2');
  worksheet.getRow(2).height = 24;

  const addrCell = worksheet.getCell('A2');
  addrCell.value = `용인사업부 주소 : ${yonginAddress}`;
  addrCell.font = { name: '맑은 고딕', size: 10, bold: true, color: { argb: 'FF1E3A8A' } };
  addrCell.alignment = { horizontal: 'center', vertical: 'middle' };
  addrCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };

  const metaCell = worksheet.getCell('F2');
  metaCell.value = resolveRow2RightMetaText('품목별 합계 현황', siteName, todayStr);
  metaCell.font = { name: '맑은 고딕', size: 10, color: { argb: 'FF475569' } };
  metaCell.alignment = { horizontal: 'center', vertical: 'middle' };
  metaCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };

  for (let r = 1; r <= 2; r++) {
    for (let c = 1; c <= totalCols; c++) {
      worksheet.getRow(r).getCell(c).border = {
        top: { style: r === 1 ? 'medium' : 'thin', color: { argb: r === 1 ? 'FF1E293B' : 'FFCBD5E1' } },
        bottom: { style: r === 2 ? 'medium' : 'thin', color: { argb: r === 2 ? 'FF1E293B' : 'FFCBD5E1' } },
        left: { style: c === 1 ? 'medium' : 'thin', color: { argb: c === 1 ? 'FF1E293B' : 'FFCBD5E1' } },
        right: { style: c === totalCols ? 'medium' : 'thin', color: { argb: c === totalCols ? 'FF1E293B' : 'FFCBD5E1' } },
      };
    }
  }

  worksheet.getRow(3).height = 10;

  const headers = [
    'No.',
    '반입 횟수',
    '구매처',
    '자재 품목명',
    '규격 / 사양',
    '반입 수량 합계',
    '단위',
    '단위당 입수량',
    '총 수량 합계',
    '관련 시트',
  ];
  const headerRow = worksheet.getRow(4);
  headerRow.values = headers;
  headerRow.height = 28;
  headerRow.eachCell((cell, colNumber) => {
    cell.font = { name: '맑은 고딕', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = {
      top: { style: 'medium', color: { argb: 'FF0F172A' } },
      bottom: { style: 'medium', color: { argb: 'FF0F172A' } },
      left: { style: colNumber === 1 ? 'medium' : 'thin', color: { argb: colNumber === 1 ? 'FF0F172A' : 'FF475569' } },
      right: { style: colNumber === totalCols ? 'medium' : 'thin', color: { argb: colNumber === totalCols ? 'FF0F172A' : 'FF475569' } },
    };
  });

  worksheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 4 }];

  const groups = aggregateMaterialItems(entries, 'name_and_spec');
  const colWidths = [9, 13, 18, 34, 18, 22, 11, 18, 26, 22];

  if (groups.length > 0) {
    groups.forEach((group, idx) => {
      const rIdx = 5 + idx;
      const row = worksheet.getRow(rIdx);
      row.height = 25;
      const isLast = idx === groups.length - 1;
      const isRepeated = group.entryCount > 1;
      const bg = isRepeated ? 'FFF0F9FF' : idx % 2 === 1 ? 'FFF8FAFC' : 'FFFFFFFF';
      const supplierJoined = group.suppliers.length > 0 ? group.suppliers.join(', ') : '-';

      row.getCell(1).value = idx + 1;
      row.getCell(2).value = group.entryCount;
      row.getCell(3).value = supplierJoined;
      row.getCell(4).value = group.name;
      row.getCell(5).value = group.spec;
      row.getCell(6).value =
        group.singleInboundQty !== null ? group.singleInboundQty : group.inboundSummaryWithUnit;
      row.getCell(7).value = group.singleInboundUnit || '-';
      row.getCell(8).value = group.singlePackQty !== null ? group.singlePackQty : '-';
      row.getCell(9).value =
        group.singleTotalQty !== null ? group.singleTotalQty : group.totalSummaryText;
      row.getCell(10).value = group.sheetNames.join(', ') || '-';

      for (let c = 1; c <= totalCols; c++) {
        const cell = row.getCell(c);
        cell.font = { name: '맑은 고딕', size: 10, color: { argb: 'FF0F172A' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          bottom: { style: isLast ? 'medium' : 'thin', color: { argb: isLast ? 'FF1E293B' : 'FFCBD5E1' } },
          left: { style: c === 1 ? 'medium' : 'thin', color: { argb: c === 1 ? 'FF1E293B' : 'FFE2E8F0' } },
          right: { style: c === totalCols ? 'medium' : 'thin', color: { argb: c === totalCols ? 'FF1E293B' : 'FFE2E8F0' } },
        };
      }

      row.getCell(2).numFmt = '#,##0"회"';
      row.getCell(2).font = {
        name: '맑은 고딕',
        size: 10,
        bold: isRepeated,
        color: { argb: isRepeated ? 'FF1D4ED8' : 'FF475569' },
      };

      row.getCell(3).font = {
        name: '맑은 고딕',
        size: 10,
        color: { argb: supplierJoined === '-' ? 'FF64748B' : 'FF0F172A' },
      };

      row.getCell(4).alignment = { vertical: 'middle', horizontal: 'left' };
      row.getCell(4).font = { name: '맑은 고딕', size: 10, bold: true, color: { argb: 'FF0F172A' } };

      if (group.singleInboundQty !== null) {
        row.getCell(6).numFmt = buildNumFmt(group.singleInboundQty);
        row.getCell(6).font = { name: '맑은 고딕', size: 10.5, bold: true, color: { argb: 'FF0F172A' } };
      }

      if (group.singlePackQty !== null && group.singleSubUnit !== null) {
        row.getCell(8).alignment = { vertical: 'middle', horizontal: 'right', indent: 1 };
        row.getCell(8).numFmt = buildNumFmt(group.singlePackQty, group.singleSubUnit);
      }

      if (group.singleTotalQty !== null && group.singleTotalUnit !== null) {
        if (group.singlePackQty !== null && group.singlePackQty > 0) {
          row.getCell(9).value = {
            formula: `F${rIdx}*H${rIdx}`,
            result: group.singleTotalQty,
          };
        } else if (group.singleInboundQty !== null) {
          row.getCell(9).value = {
            formula: `F${rIdx}`,
            result: group.singleTotalQty,
          };
        } else {
          row.getCell(9).value = group.singleTotalQty;
        }
        row.getCell(9).alignment = { vertical: 'middle', horizontal: 'right', indent: 1 };
        row.getCell(9).numFmt = buildNumFmt(group.singleTotalQty, group.singleTotalUnit);
        row.getCell(9).font = {
          name: '맑은 고딕',
          size: 10,
          bold: true,
          color: { argb: group.hasPackConversion || isRepeated ? 'FF1D4ED8' : 'FF0F172A' },
        };
      } else if (group.totalSummaryText !== '-') {
        row.getCell(9).value = group.totalSummaryText;
        row.getCell(9).alignment = { vertical: 'middle', horizontal: 'right', indent: 1 };
        row.getCell(9).font = { name: '맑은 고딕', size: 10, bold: true, color: { argb: 'FF1D4ED8' } };
      }
    });

    const lastDataRow = 4 + groups.length;
    worksheet.autoFilter = {
      from: { row: 4, column: 1 },
      to: { row: lastDataRow, column: totalCols },
    };

    // ================= ROW: Grand Total with Live Excel Formulas =================
    const sumRowIdx = lastDataRow + 1;
    const sumRow = worksheet.getRow(sumRowIdx);
    sumRow.height = 28;

    worksheet.mergeCells(`A${sumRowIdx}`);
    worksheet.mergeCells(`C${sumRowIdx}:E${sumRowIdx}`);
    sumRow.getCell(3).value = '총  합  계';
    sumRow.getCell(3).font = { name: '맑은 고딕', size: 10.5, bold: true, color: { argb: 'FF0F172A' } };
    sumRow.getCell(3).alignment = { horizontal: 'center', vertical: 'middle' };

    // B: 반입 횟수 총합 =SUM(B5:B...)
    const totalEntryCount = groups.reduce((acc, g) => acc + g.entryCount, 0);
    const sumCountCell = sumRow.getCell(2);
    sumCountCell.value = {
      formula: `SUM(B5:B${lastDataRow})`,
      result: totalEntryCount,
    };
    sumCountCell.numFmt = '#,##0"회"';
    sumCountCell.font = { name: '맑은 고딕', size: 10.5, bold: true, color: { argb: 'FF1D4ED8' } };
    sumCountCell.alignment = { horizontal: 'center', vertical: 'middle' };

    // F: 반입 수량 총합 =SUM(F5:F...)
    const totalInboundSum = groups.reduce((acc, g) => acc + (g.singleInboundQty || 0), 0);
    const sumInboundCell = sumRow.getCell(6);
    sumInboundCell.value = {
      formula: `SUM(F5:F${lastDataRow})`,
      result: Math.round(totalInboundSum * 1000) / 1000,
    };
    sumInboundCell.numFmt = '#,##0.###';
    sumInboundCell.font = { name: '맑은 고딕', size: 11, bold: true, color: { argb: 'FF0F172A' } };
    sumInboundCell.alignment = { horizontal: 'center', vertical: 'middle' };

    // G: 단위
    sumRow.getCell(7).value = '-';
    sumRow.getCell(7).alignment = { horizontal: 'center', vertical: 'middle' };

    // H: 단위당 입수량
    sumRow.getCell(8).value = '-';
    sumRow.getCell(8).alignment = { horizontal: 'center', vertical: 'middle' };

    // I: 총 수량 총합 =SUM(I5:I...)
    const totalOverallSum = groups.reduce(
      (acc, g) => acc + (g.singleTotalQty || g.singleInboundQty || 0),
      0
    );
    const sumOverallCell = sumRow.getCell(9);
    sumOverallCell.value = {
      formula: `SUM(I5:I${lastDataRow})`,
      result: Math.round(totalOverallSum * 1000) / 1000,
    };
    sumOverallCell.numFmt = '#,##0.###';
    sumOverallCell.font = { name: '맑은 고딕', size: 11, bold: true, color: { argb: 'FF1D4ED8' } };
    sumOverallCell.alignment = { horizontal: 'right', vertical: 'middle', indent: 1 };

    // J: 품목 종류 수 =COUNTA(D5:D...)
    const sumSheetCell = sumRow.getCell(10);
    sumSheetCell.value = {
      formula: `COUNTA(D5:D${lastDataRow})`,
      result: groups.length,
    };
    sumSheetCell.numFmt = '#,##0"개 품목"';
    sumSheetCell.font = { name: '맑은 고딕', size: 10, bold: true, color: { argb: 'FF0F172A' } };
    sumSheetCell.alignment = { horizontal: 'center', vertical: 'middle' };

    for (let c = 1; c <= totalCols; c++) {
      const cell = sumRow.getCell(c);
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF1F5F9' },
      };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF94A3B8' } },
        bottom: { style: 'double', color: { argb: 'FF0F172A' } },
        left: { style: c === 1 ? 'medium' : 'thin', color: { argb: c === 1 ? 'FF0F172A' : 'FFE2E8F0' } },
        right: { style: c === totalCols ? 'medium' : 'thin', color: { argb: c === totalCols ? 'FF0F172A' : 'FFE2E8F0' } },
      };
    }
  }

  colWidths.forEach((w, i) => {
    worksheet.getColumn(i + 1).width = w;
  });

}

export async function exportStyledExcelWorkbook({
  sheets,
  activeTabId,
  siteName,
  yonginAddress,
  favoritePinnedKeys = [],
  favoriteMutedAutoKeys = [],
}: ExportWorkbookOptions): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = '(주)다인 용인사업부';
  workbook.created = new Date();
  workbook.modified = new Date();

  const usedTabNames = new Set<string>();
  let activeExcelSheetIndex = 0;

  sheets.forEach((sheet, idx) => {
    const tabName = sanitizeSheetName(sheet.name, idx, usedTabNames);
    const ws = workbook.addWorksheet(tabName);
    if (sheet.id === activeTabId) {
      activeExcelSheetIndex = idx;
    }

    const entries: RowEntry[] = sheet.items.map((item) => ({
      sheetName: sheet.name,
      item,
    }));

    populateLedgerWorksheet(ws, sheet.name, entries, false, siteName, yonginAddress);
  });

  const integratedEntries: RowEntry[] = sheets
    .filter((s) => s.id !== OFFICE_SUPPLIES_SHEET_ID && s.name.trim() !== '사무용품')
    .flatMap((s) =>
      s.items.map((item) => ({
        sheetName: s.name,
        item,
      }))
    );

  const summaryTabName = sanitizeSheetName('품목별 합계 현황', sheets.length, usedTabNames);
  const summaryWs = workbook.addWorksheet(summaryTabName);
  populateItemSummaryWorksheet(summaryWs, integratedEntries, siteName, yonginAddress);

  const allTabName = sanitizeSheetName('전체 통합 현황', sheets.length + 1, usedTabNames);
  const allWs = workbook.addWorksheet(allTabName);
  if (activeTabId === 'ALL') {
    activeExcelSheetIndex = sheets.length + 1;
  }

  populateLedgerWorksheet(allWs, '전체 통합 현황', integratedEntries, true, siteName, yonginAddress);

  const makeFavKey = (rawName: string, rawSpec?: string) => {
    const cleanName = (rawName || '').trim().replace(/\s+/g, ' ').toLowerCase();
    const cleanSpecRaw = (rawSpec || '').trim().replace(/\s+/g, ' ');
    const cleanSpec = !cleanSpecRaw || cleanSpecRaw === '-' ? '-' : cleanSpecRaw.toLowerCase();
    return `${cleanName}||${cleanSpec}`;
  };

  const integratedGroups = aggregateMaterialItems(integratedEntries, 'name_and_spec');
  const favoriteKeySet = new Set<string>(favoritePinnedKeys);
  integratedGroups.forEach((g) => {
    if (g.entryCount >= 2 && !favoriteMutedAutoKeys.includes(g.key)) {
      favoriteKeySet.add(g.key);
    }
  });

  const favoriteEntries: RowEntry[] = sheets.flatMap((s) => {
    const isOffice = s.id === OFFICE_SUPPLIES_SHEET_ID || s.name.trim() === '사무용품';
    return s.items
      .filter((item) => {
        const key = makeFavKey(item.name, item.spec);
        if (favoritePinnedKeys.includes(key)) return true;
        if (isOffice) return false;
        return favoriteKeySet.has(key);
      })
      .map((item) => ({ sheetName: s.name, item }));
  });

  const favTabName = sanitizeSheetName('통합보기 [자재]', sheets.length + 2, usedTabNames);
  const favWs = workbook.addWorksheet(favTabName);
  if (activeTabId === 'FAVORITE_MATERIALS') {
    activeExcelSheetIndex = sheets.length + 2;
  }
  populateLedgerWorksheet(favWs, '통합보기 [자재]', favoriteEntries, true, siteName, yonginAddress);

  workbook.views = [
    {
      x: 0,
      y: 0,
      width: 14000,
      height: 20000,
      firstSheet: 0,
      activeTab: activeExcelSheetIndex,
      visibility: 'visible',
    },
  ];

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

  const today = new Date().toISOString().split('T')[0];
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `(주)다인_용인사업부_반입반출대장_${today}.xlsx`;
  link.click();
  URL.revokeObjectURL(url);
}
