import type {
  ConsumedItemSnapshot,
  ErpAppState,
  InventoryAdjustment,
  InventoryItem,
  InventoryTransaction,
  ProductionRecord,
  ReceiptRecord,
} from '../types/erp.ts';

export interface ShortageDetail {
  itemId: string;
  itemName: string;
  specification: string;
  unit: string;
  requiredQty: number;
  availableStock: number;
  shortageQty: number;
}

export interface ProductionValidationResult {
  valid: boolean;
  errorMessage?: string;
  requiredList: ConsumedItemSnapshot[];
  shortages: ShortageDetail[];
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
}

/**
 * 생산 전 BOM 기반 재고 검증 (§12)
 */
export function validateProductionStock(
  state: ErpAppState,
  productId: string,
  quantity: number
): ProductionValidationResult {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return {
      valid: false,
      errorMessage: '생산 수량은 1 이상의 정수를 입력해 주세요.',
      requiredList: [],
      shortages: [],
    };
  }

  const product = state.products.find((p) => p.id === productId);
  if (!product) {
    return {
      valid: false,
      errorMessage: '선택된 제품을 찾을 수 없습니다.',
      requiredList: [],
      shortages: [],
    };
  }

  const bomEntries = state.bom.filter((b) => b.productId === productId);
  const requiredList: ConsumedItemSnapshot[] = [];
  const shortages: ShortageDetail[] = [];

  for (const entry of bomEntries) {
    const item = state.items.find((i) => i.id === entry.materialItemId);
    const reqQty = Math.round(entry.quantity * quantity);
    const avail = item ? item.currentStock : 0;

    requiredList.push({
      itemId: entry.materialItemId,
      itemName: item?.name || '알 수 없는 자재',
      specification: item?.specification || '-',
      unit: item?.unit || 'EA',
      quantity: reqQty,
    });

    if (!item || avail < reqQty) {
      shortages.push({
        itemId: entry.materialItemId,
        itemName: item?.name || '알 수 없는 자재',
        specification: item?.specification || '-',
        unit: item?.unit || 'EA',
        requiredQty: reqQty,
        availableStock: avail,
        shortageQty: reqQty - Math.max(0, avail),
      });
    }
  }

  if (shortages.length > 0) {
    return {
      valid: false,
      errorMessage: '자재 부족으로 생산할 수 없습니다.',
      requiredList,
      shortages,
    };
  }

  return {
    valid: true,
    requiredList,
    shortages: [],
  };
}

/**
 * 생산 등록 및 자재 차감 / 중간·완제품 재고 증가 / 수불부 기록 (§11, §27)
 */
export function executeRegisterProduction(
  state: ErpAppState,
  params: {
    productionDate: string;
    productId: string;
    quantity: number;
    worker: string;
    manager: string;
    note: string;
    recordId?: string;
  }
): { ok: true; nextState: ErpAppState; record: ProductionRecord } | { ok: false; validation: ProductionValidationResult } {
  const validation = validateProductionStock(state, params.productId, params.quantity);
  if (!validation.valid) {
    return { ok: false, validation };
  }

  const nowIso = new Date().toISOString();
  const product = state.products.find((p) => p.id === params.productId)!;
  const recordId = params.recordId || makeId('prod_rec');

  const newRecord: ProductionRecord = {
    id: recordId,
    productionDate: params.productionDate,
    productId: product.id,
    productName: product.productName,
    quantity: params.quantity,
    worker: params.worker.trim() || '현장 작업자',
    manager: params.manager.trim() || '현장 관리자',
    note: params.note.trim(),
    consumedItems: validation.requiredList,
    createdAt: nowIso,
  };

  const newTransactions: InventoryTransaction[] = [];
  const consumedMap = new Map<string, number>();
  validation.requiredList.forEach((c) => {
    consumedMap.set(c.itemId, (consumedMap.get(c.itemId) || 0) + c.quantity);
  });

  const updatedItems = state.items.map((item) => {
    let nextStock = item.currentStock;
    let nextInbound = item.totalInbound;
    let nextUsed = item.totalUsed;

    // 1. BOM 자재 차감
    const usedQty = consumedMap.get(item.id) || 0;
    if (usedQty > 0) {
      nextStock -= usedQty;
      nextUsed += usedQty;
      newTransactions.push({
        id: makeId('tx'),
        transactionDate: params.productionDate,
        itemId: item.id,
        itemName: `${item.name}${item.specification ? ` ${item.specification}` : ''}`,
        transactionType: 'PRODUCTION_USE',
        quantityChange: -usedQty,
        balanceAfter: nextStock,
        referenceId: recordId,
        worker: newRecord.worker,
        note: `${product.productName} ${params.quantity.toLocaleString()}EA 생산 소모`,
        createdAt: nowIso,
      });
    }

    // 2. 생산된 제품(중간재/완제품) 재고 증가
    if (item.id === product.linkedItemId) {
      nextStock += params.quantity;
      nextInbound += params.quantity;
      newTransactions.push({
        id: makeId('tx'),
        transactionDate: params.productionDate,
        itemId: item.id,
        itemName: item.name,
        transactionType: 'PRODUCTION_OUTPUT',
        quantityChange: params.quantity,
        balanceAfter: nextStock,
        referenceId: recordId,
        worker: newRecord.worker,
        note: `${product.productName} 생산 완료 입고${newRecord.note ? ` (${newRecord.note})` : ''}`,
        createdAt: nowIso,
      });
    }

    if (usedQty > 0 || item.id === product.linkedItemId) {
      return {
        ...item,
        currentStock: nextStock,
        totalInbound: nextInbound,
        totalUsed: nextUsed,
      };
    }
    return item;
  });

  return {
    ok: true,
    record: newRecord,
    nextState: {
      ...state,
      items: updatedItems,
      productionRecords: [newRecord, ...state.productionRecords],
      transactions: [...newTransactions, ...state.transactions],
      lastUpdatedAt: nowIso,
    },
  };
}

/**
 * 생산 기록 취소/삭제 및 자재 복원 (§13)
 */
export function executeCancelProduction(
  state: ErpAppState,
  recordId: string
): ErpAppState {
  const target = state.productionRecords.find((r) => r.id === recordId);
  if (!target) return state;

  const nowIso = new Date().toISOString();
  const product = state.products.find((p) => p.id === target.productId);
  const newTransactions: InventoryTransaction[] = [];

  const restoreMap = new Map<string, number>();
  target.consumedItems.forEach((c) => {
    restoreMap.set(c.itemId, (restoreMap.get(c.itemId) || 0) + c.quantity);
  });

  const updatedItems = state.items.map((item) => {
    let nextStock = item.currentStock;
    let nextInbound = item.totalInbound;
    let nextUsed = item.totalUsed;
    let changed = false;

    const restoreQty = restoreMap.get(item.id) || 0;
    if (restoreQty > 0) {
      nextStock += restoreQty;
      nextUsed = Math.max(0, nextUsed - restoreQty);
      changed = true;
      newTransactions.push({
        id: makeId('tx'),
        transactionDate: target.productionDate,
        itemId: item.id,
        itemName: `${item.name}${item.specification ? ` ${item.specification}` : ''}`,
        transactionType: 'PRODUCTION_CANCEL',
        quantityChange: restoreQty,
        balanceAfter: nextStock,
        referenceId: recordId,
        worker: target.worker,
        note: `${target.productName} ${target.quantity.toLocaleString()}EA 생산 취소 자재 복원`,
        createdAt: nowIso,
      });
    }

    if (product && item.id === product.linkedItemId) {
      nextStock = Math.max(0, nextStock - target.quantity);
      nextInbound = Math.max(0, nextInbound - target.quantity);
      changed = true;
      newTransactions.push({
        id: makeId('tx'),
        transactionDate: target.productionDate,
        itemId: item.id,
        itemName: item.name,
        transactionType: 'PRODUCTION_CANCEL',
        quantityChange: -target.quantity,
        balanceAfter: nextStock,
        referenceId: recordId,
        worker: target.worker,
        note: `${target.productName} 생산 취소 (완제품/중간재 회수)`,
        createdAt: nowIso,
      });
    }

    return changed
      ? {
          ...item,
          currentStock: nextStock,
          totalInbound: nextInbound,
          totalUsed: nextUsed,
        }
      : item;
  });

  return {
    ...state,
    items: updatedItems,
    productionRecords: state.productionRecords.filter((r) => r.id !== recordId),
    transactions: [...newTransactions, ...state.transactions],
    lastUpdatedAt: nowIso,
  };
}

/**
 * 생산 기록 수정 (기존 기록 안전 복원 후 새 수량으로 재검증 및 반영) (§13)
 */
export function executeUpdateProduction(
  state: ErpAppState,
  recordId: string,
  updates: {
    productionDate: string;
    quantity: number;
    worker: string;
    manager: string;
    note: string;
  }
): { ok: true; nextState: ErpAppState } | { ok: false; validation: ProductionValidationResult } {
  const existing = state.productionRecords.find((r) => r.id === recordId);
  if (!existing) {
    return {
      ok: false,
      validation: {
        valid: false,
        errorMessage: '수정할 생산 기록을 찾을 수 없습니다.',
        requiredList: [],
        shortages: [],
      },
    };
  }

  // 먼저 기존 기록 취소 상태로 복원한 가상 상태 생성
  const revertedState = executeCancelProduction(state, recordId);

  // 초기 시드 레코드 수정 시에는 하부 베이스만 소비 스냅샷을 유지하거나 BOM을 검증하도록 처리
  if (existing.isInitialSeed) {
    const baseItem = revertedState.items.find((i) => i.id === 'item_base');
    const availableBase = baseItem ? baseItem.currentStock : 0;
    if (updates.quantity <= 0 || !Number.isInteger(updates.quantity)) {
      return {
        ok: false,
        validation: {
          valid: false,
          errorMessage: '수량은 1 이상의 정수를 입력해 주세요.',
          requiredList: [],
          shortages: [],
        },
      };
    }
    if (availableBase < updates.quantity) {
      return {
        ok: false,
        validation: {
          valid: false,
          errorMessage: '자재 부족으로 수정할 수 없습니다.',
          requiredList: [
            {
              itemId: 'item_base',
              itemName: '하부 베이스',
              specification: '40A BASE',
              unit: 'EA',
              quantity: updates.quantity,
            },
          ],
          shortages: [
            {
              itemId: 'item_base',
              itemName: '하부 베이스',
              specification: '40A BASE',
              unit: 'EA',
              requiredQty: updates.quantity,
              availableStock: availableBase,
              shortageQty: updates.quantity - availableBase,
            },
          ],
        },
      };
    }

    const nowIso = new Date().toISOString();
    const product = revertedState.products.find((p) => p.id === existing.productId);
    const updatedItems = revertedState.items.map((item) => {
      if (item.id === 'item_base') {
        return {
          ...item,
          currentStock: item.currentStock - updates.quantity,
          totalUsed: item.totalUsed + updates.quantity,
        };
      }
      if (product && item.id === product.linkedItemId) {
        return {
          ...item,
          currentStock: item.currentStock + updates.quantity,
          totalInbound: item.totalInbound + updates.quantity,
        };
      }
      return item;
    });

    const newRec: ProductionRecord = {
      ...existing,
      productionDate: updates.productionDate,
      quantity: updates.quantity,
      worker: updates.worker,
      manager: updates.manager,
      note: updates.note,
      consumedItems: [
        {
          itemId: 'item_base',
          itemName: '하부 베이스',
          specification: '40A BASE',
          unit: 'EA',
          quantity: updates.quantity,
        },
      ],
    };

    const tx: InventoryTransaction = {
      id: makeId('tx'),
      transactionDate: updates.productionDate,
      itemId: 'item_base',
      itemName: '하부 베이스',
      transactionType: 'PRODUCTION_USE',
      quantityChange: -updates.quantity,
      balanceAfter: updatedItems.find((i) => i.id === 'item_base')?.currentStock || 0,
      referenceId: existing.id,
      worker: updates.worker,
      note: `${existing.productName} 기존 실적 수정 반영 (${updates.quantity.toLocaleString()}EA)`,
      createdAt: nowIso,
    };

    return {
      ok: true,
      nextState: {
        ...revertedState,
        items: updatedItems,
        productionRecords: [newRec, ...revertedState.productionRecords],
        transactions: [tx, ...revertedState.transactions],
        lastUpdatedAt: nowIso,
      },
    };
  }

  // 일반 생산 기록은 BOM 전체 재검증 후 재등록
  const res = executeRegisterProduction(revertedState, {
    productionDate: updates.productionDate,
    productId: existing.productId,
    quantity: updates.quantity,
    worker: updates.worker,
    manager: updates.manager,
    note: updates.note,
  });

  if (!res.ok) return res;
  return { ok: true, nextState: res.nextState };
}

/**
 * 자재 입고 등록 (§10)
 */
export function executeRegisterReceipt(
  state: ErpAppState,
  params: {
    receiptDate: string;
    itemId: string;
    quantity: number;
    supplier: string;
    worker: string;
    note: string;
  }
): ErpAppState {
  const item = state.items.find((i) => i.id === params.itemId);
  if (!item || params.quantity <= 0) return state;

  const nowIso = new Date().toISOString();
  const receiptId = makeId('rcpt');

  const newReceipt: ReceiptRecord = {
    id: receiptId,
    receiptDate: params.receiptDate,
    itemId: item.id,
    itemName: item.name,
    specification: item.specification,
    unit: item.unit,
    quantity: params.quantity,
    supplier: params.supplier.trim() || '-',
    worker: params.worker.trim() || '현장 관리자',
    note: params.note.trim(),
    createdAt: nowIso,
  };

  const nextBalance = item.currentStock + params.quantity;
  const newTx: InventoryTransaction = {
    id: makeId('tx'),
    transactionDate: params.receiptDate,
    itemId: item.id,
    itemName: `${item.name}${item.specification ? ` ${item.specification}` : ''}`,
    transactionType: 'RECEIPT',
    quantityChange: params.quantity,
    balanceAfter: nextBalance,
    referenceId: receiptId,
    worker: newReceipt.worker,
    note: `${newReceipt.supplier !== '-' ? `[${newReceipt.supplier}] ` : ''}자재 입고${newReceipt.note ? ` - ${newReceipt.note}` : ''}`,
    createdAt: nowIso,
  };

  return {
    ...state,
    items: state.items.map((i) =>
      i.id === item.id
        ? {
            ...i,
            currentStock: nextBalance,
            totalInbound: i.totalInbound + params.quantity,
          }
        : i
    ),
    receiptRecords: [newReceipt, ...state.receiptRecords],
    transactions: [newTx, ...state.transactions],
    lastUpdatedAt: nowIso,
  };
}

/**
 * 자재 입고 취소/삭제
 */
export function executeCancelReceipt(state: ErpAppState, receiptId: string): ErpAppState {
  const target = state.receiptRecords.find((r) => r.id === receiptId);
  if (!target) return state;

  const nowIso = new Date().toISOString();
  const item = state.items.find((i) => i.id === target.itemId);
  if (!item) return state;

  const nextBalance = Math.max(0, item.currentStock - target.quantity);
  const newTx: InventoryTransaction = {
    id: makeId('tx'),
    transactionDate: target.receiptDate,
    itemId: item.id,
    itemName: `${item.name}${item.specification ? ` ${item.specification}` : ''}`,
    transactionType: 'ADJUSTMENT',
    quantityChange: -target.quantity,
    balanceAfter: nextBalance,
    referenceId: receiptId,
    worker: target.worker,
    note: `입고 취소 차감 (${target.supplier})`,
    createdAt: nowIso,
  };

  return {
    ...state,
    items: state.items.map((i) =>
      i.id === item.id
        ? {
            ...i,
            currentStock: nextBalance,
            totalInbound: Math.max(0, i.totalInbound - target.quantity),
          }
        : i
    ),
    receiptRecords: state.receiptRecords.filter((r) => r.id !== receiptId),
    transactions: [newTx, ...state.transactions],
    lastUpdatedAt: nowIso,
  };
}

/**
 * 자재 입고 내역 수정 (자재 변경 / 수량 변경 시 재고 및 수불 이력 자동 동기화)
 */
export function executeUpdateReceipt(
  state: ErpAppState,
  receiptId: string,
  updates: {
    receiptDate: string;
    itemId: string;
    quantity: number;
    supplier: string;
    worker: string;
    note: string;
  }
): ErpAppState {
  const existing = state.receiptRecords.find((r) => r.id === receiptId);
  const newItem = state.items.find((i) => i.id === updates.itemId);
  if (!existing || !newItem || updates.quantity <= 0) return state;

  const nowIso = new Date().toISOString();
  const newTransactions: InventoryTransaction[] = [];

  const updatedItems = state.items.map((item) => {
    if (existing.itemId === updates.itemId) {
      if (item.id !== existing.itemId) return item;
      const diff = updates.quantity - existing.quantity;
      if (diff === 0) return item;
      const nextBalance = Math.max(0, item.currentStock + diff);
      newTransactions.push({
        id: makeId('tx'),
        transactionDate: updates.receiptDate,
        itemId: item.id,
        itemName: `${item.name}${item.specification ? ` ${item.specification}` : ''}`,
        transactionType: 'ADJUSTMENT',
        quantityChange: diff,
        balanceAfter: nextBalance,
        referenceId: receiptId,
        worker: updates.worker.trim() || existing.worker,
        note: `입고 수량 수정 (${existing.quantity.toLocaleString()} → ${updates.quantity.toLocaleString()})`,
        createdAt: nowIso,
      });
      return {
        ...item,
        currentStock: nextBalance,
        totalInbound: Math.max(0, item.totalInbound + diff),
      };
    }

    // 자재가 다른 품목으로 변경된 경우: 기존 자재 회수 + 새 자재 입고
    if (item.id === existing.itemId) {
      const nextBalance = Math.max(0, item.currentStock - existing.quantity);
      newTransactions.push({
        id: makeId('tx'),
        transactionDate: updates.receiptDate,
        itemId: item.id,
        itemName: `${item.name}${item.specification ? ` ${item.specification}` : ''}`,
        transactionType: 'ADJUSTMENT',
        quantityChange: -existing.quantity,
        balanceAfter: nextBalance,
        referenceId: receiptId,
        worker: updates.worker.trim() || existing.worker,
        note: `입고 품목 변경 회수 (→ ${newItem.name})`,
        createdAt: nowIso,
      });
      return {
        ...item,
        currentStock: nextBalance,
        totalInbound: Math.max(0, item.totalInbound - existing.quantity),
      };
    }

    if (item.id === updates.itemId) {
      const nextBalance = item.currentStock + updates.quantity;
      newTransactions.push({
        id: makeId('tx'),
        transactionDate: updates.receiptDate,
        itemId: item.id,
        itemName: `${item.name}${item.specification ? ` ${item.specification}` : ''}`,
        transactionType: 'RECEIPT',
        quantityChange: updates.quantity,
        balanceAfter: nextBalance,
        referenceId: receiptId,
        worker: updates.worker.trim() || existing.worker,
        note: `입고 품목 변경 반영 (${existing.itemName} → ${newItem.name})`,
        createdAt: nowIso,
      });
      return {
        ...item,
        currentStock: nextBalance,
        totalInbound: item.totalInbound + updates.quantity,
      };
    }

    return item;
  });

  const updatedRecord: ReceiptRecord = {
    ...existing,
    receiptDate: updates.receiptDate,
    itemId: newItem.id,
    itemName: newItem.name,
    specification: newItem.specification,
    unit: newItem.unit,
    quantity: updates.quantity,
    supplier: updates.supplier.trim() || '-',
    worker: updates.worker.trim() || '현장 관리자',
    note: updates.note.trim(),
  };

  return {
    ...state,
    items: updatedItems,
    receiptRecords: state.receiptRecords.map((r) =>
      r.id === receiptId ? updatedRecord : r
    ),
    transactions: [...newTransactions, ...state.transactions],
    lastUpdatedAt: nowIso,
  };
}

/**
 * 자재 사용누계 직접 수정 (필요 시 현재 재고도 차이만큼 자동 반영)
 */
export function executeUpdateTotalUsed(
  state: ErpAppState,
  params: {
    date: string;
    itemId: string;
    newTotalUsed: number;
    syncCurrentStock: boolean;
    reason: string;
    worker: string;
  }
): ErpAppState {
  const item = state.items.find((i) => i.id === params.itemId);
  if (!item || params.newTotalUsed < 0) return state;

  const oldUsed = item.totalUsed;
  const diffUsed = params.newTotalUsed - oldUsed;
  if (diffUsed === 0) return state;

  const nowIso = new Date().toISOString();
  const nextStock = params.syncCurrentStock
    ? Math.max(0, item.currentStock - diffUsed)
    : item.currentStock;

  const newTx: InventoryTransaction = {
    id: makeId('tx'),
    transactionDate: params.date,
    itemId: item.id,
    itemName: `${item.name}${item.specification ? ` ${item.specification}` : ''}`,
    transactionType: 'ADJUSTMENT',
    quantityChange: params.syncCurrentStock ? -diffUsed : 0,
    balanceAfter: nextStock,
    referenceId: item.id,
    worker: params.worker.trim() || '현장 관리자',
    note: `사용누계 수정 (${oldUsed.toLocaleString()} → ${params.newTotalUsed.toLocaleString()})${
      params.reason.trim() ? ` · ${params.reason.trim()}` : ''
    }`,
    createdAt: nowIso,
  };

  return {
    ...state,
    items: state.items.map((i) =>
      i.id === item.id
        ? {
            ...i,
            totalUsed: params.newTotalUsed,
            currentStock: nextStock,
          }
        : i
    ),
    transactions: [newTx, ...state.transactions],
    lastUpdatedAt: nowIso,
  };
}

/**
 * 재고 직접 실사 조정 (§27)
 */
export function executeRegisterAdjustment(
  state: ErpAppState,
  params: {
    adjustmentDate: string;
    itemId: string;
    afterQuantity: number;
    reason: string;
    worker: string;
  }
): ErpAppState {
  const item = state.items.find((i) => i.id === params.itemId);
  if (!item || params.afterQuantity < 0) return state;

  const beforeQuantity = item.currentStock;
  const diff = params.afterQuantity - beforeQuantity;
  if (diff === 0) return state;

  const nowIso = new Date().toISOString();
  const adjId = makeId('adj');

  const newAdj: InventoryAdjustment = {
    id: adjId,
    adjustmentDate: params.adjustmentDate,
    itemId: item.id,
    itemName: `${item.name}${item.specification ? ` ${item.specification}` : ''}`,
    beforeQuantity,
    afterQuantity: params.afterQuantity,
    adjustmentQuantity: diff,
    reason: params.reason.trim() || '현장 재고 실사 조정',
    worker: params.worker.trim() || '현장 관리자',
    createdAt: nowIso,
  };

  const newTx: InventoryTransaction = {
    id: makeId('tx'),
    transactionDate: params.adjustmentDate,
    itemId: item.id,
    itemName: newAdj.itemName,
    transactionType: 'ADJUSTMENT',
    quantityChange: diff,
    balanceAfter: params.afterQuantity,
    referenceId: adjId,
    worker: newAdj.worker,
    note: `재고 조정 (${beforeQuantity.toLocaleString()} → ${params.afterQuantity.toLocaleString()}) · ${newAdj.reason}`,
    createdAt: nowIso,
  };

  return {
    ...state,
    items: state.items.map((i) =>
      i.id === item.id
        ? {
            ...i,
            currentStock: params.afterQuantity,
            totalAdjusted: i.totalAdjusted + diff,
          }
        : i
    ),
    adjustments: [newAdj, ...state.adjustments],
    transactions: [newTx, ...state.transactions],
    lastUpdatedAt: nowIso,
  };
}

export interface BatchReceiptInputRow {
  receiptDate: string;
  matchedItemId: string | null;
  createNewIfMissing?: boolean;
  itemName?: string;
  specification?: string;
  unit?: string;
  quantity: number;
  supplier: string;
  worker: string;
  note: string;
}

/**
 * 엑셀 일괄 자재 입고 등록 (등록된 자재 + 사용자가 직접 선택한 미등록 자재만 반영)
 */
export function executeBatchRegisterReceipts(
  state: ErpAppState,
  rows: BatchReceiptInputRow[]
): { nextState: ErpAppState; addedCount: number; createdItemsCount: number } {
  let nextState = state;
  let addedCount = 0;
  let createdItemsCount = 0;
  const createdByKey = new Map<string, string>();

  const normNewKey = (name: string, spec: string) =>
    `${name.replace(/\s+/g, '').toLowerCase()}__${spec.replace(/\s+/g, '').toLowerCase()}`;

  for (const row of rows) {
    if (row.quantity <= 0) continue;

    let targetItemId = row.matchedItemId;
    const existsInState =
      !!targetItemId && nextState.items.some((i) => i.id === targetItemId && i.active);

    if (!existsInState) {
      if (!row.createNewIfMissing || !row.itemName?.trim()) {
        continue;
      }
      const k = normNewKey(row.itemName, row.specification || '-');
      const existingCreated = createdByKey.get(k);
      if (existingCreated) {
        targetItemId = existingCreated;
      } else {
        const nowIso = new Date().toISOString();
        const newId = makeId('item');
        const newItem: InventoryItem = {
          id: newId,
          name: row.itemName.trim(),
          specification: (row.specification || '-').trim() || '-',
          unit: (row.unit || 'EA').trim() || 'EA',
          kind: 'RAW',
          currentStock: 0,
          totalInbound: 0,
          totalUsed: 0,
          totalAdjusted: 0,
          minimumStock: 1000,
          notes: '엑셀 입고 선택 추가 자재',
          active: true,
          createdAt: nowIso,
        };
        nextState = {
          ...nextState,
          items: [...nextState.items, newItem],
          lastUpdatedAt: nowIso,
        };
        createdByKey.set(k, newId);
        targetItemId = newId;
        createdItemsCount += 1;
      }
    }

    if (!targetItemId) continue;

    nextState = executeRegisterReceipt(nextState, {
      receiptDate: row.receiptDate,
      itemId: targetItemId,
      quantity: row.quantity,
      supplier: row.supplier,
      worker: row.worker,
      note: row.note,
    });
    addedCount += 1;
  }

  return { nextState, addedCount, createdItemsCount };
}
