import { INITIAL_ERP_STATE } from '../constants/initialData.ts';
import type {
  ErpAppState,
  InventoryItem,
  ItemKind,
  ProductCategory,
  ProductionRecord,
} from '../types/erp.ts';
import {
  executeBatchRegisterReceipts,
  executeCancelProduction,
  executeCancelReceipt,
  executeRegisterAdjustment,
  executeRegisterProduction,
  executeRegisterReceipt,
  executeUpdateProduction,
  executeUpdateReceipt,
  executeUpdateTotalUsed,
  type BatchReceiptInputRow,
} from './erpActions.ts';

export type ErpMutationAction =
  | {
      type: 'REGISTER_PRODUCTION';
      payload: {
        productionDate: string;
        productId: string;
        quantity: number;
        worker: string;
        manager: string;
        note: string;
        recordId?: string;
      };
    }
  | {
      type: 'CANCEL_PRODUCTION';
      payload: { recordId: string };
    }
  | {
      type: 'UPDATE_PRODUCTION';
      payload: {
        recordId: string;
        updates: {
          productionDate: string;
          quantity: number;
          worker: string;
          manager: string;
          note: string;
        };
      };
    }
  | {
      type: 'UPDATE_TARGET';
      payload: { productId: string; newTarget: number };
    }
  | {
      type: 'REGISTER_RECEIPT';
      payload: {
        receiptDate: string;
        itemId: string;
        quantity: number;
        supplier: string;
        worker: string;
        note: string;
      };
    }
  | {
      type: 'CANCEL_RECEIPT';
      payload: { receiptId: string };
    }
  | {
      type: 'UPDATE_RECEIPT';
      payload: {
        receiptId: string;
        updates: {
          receiptDate: string;
          itemId: string;
          quantity: number;
          supplier: string;
          worker: string;
          note: string;
        };
      };
    }
  | {
      type: 'BATCH_REGISTER_RECEIPTS';
      payload: { rows: BatchReceiptInputRow[] };
    }
  | {
      type: 'REGISTER_ADJUSTMENT';
      payload: {
        adjustmentDate: string;
        itemId: string;
        afterQuantity: number;
        reason: string;
        worker: string;
      };
    }
  | {
      type: 'UPDATE_TOTAL_USED';
      payload: {
        date: string;
        itemId: string;
        newTotalUsed: number;
        syncCurrentStock: boolean;
        reason: string;
        worker: string;
      };
    }
  | {
      type: 'ADD_MATERIAL';
      payload: {
        id?: string;
        prodId?: string;
        txId?: string;
        name: string;
        specification: string;
        unit: string;
        kind: ItemKind;
        initialStock: number;
        minimumStock: number;
        notes: string;
      };
    }
  | {
      type: 'UPDATE_MATERIAL';
      payload: { itemId: string; updates: Partial<InventoryItem> };
    }
  | {
      type: 'DELETE_MATERIAL';
      payload: { itemId: string };
    }
  | {
      type: 'ADD_BOM_LINE';
      payload: {
        bomId?: string;
        productId: string;
        materialItemId: string;
        quantity: number;
      };
    }
  | {
      type: 'UPDATE_BOM_QTY';
      payload: { bomId: string; quantity: number };
    }
  | {
      type: 'DELETE_BOM_LINE';
      payload: { bomId: string };
    }
  | {
      type: 'UPDATE_PRODUCT_NAME';
      payload: { productId: string; newName: string };
    }
  | {
      type: 'DELETE_PRODUCT';
      payload: { productId: string };
    }
  | {
      type: 'ADD_PRODUCT';
      payload: {
        prodId?: string;
        itemId?: string;
        productName: string;
        category: ProductCategory;
        unit: string;
        targetQuantity: number;
      };
    }
  | {
      type: 'RESET_TO_INITIAL';
      payload?: Record<string, never>;
    };

export interface ErpMutationResult {
  ok: boolean;
  nextState: ErpAppState;
  error?: string;
  summary?: string;
  data?: {
    record?: ProductionRecord;
    addedCount?: number;
    createdItemsCount?: number;
    createdItemId?: string;
  };
}

export function normalizeBoltName(text: string): string {
  return String(text || '').replace(/육각\s*볼트/g, '헥사 볼트');
}

export function normalizeErpState(raw: unknown): ErpAppState | null {
  if (!raw || typeof raw !== 'object') return null;
  const parsed = raw as Partial<ErpAppState>;
  if (
    !Array.isArray(parsed.items) ||
    !Array.isArray(parsed.products) ||
    !Array.isArray(parsed.bom) ||
    !Array.isArray(parsed.productionRecords)
  ) {
    return null;
  }

  const items = parsed.items.map((item) => ({
    ...item,
    name: normalizeBoltName(item.name),
  }));
  const receiptRecords = Array.isArray(parsed.receiptRecords)
    ? parsed.receiptRecords.map((r) => ({
        ...r,
        itemName: normalizeBoltName(r.itemName),
      }))
    : [];
  const transactions = Array.isArray(parsed.transactions)
    ? parsed.transactions.map((t) => ({
        ...t,
        itemName: normalizeBoltName(t.itemName),
      }))
    : [];
  const adjustments = Array.isArray(parsed.adjustments)
    ? parsed.adjustments.map((a) => ({
        ...a,
        itemName: normalizeBoltName(a.itemName),
      }))
    : [];
  const productionRecords = parsed.productionRecords.map((pr) => ({
    ...pr,
    consumedItems: Array.isArray(pr.consumedItems)
      ? pr.consumedItems.map((c) => ({
          ...c,
          itemName: normalizeBoltName(c.itemName),
        }))
      : [],
  }));

  return {
    items,
    products: parsed.products,
    bom: parsed.bom,
    productionRecords,
    receiptRecords,
    transactions,
    adjustments,
    lastUpdatedAt:
      typeof parsed.lastUpdatedAt === 'string' && parsed.lastUpdatedAt
        ? parsed.lastUpdatedAt
        : new Date().toISOString(),
  };
}

export function hasCustomErpData(state: ErpAppState): boolean {
  if (state.lastUpdatedAt !== INITIAL_ERP_STATE.lastUpdatedAt) return true;
  if (state.items.length !== INITIAL_ERP_STATE.items.length) return true;
  if (state.products.length !== INITIAL_ERP_STATE.products.length) return true;
  if (state.bom.length !== INITIAL_ERP_STATE.bom.length) return true;
  if (state.productionRecords.length !== INITIAL_ERP_STATE.productionRecords.length) return true;
  if (state.receiptRecords.length !== INITIAL_ERP_STATE.receiptRecords.length) return true;
  if (state.adjustments.length !== INITIAL_ERP_STATE.adjustments.length) return true;
  return false;
}

/**
 * 서버에 이미 다른 사용자의 데이터가 있을 때, 기존 로컬 브라우저 자료 중 서버에 없는 항목만 안전하게 병합
 */
export function mergeLegacyStateIntoAuthoritative(
  serverState: ErpAppState,
  legacyState: ErpAppState
): { nextState: ErpAppState; merged: boolean } {
  const existingItemIds = new Set(serverState.items.map((i) => i.id));
  const existingProdIds = new Set(serverState.products.map((p) => p.id));
  const existingBomIds = new Set(serverState.bom.map((b) => b.id));
  const existingProdRecIds = new Set(serverState.productionRecords.map((r) => r.id));
  const existingReceiptIds = new Set(serverState.receiptRecords.map((r) => r.id));
  const existingAdjIds = new Set(serverState.adjustments.map((a) => a.id));
  const existingTxIds = new Set(serverState.transactions.map((t) => t.id));

  let changed = false;

  const newItems = legacyState.items.filter((i) => !existingItemIds.has(i.id));
  if (newItems.length > 0) changed = true;

  const newProducts = legacyState.products.filter((p) => !existingProdIds.has(p.id));
  if (newProducts.length > 0) changed = true;

  const newBom = legacyState.bom.filter((b) => !existingBomIds.has(b.id));
  if (newBom.length > 0) changed = true;

  const missingReceipts = legacyState.receiptRecords.filter(
    (r) => !existingReceiptIds.has(r.id)
  );
  const missingProdRecs = legacyState.productionRecords.filter(
    (r) => !existingProdRecIds.has(r.id) && !r.isInitialSeed
  );
  const missingAdjs = legacyState.adjustments.filter((a) => !existingAdjIds.has(a.id));
  const missingTxs = legacyState.transactions.filter((t) => !existingTxIds.has(t.id));

  if (
    missingReceipts.length > 0 ||
    missingProdRecs.length > 0 ||
    missingAdjs.length > 0 ||
    missingTxs.length > 0
  ) {
    changed = true;
  }

  if (!changed) {
    return { nextState: serverState, merged: false };
  }

  // 기존 서버 자재에 대해 누락된 입고/생산 수량 차이 반영 (신규 자재는 이미 legacy currentStock 보유)
  const stockDeltaByItem = new Map<string, { stock: number; inbound: number; used: number }>();
  const addDelta = (id: string, stock: number, inbound: number, used: number) => {
    if (!existingItemIds.has(id)) return;
    const cur = stockDeltaByItem.get(id) || { stock: 0, inbound: 0, used: 0 };
    cur.stock += stock;
    cur.inbound += inbound;
    cur.used += used;
    stockDeltaByItem.set(id, cur);
  };

  for (const r of missingReceipts) {
    addDelta(r.itemId, r.quantity, r.quantity, 0);
  }
  for (const pr of missingProdRecs) {
    for (const c of pr.consumedItems || []) {
      addDelta(c.itemId, -c.quantity, 0, c.quantity);
    }
    const prod =
      serverState.products.find((p) => p.id === pr.productId) ||
      newProducts.find((p) => p.id === pr.productId);
    if (prod) {
      addDelta(prod.linkedItemId, pr.quantity, pr.quantity, 0);
    }
  }

  const updatedItems = [
    ...serverState.items.map((item) => {
      const d = stockDeltaByItem.get(item.id);
      if (!d) return item;
      return {
        ...item,
        currentStock: Math.max(0, item.currentStock + d.stock),
        totalInbound: Math.max(0, item.totalInbound + d.inbound),
        totalUsed: Math.max(0, item.totalUsed + d.used),
      };
    }),
    ...newItems,
  ];

  const nowIso = new Date().toISOString();

  return {
    merged: true,
    nextState: {
      items: updatedItems,
      products: [...serverState.products, ...newProducts],
      bom: [...serverState.bom, ...newBom],
      productionRecords: [...missingProdRecs, ...serverState.productionRecords],
      receiptRecords: [...missingReceipts, ...serverState.receiptRecords],
      adjustments: [...missingAdjs, ...serverState.adjustments],
      transactions: [...missingTxs, ...serverState.transactions],
      lastUpdatedAt: nowIso,
    },
  };
}

export function applyErpMutation(
  state: ErpAppState,
  action: ErpMutationAction
): ErpMutationResult {
  const nowIso = new Date().toISOString();

  switch (action.type) {
    case 'REGISTER_PRODUCTION': {
      const res = executeRegisterProduction(state, action.payload);
      if (!res.ok) {
        return {
          ok: false,
          nextState: state,
          error: res.validation.errorMessage || '재고가 부족합니다.',
        };
      }
      return {
        ok: true,
        nextState: res.nextState,
        summary: `${res.record.productName} ${res.record.quantity.toLocaleString()}EA 생산 등록`,
        data: { record: res.record },
      };
    }

    case 'CANCEL_PRODUCTION': {
      const nextState = executeCancelProduction(state, action.payload.recordId);
      return {
        ok: true,
        nextState,
        summary: '생산 내역 취소 및 자재 복원',
      };
    }

    case 'UPDATE_PRODUCTION': {
      const res = executeUpdateProduction(
        state,
        action.payload.recordId,
        action.payload.updates
      );
      if (!res.ok) {
        return {
          ok: false,
          nextState: state,
          error: res.validation.errorMessage || '수정할 수 없습니다.',
        };
      }
      return {
        ok: true,
        nextState: res.nextState,
        summary: '생산 내역 수정',
      };
    }

    case 'UPDATE_TARGET': {
      const nextState: ErpAppState = {
        ...state,
        products: state.products.map((p) =>
          p.id === action.payload.productId
            ? { ...p, targetQuantity: action.payload.newTarget }
            : p
        ),
        lastUpdatedAt: nowIso,
      };
      return {
        ok: true,
        nextState,
        summary: '생산 목표 수량 변경',
      };
    }

    case 'REGISTER_RECEIPT': {
      const nextState = executeRegisterReceipt(state, action.payload);
      const item = state.items.find((i) => i.id === action.payload.itemId);
      return {
        ok: true,
        nextState,
        summary: item
          ? `${item.name} +${action.payload.quantity.toLocaleString()} ${item.unit} 입고`
          : '자재 입고 등록',
      };
    }

    case 'CANCEL_RECEIPT': {
      const nextState = executeCancelReceipt(state, action.payload.receiptId);
      return {
        ok: true,
        nextState,
        summary: '자재 입고 취소',
      };
    }

    case 'UPDATE_RECEIPT': {
      const nextState = executeUpdateReceipt(
        state,
        action.payload.receiptId,
        action.payload.updates
      );
      return {
        ok: true,
        nextState,
        summary: '자재 입고 내역 수정',
      };
    }

    case 'BATCH_REGISTER_RECEIPTS': {
      const res = executeBatchRegisterReceipts(state, action.payload.rows);
      return {
        ok: true,
        nextState: res.nextState,
        summary: `엑셀 일괄 입고 ${res.addedCount}건 반영`,
        data: {
          addedCount: res.addedCount,
          createdItemsCount: res.createdItemsCount,
        },
      };
    }

    case 'REGISTER_ADJUSTMENT': {
      const nextState = executeRegisterAdjustment(state, action.payload);
      return {
        ok: true,
        nextState,
        summary: '재고 실사 조정 반영',
      };
    }

    case 'UPDATE_TOTAL_USED': {
      const nextState = executeUpdateTotalUsed(state, action.payload);
      return {
        ok: true,
        nextState,
        summary: '자재 사용누계 수정',
      };
    }

    case 'ADD_MATERIAL': {
      const p = action.payload;
      const suffix = `${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const newId = p.id || `item_${suffix}`;
      const existing = state.items.find((i) => i.id === newId);
      if (existing) {
        return {
          ok: true,
          nextState: state,
          data: { createdItemId: existing.id },
        };
      }

      const newItem: InventoryItem = {
        id: newId,
        name: p.name,
        specification: p.specification,
        unit: p.unit,
        kind: p.kind,
        currentStock: p.initialStock,
        totalInbound: p.initialStock,
        totalUsed: 0,
        totalAdjusted: 0,
        minimumStock: p.minimumStock,
        notes: p.notes,
        active: true,
        createdAt: nowIso,
      };

      const newIntermediateProduct =
        p.kind === 'INTERMEDIATE'
          ? {
              id: p.prodId || `prod_${suffix}`,
              productName: p.name,
              productCode:
                p.specification && p.specification !== '-'
                  ? p.specification
                  : `MAT-${suffix.slice(-4)}`,
              category: 'INTERMEDIATE' as const,
              unit: p.unit,
              targetQuantity: 0,
              linkedItemId: newId,
              active: true,
              createdAt: nowIso,
            }
          : null;

      const nextState: ErpAppState = {
        ...state,
        items: [...state.items, newItem],
        products: newIntermediateProduct
          ? [...state.products, newIntermediateProduct]
          : state.products,
        transactions:
          p.initialStock > 0
            ? [
                {
                  id:
                    p.txId ||
                    `tx_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
                  transactionDate: nowIso.slice(0, 10),
                  itemId: newId,
                  itemName: `${p.name} ${p.specification}`,
                  transactionType: 'RECEIPT',
                  quantityChange: p.initialStock,
                  balanceAfter: p.initialStock,
                  referenceId: newId,
                  worker: '현장 관리자',
                  note: '신규 자재 등록 초기 재고',
                  createdAt: nowIso,
                },
                ...state.transactions,
              ]
            : state.transactions,
        lastUpdatedAt: nowIso,
      };

      return {
        ok: true,
        nextState,
        summary: `신규 자재 [${p.name}] 추가`,
        data: { createdItemId: newId },
      };
    }

    case 'UPDATE_MATERIAL': {
      const { itemId, updates } = action.payload;
      const nextState: ErpAppState = {
        ...state,
        items: state.items.map((i) => (i.id === itemId ? { ...i, ...updates } : i)),
        products:
          updates.name !== undefined
            ? state.products.map((p) =>
                p.linkedItemId === itemId
                  ? {
                      ...p,
                      productName:
                        p.category === 'FINAL'
                          ? updates.name!.replace(/\s*완제품$/, '')
                          : updates.name!,
                    }
                  : p
              )
            : state.products,
        receiptRecords:
          updates.name !== undefined || updates.specification !== undefined
            ? state.receiptRecords.map((r) =>
                r.itemId === itemId
                  ? {
                      ...r,
                      itemName: updates.name !== undefined ? updates.name : r.itemName,
                      specification:
                        updates.specification !== undefined
                          ? updates.specification
                          : r.specification,
                    }
                  : r
              )
            : state.receiptRecords,
        lastUpdatedAt: nowIso,
      };
      return {
        ok: true,
        nextState,
        summary: '자재 정보 수정',
      };
    }

    case 'DELETE_MATERIAL': {
      const { itemId } = action.payload;
      const nextState: ErpAppState = {
        ...state,
        items: state.items.filter((i) => i.id !== itemId),
        bom: state.bom.filter((b) => b.materialItemId !== itemId),
        products: state.products.filter((p) => p.linkedItemId !== itemId),
        lastUpdatedAt: nowIso,
      };
      return {
        ok: true,
        nextState,
        summary: '자재 삭제',
      };
    }

    case 'ADD_BOM_LINE': {
      const { bomId, productId, materialItemId, quantity } = action.payload;
      const existing = state.bom.find(
        (b) => b.productId === productId && b.materialItemId === materialItemId
      );
      const nextState: ErpAppState = existing
        ? {
            ...state,
            bom: state.bom.map((b) => (b.id === existing.id ? { ...b, quantity } : b)),
            lastUpdatedAt: nowIso,
          }
        : {
            ...state,
            bom: [
              ...state.bom,
              {
                id:
                  bomId ||
                  `bom_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
                productId,
                materialItemId,
                quantity,
                createdAt: nowIso,
              },
            ],
            lastUpdatedAt: nowIso,
          };
      return {
        ok: true,
        nextState,
        summary: 'BOM 구성 업데이트',
      };
    }

    case 'UPDATE_BOM_QTY': {
      const nextState: ErpAppState = {
        ...state,
        bom: state.bom.map((b) =>
          b.id === action.payload.bomId ? { ...b, quantity: action.payload.quantity } : b
        ),
        lastUpdatedAt: nowIso,
      };
      return {
        ok: true,
        nextState,
        summary: 'BOM 소요량 변경',
      };
    }

    case 'DELETE_BOM_LINE': {
      const nextState: ErpAppState = {
        ...state,
        bom: state.bom.filter((b) => b.id !== action.payload.bomId),
        lastUpdatedAt: nowIso,
      };
      return {
        ok: true,
        nextState,
        summary: 'BOM 항목 삭제',
      };
    }

    case 'UPDATE_PRODUCT_NAME': {
      const trimmed = action.payload.newName.trim();
      if (!trimmed) return { ok: true, nextState: state };
      const targetProd = state.products.find((p) => p.id === action.payload.productId);
      if (!targetProd) return { ok: true, nextState: state };

      const nextState: ErpAppState = {
        ...state,
        products: state.products.map((p) =>
          p.id === action.payload.productId ? { ...p, productName: trimmed } : p
        ),
        items: state.items.map((item) =>
          item.id === targetProd.linkedItemId
            ? {
                ...item,
                name:
                  targetProd.category === 'FINAL'
                    ? `${trimmed} 완제품`
                    : trimmed,
              }
            : item
        ),
        productionRecords: state.productionRecords.map((rec) =>
          rec.productId === action.payload.productId
            ? { ...rec, productName: trimmed }
            : rec
        ),
        lastUpdatedAt: nowIso,
      };
      return {
        ok: true,
        nextState,
        summary: `제품명 [${trimmed}] 수정`,
      };
    }

    case 'DELETE_PRODUCT': {
      const target = state.products.find((p) => p.id === action.payload.productId);
      if (!target) return { ok: true, nextState: state };
      const nextState: ErpAppState = {
        ...state,
        products: state.products.filter((p) => p.id !== action.payload.productId),
        items: state.items.filter((i) => i.id !== target.linkedItemId),
        bom: state.bom.filter(
          (b) =>
            b.productId !== action.payload.productId &&
            b.materialItemId !== target.linkedItemId
        ),
        lastUpdatedAt: nowIso,
      };
      return {
        ok: true,
        nextState,
        summary: `제품 [${target.productName}] 삭제`,
      };
    }

    case 'ADD_PRODUCT': {
      const p = action.payload;
      const suffix = `${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const prodId = p.prodId || `prod_${suffix}`;
      const itemId = p.itemId || `item_${suffix}`;
      if (state.products.some((prod) => prod.id === prodId)) {
        return { ok: true, nextState: state };
      }

      const linkedItem: InventoryItem = {
        id: itemId,
        name:
          p.category === 'FINAL' ? `${p.productName} 완제품` : p.productName,
        specification: '-',
        unit: p.unit,
        kind: p.category === 'FINAL' ? 'FINAL' : 'INTERMEDIATE',
        currentStock: 0,
        totalInbound: 0,
        totalUsed: 0,
        totalAdjusted: 0,
        minimumStock: p.category === 'INTERMEDIATE' ? 500 : 0,
        notes: '신규 추가 제품 재고',
        active: true,
        createdAt: nowIso,
      };

      const nextState: ErpAppState = {
        ...state,
        items: [...state.items, linkedItem],
        products: [
          ...state.products,
          {
            id: prodId,
            productName: p.productName,
            productCode: '',
            category: p.category,
            unit: p.unit,
            targetQuantity: p.targetQuantity,
            linkedItemId: itemId,
            active: true,
            createdAt: nowIso,
          },
        ],
        lastUpdatedAt: nowIso,
      };

      return {
        ok: true,
        nextState,
        summary: `신규 제품 [${p.productName}] 추가`,
      };
    }

    case 'RESET_TO_INITIAL': {
      const fresh: ErpAppState = JSON.parse(JSON.stringify(INITIAL_ERP_STATE));
      fresh.lastUpdatedAt = nowIso;
      return {
        ok: true,
        nextState: fresh,
        summary: '초기 기준 데이터로 복원',
      };
    }

    default:
      return { ok: true, nextState: state };
  }
}
