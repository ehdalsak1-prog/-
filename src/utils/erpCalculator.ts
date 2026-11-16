import {
  BomEntry,
  ErpAppState,
  InventoryItem,
  Product,
  ProductionRecord,
} from '../types/erp';

export function formatNum(n: number | undefined | null): string {
  if (n === undefined || n === null || isNaN(n)) return '0';
  return Math.round(n).toLocaleString('ko-KR');
}

export function formatPercent(n: number): string {
  if (isNaN(n) || !isFinite(n)) return '0.00';
  return n.toFixed(2);
}

export function getTodayDateStr(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export interface BomRequirementDetail {
  bomId: string;
  materialItemId: string;
  materialName: string;
  specification: string;
  unit: string;
  kind: InventoryItem['kind'];
  perUnitQty: number;
  currentStock: number;
  possibleProductQty: number;
}

export interface ProductStats {
  product: Product;
  completedQty: number; // 생산이력 기준 완료량 (중간재는 신규 생산+기존보유 또는 이력기준)
  remainingQty: number;
  progressPercent: number;
  producibleQty: number; // 현재 재고 기준 즉시 생산 가능 수량
  bottleneckName: string;
  bottleneckStock: number;
  bomDetails: BomRequirementDetail[];
}

export interface DashboardSummary {
  totalFinalTarget: number; // 11,000
  totalFinalCompleted: number; // 6,070
  totalFinalRemaining: number; // 4,930
  overallProgressPercent: number; // 55.18
  todayCompleted: number;
  avgDailyCompleted: number;
  estimatedCompletionDate: string | null;
  finalProductStats: ProductStats[];
  intermediateProductStats: ProductStats[];
  baseSummary: {
    heldTotal: number; // 8,674 (inbound)
    usedTotal: number; // 6,070
    remainingStock: number; // 2,604
    totalNeededForGoal: number; // 11,000
    additionalNeeded: number; // 2,326
    producibleFromBoltNut: number; // 3,750
    boltLeftoverAfterMaxBase: number; // 0
    nutLeftoverAfterMaxBase: number; // 200
  };
  shortageItemsCount: number;
  warningItemsCount: number;
}

export interface PurchaseRequirementItem {
  item: InventoryItem;
  grossTargetNeed: number; // 전체 목표(11,000 EA) 기준 총 소요량
  netRemainingNeed: number; // 잔여 생산(미생산분 - 중간재 재고) 기준 실소요량
  currentStock: number;
  grossPurchaseShortage: number; // max(0, grossTargetNeed - (currentStock + alreadyUsedInTarget))
  netPurchaseShortage: number; // max(0, netRemainingNeed - currentStock)
  status: 'SUFFICIENT' | 'WARNING' | 'SHORTAGE';
}

export function getProductBomDetails(
  productId: string,
  items: InventoryItem[],
  bom: BomEntry[]
): BomRequirementDetail[] {
  const entries = bom.filter((b) => b.productId === productId);
  return entries.map((entry) => {
    const item = items.find((i) => i.id === entry.materialItemId);
    const stock = item ? Math.max(0, item.currentStock) : 0;
    const perUnit = entry.quantity > 0 ? entry.quantity : 1;
    return {
      bomId: entry.id,
      materialItemId: entry.materialItemId,
      materialName: item?.name || '삭제된 자재',
      specification: item?.specification || '-',
      unit: item?.unit || 'EA',
      kind: item?.kind || 'RAW',
      perUnitQty: entry.quantity,
      currentStock: item?.currentStock || 0,
      possibleProductQty: Math.floor(stock / perUnit),
    };
  });
}

export function calculateProductStats(
  product: Product,
  items: InventoryItem[],
  bom: BomEntry[],
  productionRecords: ProductionRecord[]
): ProductStats {
  const completedFromRecords = productionRecords
    .filter((r) => r.productId === product.id)
    .reduce((sum, r) => sum + (Number(r.quantity) || 0), 0);

  const linkedItem = items.find((i) => i.id === product.linkedItemId);
  // 중간제품(하부 베이스 등)의 경우 기존 보유 입고를 포함한 누적 확보량으로 완료/충당률 계산 가능
  const completedQty =
    product.category === 'INTERMEDIATE'
      ? Math.max(completedFromRecords, linkedItem?.totalInbound || 0)
      : completedFromRecords;

  const remainingQty = Math.max(0, product.targetQuantity - completedQty);
  const progressPercent =
    product.targetQuantity > 0
      ? Math.min(100, (completedQty / product.targetQuantity) * 100)
      : 0;

  const bomDetails = getProductBomDetails(product.id, items, bom);
  let producibleQty = 0;
  let bottleneckName = 'BOM 미설정';
  let bottleneckStock = 0;

  if (bomDetails.length > 0) {
    producibleQty = Math.min(...bomDetails.map((d) => d.possibleProductQty));
    const bottleneck = bomDetails.reduce((min, cur) =>
      cur.possibleProductQty < min.possibleProductQty ? cur : min
    );
    bottleneckName = bottleneck.materialName;
    bottleneckStock = bottleneck.currentStock;
  }

  return {
    product,
    completedQty,
    remainingQty,
    progressPercent,
    producibleQty,
    bottleneckName,
    bottleneckStock,
    bomDetails,
  };
}

export function calculateDashboardSummary(state: ErpAppState): DashboardSummary {
  const activeProducts = state.products.filter((p) => p.active);
  const finalProducts = activeProducts.filter((p) => p.category === 'FINAL');
  const intermediateProducts = activeProducts.filter((p) => p.category === 'INTERMEDIATE');

  const finalProductStats = finalProducts.map((p) =>
    calculateProductStats(p, state.items, state.bom, state.productionRecords)
  );
  const intermediateProductStats = intermediateProducts.map((p) =>
    calculateProductStats(p, state.items, state.bom, state.productionRecords)
  );

  const totalFinalTarget = finalProductStats.reduce(
    (sum, s) => sum + s.product.targetQuantity,
    0
  );
  const totalFinalCompleted = finalProductStats.reduce(
    (sum, s) => sum + s.completedQty,
    0
  );
  const totalFinalRemaining = Math.max(0, totalFinalTarget - totalFinalCompleted);
  const overallProgressPercent =
    totalFinalTarget > 0 ? Math.min(100, (totalFinalCompleted / totalFinalTarget) * 100) : 0;

  // 일별 완제품 생산량 집계
  const finalProductIds = new Set(finalProducts.map((p) => p.id));
  const finalRecords = state.productionRecords.filter((r) => finalProductIds.has(r.productId));
  const todayStr = getTodayDateStr();
  const todayCompleted = finalRecords
    .filter((r) => r.productionDate === todayStr)
    .reduce((sum, r) => sum + r.quantity, 0);

  const distinctDays = new Set(finalRecords.map((r) => r.productionDate));
  const avgDailyCompleted =
    distinctDays.size > 0 ? Math.round(totalFinalCompleted / distinctDays.size) : 0;

  let estimatedCompletionDate: string | null = null;
  if (totalFinalRemaining > 0 && avgDailyCompleted > 0) {
    const daysNeeded = Math.ceil(totalFinalRemaining / avgDailyCompleted);
    const est = new Date();
    est.setDate(est.getDate() + daysNeeded);
    estimatedCompletionDate = `${est.getFullYear()}-${String(est.getMonth() + 1).padStart(
      2,
      '0'
    )}-${String(est.getDate()).padStart(2, '0')}`;
  } else if (totalFinalRemaining === 0 && totalFinalTarget > 0) {
    estimatedCompletionDate = '목표 달성 완료';
  }

  // 하부 베이스 특화 집계 (§7, §17, §31)
  const baseItem = state.items.find((i) => i.id === 'item_base');
  const boltItem = state.items.find((i) => i.id === 'item_bolt');
  const nutItem = state.items.find((i) => i.id === 'item_nut');

  const baseStock = Math.max(0, baseItem?.currentStock || 0);
  const baseHeldTotal = baseItem?.totalInbound || 0;
  const baseUsedTotal = baseItem?.totalUsed || 0;
  const baseAdditionalNeeded = Math.max(0, totalFinalRemaining - baseStock);

  const boltStock = Math.max(0, boltItem?.currentStock || 0);
  const nutStock = Math.max(0, nutItem?.currentStock || 0);
  const baseStats = intermediateProductStats.find((s) => s.product.id === 'prod_base');
  const producibleFromBoltNut = baseStats
    ? baseStats.producibleQty
    : Math.min(Math.floor(boltStock / 4), Math.floor(nutStock / 4));

  const boltPerBase =
    baseStats?.bomDetails.find((d) => d.materialItemId === 'item_bolt')?.perUnitQty ?? 4;
  const nutPerBase =
    baseStats?.bomDetails.find((d) => d.materialItemId === 'item_nut')?.perUnitQty ?? 4;

  const boltLeftoverAfterMaxBase = Math.max(0, boltStock - producibleFromBoltNut * boltPerBase);
  const nutLeftoverAfterMaxBase = Math.max(0, nutStock - producibleFromBoltNut * nutPerBase);

  // 자재 부족/주의 카운트 (잔여 생산 실소요 기준 부족 포함)
  const purchaseReqs = calculatePurchaseRequirements(state);
  const shortageItemsCount = purchaseReqs.filter((r) => r.status === 'SHORTAGE').length;
  const warningItemsCount = purchaseReqs.filter((r) => r.status === 'WARNING').length;

  return {
    totalFinalTarget,
    totalFinalCompleted,
    totalFinalRemaining,
    overallProgressPercent,
    todayCompleted,
    avgDailyCompleted,
    estimatedCompletionDate,
    finalProductStats,
    intermediateProductStats,
    baseSummary: {
      heldTotal: baseHeldTotal,
      usedTotal: baseUsedTotal,
      remainingStock: baseStock,
      totalNeededForGoal: totalFinalTarget,
      additionalNeeded: baseAdditionalNeeded,
      producibleFromBoltNut,
      boltLeftoverAfterMaxBase,
      nutLeftoverAfterMaxBase,
    },
    shortageItemsCount,
    warningItemsCount,
  };
}

/**
 * 구매 필요량 계산 (§19, §29):
 * 1) 전체 목표(11,000 EA) 기준 총 소요량 및 현재고 대비 부족분
 * 2) 잔여 생산분(미조립 POST) 및 중간재 재고 차감 기준 실제 추가 필요분
 */
export function calculatePurchaseRequirements(state: ErpAppState): PurchaseRequirementItem[] {
  const activeProducts = state.products.filter((p) => p.active);
  const finalProducts = activeProducts.filter((p) => p.category === 'FINAL');

  // Map linkedItemId -> intermediate Product
  const itemToProduct = new Map<string, Product>();
  activeProducts.forEach((p) => {
    if (p.linkedItemId) itemToProduct.set(p.linkedItemId, p);
  });

  const grossNeedMap = new Map<string, number>();
  const netNeedMap = new Map<string, number>();

  const addMap = (map: Map<string, number>, key: string, val: number) => {
    map.set(key, (map.get(key) || 0) + val);
  };

  // 1. 전체 목표 기준 재귀적 BOM 전개 (Gross Target Need)
  const expandGross = (productId: string, qty: number, depth = 0) => {
    if (depth > 5 || qty <= 0) return;
    const entries = state.bom.filter((b) => b.productId === productId);
    for (const entry of entries) {
      const reqQty = qty * entry.quantity;
      addMap(grossNeedMap, entry.materialItemId, reqQty);
      const subProd = itemToProduct.get(entry.materialItemId);
      if (subProd && subProd.category === 'INTERMEDIATE') {
        expandGross(subProd.id, reqQty, depth + 1);
      }
    }
  };

  for (const fp of finalProducts) {
    expandGross(fp.id, fp.targetQuantity);
  }

  // 2. 잔여 생산 기준 실소요 전개 (Net Remaining Need: 미생산 완제품 -> 중간재 현재고 차감 -> 원자재)
  const intermediateGrossRemaining = new Map<string, number>();

  for (const fp of finalProducts) {
    const completed = state.productionRecords
      .filter((r) => r.productId === fp.id)
      .reduce((s, r) => s + r.quantity, 0);
    const remainingFinal = Math.max(0, fp.targetQuantity - completed);
    if (remainingFinal <= 0) continue;

    const entries = state.bom.filter((b) => b.productId === fp.id);
    for (const entry of entries) {
      const reqQty = remainingFinal * entry.quantity;
      addMap(netNeedMap, entry.materialItemId, reqQty);
      const subProd = itemToProduct.get(entry.materialItemId);
      if (subProd && subProd.category === 'INTERMEDIATE') {
        addMap(intermediateGrossRemaining, entry.materialItemId, reqQty);
      }
    }
  }

  // 중간재(하부 베이스, 클램프 등)의 경우 현재 재고를 뺀 실제 추가 생산 필요분만큼 하위 원자재 소요
  intermediateGrossRemaining.forEach((neededInterQty, interItemId) => {
    const interItem = state.items.find((i) => i.id === interItemId);
    const stock = Math.max(0, interItem?.currentStock || 0);
    const interToBuild = Math.max(0, neededInterQty - stock);
    if (interToBuild <= 0) return;

    const subProd = itemToProduct.get(interItemId);
    if (!subProd) return;

    const subEntries = state.bom.filter((b) => b.productId === subProd.id);
    for (const se of subEntries) {
      addMap(netNeedMap, se.materialItemId, interToBuild * se.quantity);
    }
  });

  const targetItems = state.items.filter(
    (i) => i.active && (i.kind === 'RAW' || i.kind === 'INTERMEDIATE')
  );

  return targetItems.map((item) => {
    const grossTargetNeed = grossNeedMap.get(item.id) || 0;
    const netRemainingNeed = netNeedMap.get(item.id) || 0;
    const currentStock = Math.max(0, item.currentStock);

    // 중간제품(예: 하부 베이스)의 경우 이미 완제품에 사용된 수량(totalUsed)도 총 목표 11,000 중 기충당분에 포함되므로
    // 총 목표 대비 추가 필요량 = max(0, grossTargetNeed - (currentStock + totalUsed))
    // 원자재의 경우 총 목표(예: 볼트 88,000) - (현재 재고 + 이미 생산사용 누계) 또는 §19 기준 총필요 - 현재재고
    const grossPurchaseShortage =
      item.kind === 'INTERMEDIATE'
        ? Math.max(0, grossTargetNeed - (currentStock + item.totalUsed))
        : Math.max(0, grossTargetNeed - (currentStock + item.totalUsed));

    const netPurchaseShortage = Math.max(0, netRemainingNeed - currentStock);

    let status: 'SUFFICIENT' | 'WARNING' | 'SHORTAGE' = 'SUFFICIENT';
    if (netPurchaseShortage > 0 || currentStock <= 0) {
      status = 'SHORTAGE';
    } else if (currentStock < item.minimumStock) {
      status = 'WARNING';
    }

    return {
      item,
      grossTargetNeed,
      netRemainingNeed,
      currentStock,
      grossPurchaseShortage,
      netPurchaseShortage,
      status,
    };
  });
}

export interface DailyChartPoint {
  date: string;
  shortDate: string;
  dailyQty: number;
  cumulativeQty: number;
  remainingGoal: number;
}

export function calculateDailyChartSeries(
  state: ErpAppState,
  totalFinalTarget: number
): DailyChartPoint[] {
  const finalIds = new Set(
    state.products.filter((p) => p.category === 'FINAL').map((p) => p.id)
  );
  const byDate = new Map<string, number>();

  state.productionRecords
    .filter((r) => finalIds.has(r.productId))
    .forEach((r) => {
      byDate.set(r.productionDate, (byDate.get(r.productionDate) || 0) + r.quantity);
    });

  const sortedDates = Array.from(byDate.keys()).sort((a, b) => a.localeCompare(b));
  let cum = 0;

  return sortedDates.map((date) => {
    const qty = byDate.get(date) || 0;
    cum += qty;
    const parts = date.split('-');
    const shortDate = parts.length === 3 ? `${Number(parts[1])}/${Number(parts[2])}` : date;
    return {
      date,
      shortDate,
      dailyQty: qty,
      cumulativeQty: cum,
      remainingGoal: Math.max(0, totalFinalTarget - cum),
    };
  });
}
