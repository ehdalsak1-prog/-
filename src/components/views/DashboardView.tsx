import React, { useMemo, useState } from 'react';
import {
  Target,
  CheckCircle2,
  Clock,
  TrendingUp,
  AlertTriangle,
  ArrowRight,
  Package,
  Hammer,
  Calendar,
  ShoppingCart,
  Plus,
  Edit3,
  Trash2,
  Check,
  X,
  ChevronRight,
  Boxes,
} from 'lucide-react';
import {
  ActiveTab,
  ErpAppState,
  InventoryItem,
  ItemKind,
  ProductCategory,
} from '../../types/erp';
import {
  calculateDailyChartSeries,
  calculateDashboardSummary,
  calculatePurchaseRequirements,
  formatNum,
  formatPercent,
  getTodayDateStr,
} from '../../utils/erpCalculator';
import { AddMaterialModal } from '../common/AddMaterialModal';
import { ConfirmModal } from '../common/ConfirmModal';

interface DashboardViewProps {
  state: ErpAppState;
  onNavigate: (tab: ActiveTab) => void;
  onOpenPurchase: () => void;
  onAddMaterial: (params: {
    name: string;
    specification: string;
    unit: string;
    kind: ItemKind;
    initialStock: number;
    minimumStock: number;
    notes: string;
  }) => string;
  onUpdateMaterial: (itemId: string, updates: Partial<InventoryItem>) => void;
  onDeleteMaterial: (itemId: string) => void;
  onRegisterAdjustment: (params: {
    adjustmentDate: string;
    itemId: string;
    afterQuantity: number;
    reason: string;
    worker: string;
  }) => void;
  onAddProduct: (params: {
    productName: string;
    category: ProductCategory;
    unit: string;
    targetQuantity: number;
  }) => void;
  onUpdateProductName: (productId: string, newName: string) => void;
  onUpdateTarget: (productId: string, newTarget: number) => void;
  onDeleteProduct: (productId: string) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  state,
  onNavigate,
  onOpenPurchase,
  onAddMaterial,
  onUpdateMaterial,
  onDeleteMaterial,
  onRegisterAdjustment,
  onAddProduct,
  onUpdateProductName,
  onUpdateTarget,
  onDeleteProduct,
}) => {
  const [isAddMaterialOpen, setIsAddMaterialOpen] = useState(false);
  const [isAddProductOpen, setIsAddProductOpen] = useState(false);
  const [newProdName, setNewProdName] = useState('');
  const [newProdCategory, setNewProdCategory] = useState<ProductCategory>('FINAL');
  const [newProdUnit, setNewProdUnit] = useState('EA');
  const [newProdTarget, setNewProdTarget] = useState('1000');

  // 카드 인라인 수정 (제품명 + 목표수량)
  const [editingProdId, setEditingProdId] = useState<string | null>(null);
  const [editProdName, setEditProdName] = useState('');
  const [editProdTarget, setEditProdTarget] = useState('');

  // 상세 보기 모달 상태 (ID 기반으로 저장해 수정 시 즉시 최신 계산 반영)
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  // 자재 인라인 수정 모달 상태
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [editItemName, setEditItemName] = useState('');
  const [editItemSpec, setEditItemSpec] = useState('');
  const [editItemUnit, setEditItemUnit] = useState('EA');
  const [editItemStock, setEditItemStock] = useState('0');
  const [editItemMinStock, setEditItemMinStock] = useState('0');
  const [editItemNotes, setEditItemNotes] = useState('');

  // 삭제 확인 모달
  const [deleteProductTarget, setDeleteProductTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [deleteItemTarget, setDeleteItemTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const summary = useMemo(() => calculateDashboardSummary(state), [state]);
  const purchaseReqs = useMemo(() => calculatePurchaseRequirements(state), [state]);
  const dailySeries = useMemo(
    () => calculateDailyChartSeries(state, summary.totalFinalTarget),
    [state, summary.totalFinalTarget]
  );

  const maxDailyQty = Math.max(1, ...dailySeries.map((d) => d.dailyQty));
  const shortageReqs = purchaseReqs.filter((r) => r.status === 'SHORTAGE');

  // 대시보드 중간제품 카드 목록: '150×250 클램프 현황 (중간제품)' 고정 카드는 제거하고,
  // 나머지 활성 중간제품(예: 하부 베이스 및 사용자 추가 중간제품)만 동적으로 표시
  const visibleIntermediates = useMemo(
    () => summary.intermediateProductStats.filter((s) => s.product.id !== 'prod_clamp'),
    [summary.intermediateProductStats]
  );

  const allProductStats = useMemo(
    () => [...summary.finalProductStats, ...summary.intermediateProductStats],
    [summary]
  );

  const selectedProductStat = useMemo(
    () => allProductStats.find((s) => s.product.id === selectedProductId) || null,
    [allProductStats, selectedProductId]
  );

  const selectedPurchaseReq = useMemo(
    () => purchaseReqs.find((r) => r.item.id === selectedItemId) || null,
    [purchaseReqs, selectedItemId]
  );

  const startEditProduct = (productId: string, name: string, targetQty: number) => {
    setEditingProdId(productId);
    setEditProdName(name);
    setEditProdTarget(String(targetQty));
  };

  const saveEditProduct = (productId: string) => {
    const trimmed = editProdName.trim();
    if (trimmed) {
      onUpdateProductName(productId, trimmed);
    }
    const parsedTarget = Math.max(0, parseInt(editProdTarget.replace(/,/g, ''), 10) || 0);
    onUpdateTarget(productId, parsedTarget);
    setEditingProdId(null);
  };

  const openEditMaterial = (item: InventoryItem) => {
    setEditingItem(item);
    setEditItemName(item.name);
    setEditItemSpec(item.specification || '');
    setEditItemUnit(item.unit || 'EA');
    setEditItemStock(String(item.currentStock));
    setEditItemMinStock(String(item.minimumStock));
    setEditItemNotes(item.notes || '');
  };

  const handleSaveEditMaterial = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem) return;
    const trimmedName = editItemName.trim();
    if (!trimmedName) return;

    const newStock = Math.max(0, parseInt(editItemStock.replace(/,/g, ''), 10) || 0);
    const newMin = Math.max(0, parseInt(editItemMinStock.replace(/,/g, ''), 10) || 0);

    if (newStock !== editingItem.currentStock) {
      onRegisterAdjustment({
        adjustmentDate: getTodayDateStr(),
        itemId: editingItem.id,
        afterQuantity: newStock,
        reason: '대시보드 품목 수정에서 재고 수량 변경',
        worker: '현장 관리자',
      });
    }

    onUpdateMaterial(editingItem.id, {
      name: trimmedName,
      specification: editItemSpec.trim() || '-',
      unit: editItemUnit.trim() || 'EA',
      minimumStock: newMin,
      notes: editItemNotes.trim(),
    });

    setEditingItem(null);
  };

  const handleCreateProduct = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newProdName.trim();
    if (!trimmed) return;
    onAddProduct({
      productName: trimmed,
      category: newProdCategory,
      unit: newProdUnit.trim() || 'EA',
      targetQuantity: Math.max(0, parseInt(newProdTarget.replace(/,/g, ''), 10) || 0),
    });
    setNewProdName('');
    setNewProdCategory('FINAL');
    setNewProdUnit('EA');
    setNewProdTarget('1000');
    setIsAddProductOpen(false);
  };

  return (
    <div className="space-y-6">
      {/* 1. 부족 자재 알림 배너 */}
      {shortageReqs.length > 0 && (
        <div className="bg-white dark:bg-[#1E232D] border border-rose-200 dark:border-rose-900/60 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start sm:items-center space-x-3">
            <div className="w-9 h-9 rounded-lg bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
              <AlertTriangle size={18} />
            </div>
            <div>
              <div className="text-sm font-bold text-slate-900 dark:text-slate-100">
                자재 부족 알림 ({shortageReqs.length}개 품목 추가 확보 필요)
              </div>
              <div className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-0.5">
                {shortageReqs
                  .slice(0, 4)
                  .map(
                    (r) =>
                      `${r.item.name} (현재 ${formatNum(r.currentStock)} / 부족 ${formatNum(
                        r.netPurchaseShortage
                      )} ${r.item.unit})`
                  )
                  .join(' · ')}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onOpenPurchase}
            className="px-3.5 py-2 text-xs sm:text-sm font-bold rounded-lg bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/50 dark:hover:bg-rose-900/50 text-rose-700 dark:text-rose-300 flex items-center space-x-1.5 shrink-0 transition cursor-pointer self-start sm:self-auto"
          >
            <ShoppingCart size={14} />
            <span>구매 필요량 확인</span>
          </button>
        </div>
      )}

      {/* 2. 상단 핵심 KPI 4종 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-[#1E232D] border border-slate-200/90 dark:border-slate-800 rounded-xl p-5 shadow-2xs">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-sm font-bold">전체 생산 목표</span>
            <Target size={18} />
          </div>
          <div className="mt-3 flex items-baseline space-x-1.5">
            <span className="text-3xl font-black font-mono tabular-nums text-slate-900 dark:text-white tracking-tight">
              {formatNum(summary.totalFinalTarget)}
            </span>
            <span className="text-sm font-bold text-slate-500">EA</span>
          </div>
          <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            완제품 {summary.finalProductStats.length}개 규격 통합 목표
          </div>
        </div>

        <div className="bg-white dark:bg-[#1E232D] border border-slate-200/90 dark:border-slate-800 rounded-xl p-5 shadow-2xs">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-sm font-bold">생산 완료</span>
            <CheckCircle2 size={18} className="text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="mt-3 flex items-baseline space-x-1.5">
            <span className="text-3xl font-black font-mono tabular-nums text-emerald-600 dark:text-emerald-400 tracking-tight">
              {formatNum(summary.totalFinalCompleted)}
            </span>
            <span className="text-sm font-bold text-slate-500">EA</span>
          </div>
          <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            오늘 {formatNum(summary.todayCompleted)} EA · 일평균 {formatNum(summary.avgDailyCompleted)} EA
          </div>
        </div>

        <div className="bg-white dark:bg-[#1E232D] border border-slate-200/90 dark:border-slate-800 rounded-xl p-5 shadow-2xs">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-sm font-bold">생산 잔량</span>
            <Clock size={18} />
          </div>
          <div className="mt-3 flex items-baseline space-x-1.5">
            <span className="text-3xl font-black font-mono tabular-nums text-slate-900 dark:text-white tracking-tight">
              {formatNum(summary.totalFinalRemaining)}
            </span>
            <span className="text-sm font-bold text-slate-500">EA</span>
          </div>
          <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            예상 완료: {summary.estimatedCompletionDate || '-'}
          </div>
        </div>

        <div className="bg-white dark:bg-[#1E232D] border border-slate-200/90 dark:border-slate-800 rounded-xl p-5 shadow-2xs">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-sm font-bold">진행률</span>
            <TrendingUp size={18} />
          </div>
          <div className="mt-3 flex items-baseline space-x-1.5">
            <span className="text-3xl font-black font-mono tabular-nums text-slate-900 dark:text-white tracking-tight">
              {formatPercent(summary.overallProgressPercent)}
            </span>
            <span className="text-base font-bold text-slate-500">%</span>
          </div>
          <div className="mt-2.5 w-full h-2.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-600 dark:bg-emerald-500 rounded-full transition-all duration-300"
              style={{ width: `${Math.min(100, summary.overallProgressPercent)}%` }}
            />
          </div>
        </div>
      </div>

      {/* 3. 제품별 생산 현황 (클릭 시 재고·부족 자재 상세 + 카드별 수정/삭제 + 제품 추가) */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
              제품별 생산 현황
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              품목 카드를 누르면 남은 재고와 부족한 구성 자재를 한눈에 볼 수 있습니다.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setIsAddProductOpen(true)}
            className="px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-white text-white dark:text-slate-900 inline-flex items-center space-x-1.5 cursor-pointer transition"
          >
            <Plus size={14} />
            <span>제품 추가</span>
          </button>
        </div>

        {summary.finalProductStats.length === 0 ? (
          <div className="bg-white dark:bg-[#1E232D] border border-dashed border-slate-300 dark:border-slate-700 rounded-xl p-8 text-center text-sm text-slate-500 dark:text-slate-400">
            등록된 완제품이 없습니다. 우측 상단 <strong>제품 추가</strong> 버튼으로 제품을 등록하세요.
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {summary.finalProductStats.map((stat) => {
              const isEditing = editingProdId === stat.product.id;
              const shortageCount = stat.bomDetails.filter(
                (d) => d.currentStock < stat.remainingQty * d.perUnitQty
              ).length;

              return (
                <div
                  key={stat.product.id}
                  onClick={() => {
                    if (!isEditing) setSelectedProductId(stat.product.id);
                  }}
                  className={`bg-white dark:bg-[#1E232D] border border-slate-200/90 dark:border-slate-800 rounded-xl p-5 shadow-2xs transition-all ${
                    isEditing
                      ? 'ring-2 ring-slate-400 dark:ring-slate-600'
                      : 'cursor-pointer hover:border-slate-400 dark:hover:border-slate-600 hover:shadow-sm'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      {isEditing ? (
                        <div
                          className="space-y-2"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <input
                              type="text"
                              autoFocus
                              value={editProdName}
                              onChange={(e) => setEditProdName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') saveEditProduct(stat.product.id);
                                if (e.key === 'Escape') setEditingProdId(null);
                              }}
                              placeholder="제품명"
                              className="flex-1 min-w-[160px] px-2.5 py-1.5 text-sm font-bold rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none"
                            />
                            <div className="flex items-center space-x-1">
                              <span className="text-xs font-bold text-slate-500">목표</span>
                              <input
                                type="number"
                                min="0"
                                value={editProdTarget}
                                onChange={(e) => setEditProdTarget(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') saveEditProduct(stat.product.id);
                                  if (e.key === 'Escape') setEditingProdId(null);
                                }}
                                className="w-24 px-2 py-1.5 text-sm font-mono font-bold text-right rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none"
                              />
                            </div>
                            <button
                              type="button"
                              onClick={() => saveEditProduct(stat.product.id)}
                              className="p-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg cursor-pointer"
                              title="저장"
                            >
                              <Check size={14} />
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingProdId(null)}
                              className="p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg cursor-pointer"
                              title="취소"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center space-x-1.5">
                            <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 truncate">
                              {stat.product.productName}
                            </h3>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                startEditProduct(
                                  stat.product.id,
                                  stat.product.productName,
                                  stat.product.targetQuantity
                                );
                              }}
                              className="p-1 text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 rounded hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                              title="제품명 · 목표수량 수정"
                            >
                              <Edit3 size={14} />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeleteProductTarget({
                                  id: stat.product.id,
                                  name: stat.product.productName,
                                });
                              }}
                              className="p-1 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 rounded hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
                              title="제품 삭제"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            완료 {formatNum(stat.completedQty)} {stat.product.unit} / 목표{' '}
                            {formatNum(stat.product.targetQuantity)} {stat.product.unit}
                          </p>
                        </>
                      )}
                    </div>

                    {!isEditing && (
                      <div className="text-right shrink-0">
                        <span className="text-lg font-black font-mono tabular-nums text-slate-900 dark:text-white">
                          {formatPercent(stat.progressPercent)}%
                        </span>
                        {shortageCount > 0 ? (
                          <div className="text-[11px] font-bold text-rose-600 dark:text-rose-400">
                            자재 {shortageCount}종 부족
                          </div>
                        ) : (
                          <div className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                            자재 충족
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="mt-3 w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-slate-800 dark:bg-slate-200 rounded-full transition-all duration-300"
                      style={{ width: `${Math.min(100, stat.progressPercent)}%` }}
                    />
                  </div>

                  <div className="mt-4 pt-3.5 border-t border-slate-150 dark:border-slate-800 grid grid-cols-3 gap-2 text-center">
                    <div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">생산 완료</div>
                      <div className="text-base font-extrabold font-mono tabular-nums text-emerald-600 dark:text-emerald-400 mt-0.5">
                        {formatNum(stat.completedQty)}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">생산 잔량</div>
                      <div className="text-base font-extrabold font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-0.5">
                        {formatNum(stat.remainingQty)}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">현재고 조립가능</div>
                      <div
                        className={`text-base font-extrabold font-mono tabular-nums mt-0.5 ${
                          stat.producibleQty > 0
                            ? 'text-slate-900 dark:text-white'
                            : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {formatNum(stat.producibleQty)} SET
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 text-xs text-slate-500 dark:text-slate-400 flex flex-wrap items-center justify-between gap-2">
                    <span>
                      병목 자재:{' '}
                      <strong className="text-slate-700 dark:text-slate-300">
                        {stat.bottleneckName}
                      </strong>{' '}
                      (현재 {formatNum(stat.bottleneckStock)} EA)
                    </span>
                    <div className="flex items-center space-x-3">
                      <span className="font-semibold text-slate-600 dark:text-slate-300 inline-flex items-center">
                        재고·부족 상세 <ChevronRight size={13} />
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onNavigate('production');
                        }}
                        className="font-bold text-slate-800 dark:text-slate-200 hover:text-slate-950 dark:hover:text-white inline-flex items-center space-x-1 cursor-pointer"
                      >
                        <span>생산 등록</span>
                        <ArrowRight size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 4. 중간제품 현황 (클램프 고정 카드 제거 완료 · 하부 베이스 및 추가 중간재 동적 표시) */}
      {visibleIntermediates.length > 0 && (
        <div
          className={
            visibleIntermediates.length === 1
              ? 'grid grid-cols-1 gap-4'
              : 'grid grid-cols-1 lg:grid-cols-2 gap-4'
          }
        >
          {visibleIntermediates.map((stat) => {
            const isBase = stat.product.id === 'prod_base';
            const isEditing = editingProdId === stat.product.id;
            const linkedItem = state.items.find((i) => i.id === stat.product.linkedItemId);
            const currentStock = Math.max(0, linkedItem?.currentStock || 0);
            const totalProducedOrInbound = linkedItem?.totalInbound || stat.completedQty;
            const totalUsed = linkedItem?.totalUsed || 0;
            const additionalNeed = isBase
              ? summary.baseSummary.additionalNeeded
              : Math.max(0, stat.remainingQty);

            return (
              <div
                key={stat.product.id}
                onClick={() => {
                  if (!isEditing) setSelectedProductId(stat.product.id);
                }}
                className={`bg-white dark:bg-[#1E232D] border border-slate-200/90 dark:border-slate-800 rounded-xl p-5 shadow-2xs transition-all ${
                  isEditing
                    ? 'ring-2 ring-slate-400 dark:ring-slate-600'
                    : 'cursor-pointer hover:border-slate-400 dark:hover:border-slate-600 hover:shadow-sm'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex items-center space-x-2.5 flex-1 min-w-0">
                    <div className="w-9 h-9 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 flex items-center justify-center shrink-0">
                      {isBase ? <Hammer size={18} /> : <Package size={18} />}
                    </div>

                    {isEditing ? (
                      <div
                        className="flex flex-wrap items-center gap-2 flex-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="text"
                          autoFocus
                          value={editProdName}
                          onChange={(e) => setEditProdName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveEditProduct(stat.product.id);
                            if (e.key === 'Escape') setEditingProdId(null);
                          }}
                          className="flex-1 min-w-[150px] px-2.5 py-1.5 text-sm font-bold rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none"
                        />
                        <div className="flex items-center space-x-1">
                          <span className="text-xs font-bold text-slate-500">목표</span>
                          <input
                            type="number"
                            min="0"
                            value={editProdTarget}
                            onChange={(e) => setEditProdTarget(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveEditProduct(stat.product.id);
                              if (e.key === 'Escape') setEditingProdId(null);
                            }}
                            className="w-24 px-2 py-1.5 text-sm font-mono font-bold text-right rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-none"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => saveEditProduct(stat.product.id)}
                          className="p-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg cursor-pointer"
                          title="저장"
                        >
                          <Check size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingProdId(null)}
                          className="p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg cursor-pointer"
                          title="취소"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <div className="min-w-0">
                        <div className="flex items-center space-x-1.5">
                          <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 truncate">
                            {stat.product.productName} 현황 (중간제품)
                          </h3>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              startEditProduct(
                                stat.product.id,
                                stat.product.productName,
                                stat.product.targetQuantity
                              );
                            }}
                            className="p-1 text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 rounded hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                            title="제품명 · 목표수량 수정"
                          >
                            <Edit3 size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteProductTarget({
                                id: stat.product.id,
                                name: stat.product.productName,
                              });
                            }}
                            className="p-1 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 rounded hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
                            title="중간제품 삭제"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {isBase
                            ? '기존 보유분에서 POST 기사용분을 제외한 실물 잔량 · 클릭하여 구성 자재 부족 확인'
                            : '클릭하여 구성 자재 재고 및 부족 수량 확인'}
                        </p>
                      </div>
                    )}
                  </div>

                  {!isEditing && (
                    <span className="text-xs font-bold px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono shrink-0">
                      {isBase ? '볼트·너트 가능' : '현재고 조립가능'}: +{formatNum(stat.producibleQty)} {stat.product.unit}
                    </span>
                  )}
                </div>

                <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50/80 dark:bg-slate-800/40 rounded-lg p-3.5 border border-slate-150 dark:border-slate-800">
                  <div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">총 보유·생산</div>
                    <div className="text-lg font-extrabold font-mono tabular-nums text-slate-900 dark:text-white mt-0.5">
                      {formatNum(isBase ? summary.baseSummary.heldTotal : totalProducedOrInbound)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">완제품 사용</div>
                    <div className="text-lg font-extrabold font-mono tabular-nums text-slate-700 dark:text-slate-300 mt-0.5">
                      {formatNum(isBase ? summary.baseSummary.usedTotal : totalUsed)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">현재 잔량</div>
                    <div className="text-lg font-extrabold font-mono tabular-nums text-emerald-600 dark:text-emerald-400 mt-0.5">
                      {formatNum(isBase ? summary.baseSummary.remainingStock : currentStock)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">추가 필요량</div>
                    <div className="text-lg font-extrabold font-mono tabular-nums text-rose-600 dark:text-rose-400 mt-0.5">
                      {formatNum(additionalNeed)}
                    </div>
                  </div>
                </div>

                <div className="mt-3 text-xs text-slate-500 dark:text-slate-400 flex flex-wrap items-center justify-between gap-2">
                  {isBase ? (
                    <span>
                      볼트·너트 현재고 기준 최대 {formatNum(summary.baseSummary.producibleFromBoltNut)} EA 제작 시 (볼트 잔여{' '}
                      {formatNum(summary.baseSummary.boltLeftoverAfterMaxBase)} / 너트 잔여{' '}
                      {formatNum(summary.baseSummary.nutLeftoverAfterMaxBase)} EA)
                    </span>
                  ) : (
                    <span>
                      병목 자재: <strong className="text-slate-700 dark:text-slate-300">{stat.bottleneckName}</strong> (현재 {formatNum(stat.bottleneckStock)} EA)
                    </span>
                  )}
                  <span className="font-semibold text-slate-600 dark:text-slate-300 inline-flex items-center">
                    상세 보기 <ChevronRight size={13} />
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 5. 자재 현재고 상태 테이블 + 최근 일자별 생산 추이 */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* 자재 재고 현황 (2 columns) */}
        <div className="xl:col-span-2 bg-white dark:bg-[#1E232D] border border-slate-200/90 dark:border-slate-800 rounded-xl shadow-2xs overflow-hidden">
          <div className="p-4 sm:p-5 border-b border-slate-200/80 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                주요 자재 및 중간재 현재고 현황
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                품목을 누르면 남은 재고, 사용 제품별 소요량 및 부족 수량을 자세히 볼 수 있습니다.
              </p>
            </div>
            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={() => setIsAddMaterialOpen(true)}
                className="px-2.5 py-1.5 text-xs font-bold rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-white text-white dark:text-slate-900 inline-flex items-center space-x-1 cursor-pointer transition"
              >
                <Plus size={14} />
                <span>자재 추가</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigate('inventory')}
                className="text-xs sm:text-sm font-bold text-slate-700 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white inline-flex items-center space-x-1 cursor-pointer px-2 py-1"
              >
                <span>전체 재고</span>
                <ArrowRight size={14} />
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-50 dark:bg-slate-800/80 text-xs font-bold text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th className="py-2.5 px-4">자재명</th>
                  <th className="py-2.5 px-3">규격</th>
                  <th className="py-2.5 px-3 text-right">현재 재고</th>
                  <th className="py-2.5 px-3 text-right">잔여 목표 필요</th>
                  <th className="py-2.5 px-3 text-right">추가 부족분</th>
                  <th className="py-2.5 px-3 text-center">상태</th>
                  <th className="py-2.5 px-3 text-center">관리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-150 dark:divide-slate-800 text-sm">
                {purchaseReqs.map((row) => (
                  <tr
                    key={row.item.id}
                    onClick={() => setSelectedItemId(row.item.id)}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors cursor-pointer group"
                  >
                    <td className="py-3 px-4 font-bold text-slate-900 dark:text-slate-100">
                      <div className="flex items-center space-x-1.5">
                        <span>{row.item.name}</span>
                        <ChevronRight
                          size={14}
                          className="text-slate-300 group-hover:text-slate-600 dark:group-hover:text-slate-300 transition-colors"
                        />
                      </div>
                    </td>
                    <td className="py-3 px-3 font-mono text-xs text-slate-500 dark:text-slate-400">
                      {row.item.specification || '-'}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums font-extrabold text-slate-900 dark:text-white">
                      {formatNum(row.currentStock)}{' '}
                      <span className="text-xs font-normal text-slate-400">
                        {row.item.unit}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                      {formatNum(row.netRemainingNeed)}{' '}
                      <span className="text-xs text-slate-400">{row.item.unit}</span>
                    </td>
                    <td
                      className={`py-3 px-3 text-right font-mono tabular-nums font-bold ${
                        row.netPurchaseShortage > 0
                          ? 'text-rose-600 dark:text-rose-400'
                          : 'text-emerald-600 dark:text-emerald-400'
                      }`}
                    >
                      {row.netPurchaseShortage > 0
                        ? `-${formatNum(row.netPurchaseShortage)}`
                        : '충족'}
                    </td>
                    <td className="py-3 px-3 text-center">
                      {row.status === 'SHORTAGE' && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300">
                          부족
                        </span>
                      )}
                      {row.status === 'WARNING' && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">
                          주의
                        </span>
                      )}
                      {row.status === 'SUFFICIENT' && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                          정상
                        </span>
                      )}
                    </td>
                    <td
                      className="py-3 px-3 text-center"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="inline-flex items-center space-x-1">
                        <button
                          type="button"
                          onClick={() => openEditMaterial(row.item)}
                          className="p-1.5 text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700 rounded cursor-pointer"
                          title="자재 정보 및 수량 수정"
                        >
                          <Edit3 size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setDeleteItemTarget({
                              id: row.item.id,
                              name: row.item.name,
                            })
                          }
                          className="p-1.5 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded cursor-pointer"
                          title="자재 삭제"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {purchaseReqs.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-sm text-slate-400">
                      등록된 자재가 없습니다. 상단 자재 추가 버튼을 눌러 등록하세요.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* 최근 일자별 생산 실적 그래프 (1 column) */}
        <div className="bg-white dark:bg-[#1E232D] border border-slate-200/90 dark:border-slate-800 rounded-xl p-5 shadow-2xs flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-2">
              <Calendar size={17} className="text-slate-500" />
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                일자별 POST 생산 추이
              </h3>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('production')}
              className="text-xs font-bold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer"
            >
              상세보기
            </button>
          </div>

          {dailySeries.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-sm text-slate-400 py-10">
              등록된 생산 이력이 없습니다.
            </div>
          ) : (
            <div className="space-y-3 flex-1">
              {dailySeries.slice(-7).map((pt) => {
                const widthPct = Math.max(6, Math.round((pt.dailyQty / maxDailyQty) * 100));
                return (
                  <div key={pt.date} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-mono font-bold text-slate-700 dark:text-slate-300">
                        {pt.shortDate}
                      </span>
                      <span className="font-mono tabular-nums font-bold text-slate-900 dark:text-white">
                        {formatNum(pt.dailyQty)} EA{' '}
                        <span className="text-slate-400 font-normal">
                          (누계 {formatNum(pt.cumulativeQty)})
                        </span>
                      </span>
                    </div>
                    <div className="w-full h-2.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-slate-800 dark:bg-slate-200 rounded-full"
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="mt-4 pt-3 border-t border-slate-150 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>누적 생산 완료</span>
            <span className="font-mono font-bold text-slate-900 dark:text-white">
              {formatNum(summary.totalFinalCompleted)} / {formatNum(summary.totalFinalTarget)} EA
            </span>
          </div>
        </div>
      </div>

      {/* ===================================================================== */}
      {/* 모달 1: 제품 클릭 시 - 남은 재고 및 부족 구성자재 상세 현황 모달       */}
      {/* ===================================================================== */}
      {selectedProductStat && (() => {
        const stat = selectedProductStat;
        const shortages = stat.bomDetails
          .map((d) => {
            const neededTotal = stat.remainingQty * d.perUnitQty;
            const diff = d.currentStock - neededTotal;
            return {
              ...d,
              neededTotal,
              shortageQty: diff < 0 ? Math.abs(diff) : 0,
              surplusQty: diff >= 0 ? diff : 0,
            };
          });
        const shortList = shortages.filter((s) => s.shortageQty > 0);

        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-[2px]"
            onClick={() => setSelectedProductId(null)}
          >
            <div
              className="w-full max-w-2xl bg-white dark:bg-[#1E232D] border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden max-h-[90vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-5 py-4 border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between">
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                      {stat.product.category === 'FINAL' ? '완제품' : '중간제품'}
                    </span>
                    <h3 className="text-lg font-extrabold text-slate-900 dark:text-white">
                      {stat.product.productName} 재고 · 부족 현황
                    </h3>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    목표 {formatNum(stat.product.targetQuantity)} {stat.product.unit} · 완료{' '}
                    {formatNum(stat.completedQty)} {stat.product.unit} ({formatPercent(stat.progressPercent)}%)
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedProductId(null)}
                  className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg cursor-pointer"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="p-5 overflow-y-auto space-y-4">
                {/* 상단 요약 3칸 */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700">
                    <div className="text-xs text-slate-500 dark:text-slate-400">남은 생산 잔량</div>
                    <div className="text-xl font-black font-mono tabular-nums text-slate-900 dark:text-white mt-1">
                      {formatNum(stat.remainingQty)}{' '}
                      <span className="text-xs font-bold text-slate-400">{stat.product.unit}</span>
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700">
                    <div className="text-xs text-slate-500 dark:text-slate-400">조립완료수량</div>
                    <div className="text-xl font-black font-mono tabular-nums text-emerald-600 dark:text-emerald-400 mt-1">
                      {formatNum(stat.completedQty)}{' '}
                      <span className="text-xs font-bold text-slate-400">{stat.product.unit}</span>
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700">
                    <div className="text-xs text-slate-500 dark:text-slate-400">현재고 조립가능</div>
                    <div
                      className={`text-xl font-black font-mono tabular-nums mt-1 ${
                        stat.producibleQty > 0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {formatNum(stat.producibleQty)}{' '}
                      <span className="text-xs font-bold text-slate-400">{stat.product.unit}</span>
                    </div>
                  </div>
                </div>

                {/* 부족 자재 요약 배너 */}
                {stat.bomDetails.length === 0 ? (
                  <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 text-xs sm:text-sm text-amber-800 dark:text-amber-300">
                    연결된 구성 자재(BOM)가 없습니다. <strong>설정 · 엑셀</strong> 메뉴에서 구성 자재를 추가할 수 있습니다.
                  </div>
                ) : shortList.length > 0 ? (
                  <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60">
                    <div className="text-xs font-extrabold text-rose-700 dark:text-rose-300 mb-1">
                      잔여 목표({formatNum(stat.remainingQty)} {stat.product.unit}) 대비 부족한 자재
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {shortList.map((s) => (
                        <span
                          key={s.bomId}
                          className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-bold bg-white dark:bg-slate-900 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800"
                        >
                          {s.materialName}: -{formatNum(s.shortageQty)} {s.unit} 부족
                        </span>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 text-xs sm:text-sm font-bold text-emerald-700 dark:text-emerald-300">
                    남은 생산 목표({formatNum(stat.remainingQty)} {stat.product.unit})에 필요한 모든 구성 자재 재고가 충분합니다.
                  </div>
                )}

                {/* 구성 자재별 상세 테이블 */}
                {shortages.length > 0 && (
                  <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                    <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300">
                      구성 자재별 남은 재고 및 부족 수량 (자재를 누르면 상세 재고로 이동)
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse text-sm">
                        <thead className="bg-slate-50/70 dark:bg-slate-800/40 text-xs text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                          <tr>
                            <th className="py-2 px-3.5">자재명</th>
                            <th className="py-2 px-2.5 text-right">1EA 소요</th>
                            <th className="py-2 px-2.5 text-right">현재 남은 재고</th>
                            <th className="py-2 px-2.5 text-right">잔여 필요량</th>
                            <th className="py-2 px-3 text-right">부족 / 여유</th>
                            <th className="py-2 px-3 text-right">제작 가능</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-150 dark:divide-slate-800">
                          {shortages.map((d) => (
                            <tr
                              key={d.bomId}
                              onClick={() => {
                                setSelectedProductId(null);
                                setSelectedItemId(d.materialItemId);
                              }}
                              className="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer"
                            >
                              <td className="py-2.5 px-3.5 font-bold text-slate-900 dark:text-slate-100">
                                <div>{d.materialName}</div>
                                <div className="text-[11px] font-normal text-slate-400">
                                  {d.specification}
                                </div>
                              </td>
                              <td className="py-2.5 px-2.5 text-right font-mono text-slate-600 dark:text-slate-300">
                                {formatNum(d.perUnitQty)}
                              </td>
                              <td className="py-2.5 px-2.5 text-right font-mono font-extrabold text-slate-900 dark:text-white">
                                {formatNum(d.currentStock)} {d.unit}
                              </td>
                              <td className="py-2.5 px-2.5 text-right font-mono text-slate-600 dark:text-slate-300">
                                {formatNum(d.neededTotal)} {d.unit}
                              </td>
                              <td
                                className={`py-2.5 px-3 text-right font-mono font-extrabold ${
                                  d.shortageQty > 0
                                    ? 'text-rose-600 dark:text-rose-400'
                                    : 'text-emerald-600 dark:text-emerald-400'
                                }`}
                              >
                                {d.shortageQty > 0
                                  ? `부족 -${formatNum(d.shortageQty)}`
                                  : `여유 +${formatNum(d.surplusQty)}`}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono text-xs text-slate-500 dark:text-slate-400">
                                {formatNum(d.possibleProductQty)} {stat.product.unit}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>

              <div className="px-5 py-3.5 bg-slate-50/80 dark:bg-slate-800/60 border-t border-slate-200/80 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={() => {
                      const target = stat.product;
                      setSelectedProductId(null);
                      startEditProduct(target.id, target.productName, target.targetQuantity);
                    }}
                    className="px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 cursor-pointer"
                  >
                    이름 · 목표 수정
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const target = stat.product;
                      setSelectedProductId(null);
                      setDeleteProductTarget({ id: target.id, name: target.productName });
                    }}
                    className="px-3 py-1.5 text-xs font-bold rounded-lg border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 hover:bg-rose-100 cursor-pointer"
                  >
                    제품 삭제
                  </button>
                </div>

                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedProductId(null);
                      onNavigate('receipts');
                    }}
                    className="px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 cursor-pointer"
                  >
                    자재 입고
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedProductId(null);
                      onNavigate('production');
                    }}
                    className="px-3.5 py-1.5 text-xs font-bold rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-white text-white dark:text-slate-900 cursor-pointer"
                  >
                    생산 등록하기
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ===================================================================== */}
      {/* 모달 2: 자재 행 클릭 시 - 남은 재고 · 사용처 · 부족 수량 상세 모달     */}
      {/* ===================================================================== */}
      {selectedPurchaseReq && (() => {
        const req = selectedPurchaseReq;
        const item = req.item;
        const surplusAfterGoal = Math.max(0, req.currentStock - req.netRemainingNeed);

        // 이 자재를 사용하는 모든 활성 제품과 잔여 필요량 계산
        const usedByProducts = state.bom
          .filter((b) => b.materialItemId === item.id)
          .map((b) => {
            const stat = allProductStats.find((s) => s.product.id === b.productId);
            if (!stat) return null;
            return {
              productId: stat.product.id,
              productName: stat.product.productName,
              category: stat.product.category,
              unit: stat.product.unit,
              perUnitQty: b.quantity,
              remainingProductQty: stat.remainingQty,
              totalNeededForProduct: stat.remainingQty * b.quantity,
            };
          })
          .filter((v): v is NonNullable<typeof v> => v !== null);

        // 중간재인 경우 이 품목 자체를 만들기 위한 하위 BOM 조회
        const linkedProductStat =
          item.kind === 'INTERMEDIATE'
            ? allProductStats.find((s) => s.product.linkedItemId === item.id) || null
            : null;

        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-[2px]"
            onClick={() => setSelectedItemId(null)}
          >
            <div
              className="w-full max-w-xl bg-white dark:bg-[#1E232D] border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden max-h-[90vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-5 py-4 border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between">
                <div className="flex items-center space-x-2.5">
                  <div className="w-9 h-9 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 flex items-center justify-center">
                    <Boxes size={18} />
                  </div>
                  <div>
                    <div className="flex items-center space-x-2">
                      <h3 className="text-lg font-extrabold text-slate-900 dark:text-white">
                        {item.name}
                      </h3>
                      {req.status === 'SHORTAGE' && (
                        <span className="px-2 py-0.5 rounded text-xs font-bold bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300">
                          부족
                        </span>
                      )}
                      {req.status === 'WARNING' && (
                        <span className="px-2 py-0.5 rounded text-xs font-bold bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">
                          주의
                        </span>
                      )}
                      {req.status === 'SUFFICIENT' && (
                        <span className="px-2 py-0.5 rounded text-xs font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                          정상
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      규격: {item.specification || '-'} · 구분:{' '}
                      {item.kind === 'INTERMEDIATE' ? '중간제품' : '원자재'} · 최소 적정재고{' '}
                      {formatNum(item.minimumStock)} {item.unit}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedItemId(null)}
                  className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg cursor-pointer"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="p-5 overflow-y-auto space-y-4">
                {/* 핵심 재고/부족 요약 */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700">
                    <div className="text-xs text-slate-500 dark:text-slate-400">현재 남은 재고</div>
                    <div className="text-xl font-black font-mono tabular-nums text-slate-900 dark:text-white mt-1">
                      {formatNum(req.currentStock)}{' '}
                      <span className="text-xs font-bold text-slate-400">{item.unit}</span>
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700">
                    <div className="text-xs text-slate-500 dark:text-slate-400">잔여 목표 필요</div>
                    <div className="text-xl font-black font-mono tabular-nums text-slate-800 dark:text-slate-200 mt-1">
                      {formatNum(req.netRemainingNeed)}{' '}
                      <span className="text-xs font-bold text-slate-400">{item.unit}</span>
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700">
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {req.netPurchaseShortage > 0 ? '추가 부족 수량' : '목표 대비 여유'}
                    </div>
                    <div
                      className={`text-xl font-black font-mono tabular-nums mt-1 ${
                        req.netPurchaseShortage > 0
                          ? 'text-rose-600 dark:text-rose-400'
                          : 'text-emerald-600 dark:text-emerald-400'
                      }`}
                    >
                      {req.netPurchaseShortage > 0
                        ? `-${formatNum(req.netPurchaseShortage)}`
                        : `+${formatNum(surplusAfterGoal)}`}{' '}
                      <span className="text-xs font-bold text-slate-400">{item.unit}</span>
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700">
                    <div className="text-xs text-slate-500 dark:text-slate-400">입고 / 사용 누계</div>
                    <div className="text-xs font-mono font-bold text-slate-700 dark:text-slate-300 mt-1.5 space-y-0.5">
                      <div>입고 +{formatNum(item.totalInbound)}</div>
                      <div>사용 -{formatNum(item.totalUsed)}</div>
                    </div>
                  </div>
                </div>

                {/* 부족 안내 문구 */}
                {req.netPurchaseShortage > 0 ? (
                  <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-xs sm:text-sm font-bold text-rose-700 dark:text-rose-300">
                    현재 남은 재고 {formatNum(req.currentStock)} {item.unit}로는 잔여 목표 필요량({formatNum(req.netRemainingNeed)} {item.unit})보다{' '}
                    <span className="underline">{formatNum(req.netPurchaseShortage)} {item.unit}</span>가 부족합니다.
                  </div>
                ) : (
                  <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 text-xs sm:text-sm font-bold text-emerald-700 dark:text-emerald-300">
                    남은 재고 {formatNum(req.currentStock)} {item.unit}로 잔여 생산 목표를 모두 충족합니다.
                    {req.currentStock < item.minimumStock &&
                      ` (단, 최소 적정재고 ${formatNum(item.minimumStock)} ${item.unit} 미만 주의)`}
                  </div>
                )}

                {/* 이 자재를 사용하는 제품별 소요 내역 */}
                <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                  <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300">
                    이 품목이 사용되는 제품별 소요량
                  </div>
                  {usedByProducts.length === 0 ? (
                    <div className="p-4 text-xs text-slate-500 dark:text-slate-400">
                      현재 BOM에 연결된 사용 제품이 없습니다.
                    </div>
                  ) : (
                    <table className="w-full text-left border-collapse text-sm">
                      <thead className="bg-slate-50/60 dark:bg-slate-800/40 text-xs text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                        <tr>
                          <th className="py-2 px-3.5">사용 제품</th>
                          <th className="py-2 px-3 text-right">1EA 소요</th>
                          <th className="py-2 px-3 text-right">제품 잔량</th>
                          <th className="py-2 px-3.5 text-right">직접 필요량</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-150 dark:divide-slate-800">
                        {usedByProducts.map((u) => (
                          <tr
                            key={u.productId}
                            onClick={() => {
                              setSelectedItemId(null);
                              setSelectedProductId(u.productId);
                            }}
                            className="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer"
                          >
                            <td className="py-2.5 px-3.5 font-bold text-slate-900 dark:text-slate-100">
                              {u.productName}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono text-slate-600 dark:text-slate-300">
                              {formatNum(u.perUnitQty)} {item.unit}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono text-slate-600 dark:text-slate-300">
                              {formatNum(u.remainingProductQty)} {u.unit}
                            </td>
                            <td className="py-2.5 px-3.5 text-right font-mono font-bold text-slate-900 dark:text-white">
                              {formatNum(u.totalNeededForProduct)} {item.unit}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                {/* 중간제품인 경우 하위 구성 자재 현황도 함께 표시 */}
                {linkedProductStat && linkedProductStat.bomDetails.length > 0 && (
                  <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                    <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between text-xs font-bold text-slate-600 dark:text-slate-300">
                      <span>이 중간제품 1EA 제작 구성 자재</span>
                      <span className="font-mono text-emerald-600 dark:text-emerald-400">
                        현재 자재로 +{formatNum(linkedProductStat.producibleQty)} {item.unit} 추가 제작 가능
                      </span>
                    </div>
                    <div className="divide-y divide-slate-150 dark:divide-slate-800">
                      {linkedProductStat.bomDetails.map((d) => (
                        <div
                          key={d.bomId}
                          className="px-4 py-2.5 flex items-center justify-between text-xs sm:text-sm"
                        >
                          <span className="font-bold text-slate-800 dark:text-slate-200">
                            {d.materialName}{' '}
                            <span className="font-normal text-slate-400">
                              (1EA당 {formatNum(d.perUnitQty)} {d.unit})
                            </span>
                          </span>
                          <span className="font-mono text-slate-700 dark:text-slate-300">
                            현재고 {formatNum(d.currentStock)} {d.unit} →{' '}
                            <strong>{formatNum(d.possibleProductQty)} {item.unit}</strong> 가능
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="px-5 py-3.5 bg-slate-50/80 dark:bg-slate-800/60 border-t border-slate-200/80 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedItemId(null);
                      openEditMaterial(item);
                    }}
                    className="px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 cursor-pointer"
                  >
                    재고 · 정보 수정
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedItemId(null);
                      setDeleteItemTarget({ id: item.id, name: item.name });
                    }}
                    className="px-3 py-1.5 text-xs font-bold rounded-lg border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 hover:bg-rose-100 cursor-pointer"
                  >
                    품목 삭제
                  </button>
                </div>

                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedItemId(null);
                      onNavigate('receipts');
                    }}
                    className="px-3.5 py-1.5 text-xs font-bold rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-white text-white dark:text-slate-900 cursor-pointer"
                  >
                    자재 입고 등록
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ===================================================================== */}
      {/* 모달 3: 자재 정보 및 수량 수정 모달                                   */}
      {/* ===================================================================== */}
      {editingItem && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-[2px]"
          onClick={() => setEditingItem(null)}
        >
          <div
            className="w-full max-w-md bg-white dark:bg-[#1E232D] border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                품목 정보 · 재고 수량 변경
              </h3>
              <button
                type="button"
                onClick={() => setEditingItem(null)}
                className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveEditMaterial} className="p-5 space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    자재명 *
                  </label>
                  <input
                    type="text"
                    required
                    value={editItemName}
                    onChange={(e) => setEditItemName(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    규격
                  </label>
                  <input
                    type="text"
                    value={editItemSpec}
                    onChange={(e) => setEditItemSpec(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    현재 재고
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={editItemStock}
                    onChange={(e) => setEditItemStock(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono font-bold text-right rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    최소 적정재고
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={editItemMinStock}
                    onChange={(e) => setEditItemMinStock(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono font-bold text-right rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    단위
                  </label>
                  <input
                    type="text"
                    value={editItemUnit}
                    onChange={(e) => setEditItemUnit(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  비고
                </label>
                <input
                  type="text"
                  value={editItemNotes}
                  onChange={(e) => setEditItemNotes(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                />
              </div>

              <div className="pt-2 flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setEditingItem(null)}
                  className="px-4 py-2 text-sm font-semibold rounded-lg border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm font-bold rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-white text-white dark:text-slate-900 cursor-pointer"
                >
                  저장하기
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* 모달 4: 대시보드 제품 추가 모달                                        */}
      {/* ===================================================================== */}
      {isAddProductOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-[2px]"
          onClick={() => setIsAddProductOpen(false)}
        >
          <div
            className="w-full max-w-md bg-white dark:bg-[#1E232D] border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                새 제품 추가
              </h3>
              <button
                type="button"
                onClick={() => setIsAddProductOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateProduct} className="p-5 space-y-3.5">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  제품명 *
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={newProdName}
                  onChange={(e) => setNewProdName(e.target.value)}
                  placeholder="예: 40A POST 600L"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    구분
                  </label>
                  <select
                    value={newProdCategory}
                    onChange={(e) => setNewProdCategory(e.target.value as ProductCategory)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white cursor-pointer"
                  >
                    <option value="FINAL">완제품</option>
                    <option value="INTERMEDIATE">중간제품</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    단위
                  </label>
                  <select
                    value={newProdUnit}
                    onChange={(e) => setNewProdUnit(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white cursor-pointer"
                  >
                    <option value="EA">EA</option>
                    <option value="SET">SET</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    목표 수량
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={newProdTarget}
                    onChange={(e) => setNewProdTarget(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono font-bold text-right rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setIsAddProductOpen(false)}
                  className="px-4 py-2 text-sm font-semibold rounded-lg border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm font-bold rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-white text-white dark:text-slate-900 cursor-pointer"
                >
                  제품 추가
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 신규 자재 추가 모달 */}
      <AddMaterialModal
        isOpen={isAddMaterialOpen}
        onClose={() => setIsAddMaterialOpen(false)}
        onAddMaterial={onAddMaterial}
      />

      {/* 제품 삭제 확인 모달 */}
      <ConfirmModal
        isOpen={!!deleteProductTarget}
        title="제품 삭제"
        description={`'${deleteProductTarget?.name}' 제품과 연결된 BOM 구성을 삭제하시겠습니까?\n(기존 생산 기록은 보존됩니다)`}
        confirmLabel="삭제"
        onConfirm={() => {
          if (deleteProductTarget) {
            onDeleteProduct(deleteProductTarget.id);
          }
          setDeleteProductTarget(null);
        }}
        onCancel={() => setDeleteProductTarget(null)}
      />

      {/* 자재 삭제 확인 모달 */}
      <ConfirmModal
        isOpen={!!deleteItemTarget}
        title="품목 삭제"
        description={`'${deleteItemTarget?.name}' 품목을 재고 목록 및 BOM에서 삭제하시겠습니까?\n(기존 입출고 이력은 보존됩니다)`}
        confirmLabel="삭제"
        onConfirm={() => {
          if (deleteItemTarget) {
            onDeleteMaterial(deleteItemTarget.id);
          }
          setDeleteItemTarget(null);
        }}
        onCancel={() => setDeleteItemTarget(null)}
      />
    </div>
  );
};
