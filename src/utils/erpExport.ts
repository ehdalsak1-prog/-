import * as XLSX from 'xlsx';
import { ErpAppState } from '../types/erp';
import {
  calculateDashboardSummary,
  calculatePurchaseRequirements,
  getTodayDateStr,
} from './erpCalculator';

export type ExportDatasetType =
  | 'ALL'
  | 'PRODUCTION'
  | 'RECEIPTS'
  | 'INVENTORY'
  | 'LEDGER'
  | 'PURCHASE'
  | 'PLAN'
  | 'BOM';

const TX_TYPE_LABELS: Record<string, string> = {
  RECEIPT: '자재 입고',
  PRODUCTION_USE: '생산 사용',
  PRODUCTION_OUTPUT: '생산 완료',
  PRODUCTION_CANCEL: '생산 취소',
  ADJUSTMENT: '재고 조정',
};

const KIND_LABELS: Record<string, string> = {
  RAW: '원자재',
  INTERMEDIATE: '중간제품',
  FINAL: '완제품',
};

function buildProductionSheet(state: ErpAppState) {
  const rows: (string | number)[][] = [
    ['[DAIN 40A POST 생산 실적 내역]'],
    ['생산일자', '제품명', '생산수량(EA)', '작업자', '담당자', '소모 자재 내역', '비고'],
  ];
  const sorted = [...state.productionRecords].sort((a, b) =>
    b.productionDate.localeCompare(a.productionDate)
  );
  let sum = 0;
  sorted.forEach((r) => {
    sum += r.quantity;
    const consumedStr = r.consumedItems
      .map((c) => `${c.itemName} ${c.quantity.toLocaleString()}${c.unit}`)
      .join(', ');
    rows.push([
      r.productionDate,
      r.productName,
      r.quantity,
      r.worker,
      r.manager,
      consumedStr || '-',
      r.note || '-',
    ]);
  });
  rows.push(['합계', `${sorted.length}건`, sum, '', '', '', '']);
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [
    { wch: 14 },
    { wch: 20 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 40 },
    { wch: 28 },
  ];
  return ws;
}

function buildReceiptsSheet(state: ErpAppState) {
  const rows: (string | number)[][] = [
    ['[DAIN 40A POST 자재 입고 내역]'],
    ['입고일', '자재명', '규격', '단위', '입고수량', '공급업체', '담당자', '비고'],
  ];
  const sorted = [...state.receiptRecords].sort((a, b) =>
    b.receiptDate.localeCompare(a.receiptDate)
  );
  let sum = 0;
  sorted.forEach((r) => {
    sum += r.quantity;
    rows.push([
      r.receiptDate,
      r.itemName,
      r.specification,
      r.unit,
      r.quantity,
      r.supplier,
      r.worker,
      r.note || '-',
    ]);
  });
  rows.push(['합계', `${sorted.length}건`, '', '', sum, '', '', '']);
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [
    { wch: 14 },
    { wch: 18 },
    { wch: 14 },
    { wch: 8 },
    { wch: 14 },
    { wch: 18 },
    { wch: 14 },
    { wch: 28 },
  ];
  return ws;
}

function buildInventorySheet(state: ErpAppState) {
  const rows: (string | number)[][] = [
    ['[DAIN 40A POST 현재 재고 현황]'],
    ['구분', '자재명', '규격', '단위', '현재 재고', '입고 누계', '사용 누계', '조정 누계', '최소 재고', '상태', '비고'],
  ];
  state.items.forEach((i) => {
    const status =
      i.currentStock <= 0
        ? '부족'
        : i.currentStock < i.minimumStock
        ? '주의'
        : '정상';
    rows.push([
      KIND_LABELS[i.kind] || i.kind,
      i.name,
      i.specification,
      i.unit,
      i.currentStock,
      i.totalInbound,
      i.totalUsed,
      i.totalAdjusted,
      i.minimumStock,
      status,
      i.notes || '-',
    ]);
  });
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [
    { wch: 10 },
    { wch: 20 },
    { wch: 14 },
    { wch: 8 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 12 },
    { wch: 12 },
    { wch: 10 },
    { wch: 32 },
  ];
  return ws;
}

function buildLedgerSheet(state: ErpAppState) {
  const rows: (string | number)[][] = [
    ['[DAIN 40A POST 재고 수불부]'],
    ['날짜', '품목명', '구분', '입고(+)', '사용/차감(-)', '변동후 현재고', '작업자', '비고'],
  ];
  state.transactions.forEach((t) => {
    rows.push([
      t.transactionDate,
      t.itemName,
      TX_TYPE_LABELS[t.transactionType] || t.transactionType,
      t.quantityChange > 0 ? t.quantityChange : '-',
      t.quantityChange < 0 ? Math.abs(t.quantityChange) : '-',
      t.balanceAfter,
      t.worker,
      t.note || '-',
    ]);
  });
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [
    { wch: 14 },
    { wch: 22 },
    { wch: 14 },
    { wch: 12 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 36 },
  ];
  return ws;
}

function buildPurchaseSheet(state: ErpAppState) {
  const reqs = calculatePurchaseRequirements(state);
  const rows: (string | number)[][] = [
    ['[DAIN 40A POST 자재 구매 필요량 산출표]'],
    [
      '구분',
      '자재명',
      '규격',
      '단위',
      '현재 재고',
      '전체 목표 총필요량',
      '총목표 기준 추가필요',
      '잔여생산 실소요량',
      '잔여생산 기준 추가구매',
      '상태',
    ],
  ];
  reqs.forEach((r) => {
    const statusLabel =
      r.status === 'SHORTAGE' ? '부족' : r.status === 'WARNING' ? '주의' : '충분';
    rows.push([
      KIND_LABELS[r.item.kind] || r.item.kind,
      r.item.name,
      r.item.specification,
      r.item.unit,
      r.currentStock,
      r.grossTargetNeed,
      r.grossPurchaseShortage,
      r.netRemainingNeed,
      r.netPurchaseShortage,
      statusLabel,
    ]);
  });
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [
    { wch: 10 },
    { wch: 20 },
    { wch: 14 },
    { wch: 8 },
    { wch: 14 },
    { wch: 18 },
    { wch: 18 },
    { wch: 18 },
    { wch: 20 },
    { wch: 10 },
  ];
  return ws;
}

function buildPlanSheet(state: ErpAppState) {
  const summary = calculateDashboardSummary(state);
  const allStats = [...summary.finalProductStats, ...summary.intermediateProductStats];
  const rows: (string | number)[][] = [
    ['[DAIN 40A POST 생산 계획 및 달성 현황]'],
    ['구분', '제품명', '목표 수량', '완료 수량', '잔여 수량', '진행률(%)', '현 재고 생산가능'],
  ];
  allStats.forEach((s) => {
    rows.push([
      s.product.category === 'FINAL' ? '완제품' : '중간제품',
      s.product.productName,
      s.product.targetQuantity,
      s.completedQty,
      s.remainingQty,
      Number(s.progressPercent.toFixed(2)),
      s.producibleQty,
    ]);
  });
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [
    { wch: 12 },
    { wch: 22 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 12 },
    { wch: 18 },
  ];
  return ws;
}

function buildBomSheet(state: ErpAppState) {
  const rows: (string | number)[][] = [
    ['[DAIN 40A POST 제품별 BOM 기준표]'],
    ['제품 구분', '제품명', '소요 자재명', '자재 규격', '1EA당 소요량', '단위'],
  ];
  state.bom.forEach((b) => {
    const prod = state.products.find((p) => p.id === b.productId);
    const mat = state.items.find((i) => i.id === b.materialItemId);
    rows.push([
      prod?.category === 'FINAL' ? '완제품' : '중간제품',
      prod?.productName || '-',
      mat?.name || '-',
      mat?.specification || '-',
      b.quantity,
      mat?.unit || 'EA',
    ]);
  });
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [
    { wch: 12 },
    { wch: 20 },
    { wch: 20 },
    { wch: 14 },
    { wch: 14 },
    { wch: 8 },
  ];
  return ws;
}

export function exportErpExcel(state: ErpAppState, type: ExportDatasetType): void {
  const wb = XLSX.utils.book_new();
  const dateStr = getTodayDateStr();

  const labelMap: Record<ExportDatasetType, string> = {
    ALL: '통합현황',
    PRODUCTION: '생산실적',
    RECEIPTS: '입고내역',
    INVENTORY: '재고현황',
    LEDGER: '재고수불부',
    PURCHASE: '구매필요량',
    PLAN: '생산계획',
    BOM: 'BOM기준표',
  };

  if (type === 'ALL') {
    XLSX.utils.book_append_sheet(wb, buildPlanSheet(state), '생산계획');
    XLSX.utils.book_append_sheet(wb, buildProductionSheet(state), '생산실적');
    XLSX.utils.book_append_sheet(wb, buildInventorySheet(state), '재고현황');
    XLSX.utils.book_append_sheet(wb, buildPurchaseSheet(state), '구매필요량');
    XLSX.utils.book_append_sheet(wb, buildReceiptsSheet(state), '입고내역');
    XLSX.utils.book_append_sheet(wb, buildLedgerSheet(state), '재고수불부');
    XLSX.utils.book_append_sheet(wb, buildBomSheet(state), 'BOM기준표');
  } else if (type === 'PRODUCTION') {
    XLSX.utils.book_append_sheet(wb, buildProductionSheet(state), '생산실적');
  } else if (type === 'RECEIPTS') {
    XLSX.utils.book_append_sheet(wb, buildReceiptsSheet(state), '입고내역');
  } else if (type === 'INVENTORY') {
    XLSX.utils.book_append_sheet(wb, buildInventorySheet(state), '재고현황');
  } else if (type === 'LEDGER') {
    XLSX.utils.book_append_sheet(wb, buildLedgerSheet(state), '재고수불부');
  } else if (type === 'PURCHASE') {
    XLSX.utils.book_append_sheet(wb, buildPurchaseSheet(state), '구매필요량');
  } else if (type === 'PLAN') {
    XLSX.utils.book_append_sheet(wb, buildPlanSheet(state), '생산계획');
  } else if (type === 'BOM') {
    XLSX.utils.book_append_sheet(wb, buildBomSheet(state), 'BOM기준표');
  }

  const fileName = `DAIN_40A_POST_${labelMap[type]}_${dateStr}.xlsx`;
  XLSX.writeFile(wb, fileName);
}
