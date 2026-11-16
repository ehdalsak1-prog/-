import React, { useMemo, useState } from 'react';
import {
  Package,
  ShoppingCart,
  Search,
  Plus,
  X,
  CheckCircle2,
  FileSpreadsheet,
  Truck,
  SlidersHorizontal,
  Edit3,
  Trash2,
  Check,
} from 'lucide-react';
import { ActiveTab, ErpAppState, InventoryItem, ItemKind } from '../../types/erp';
import {
  calculatePurchaseRequirements,
  formatNum,
  getTodayDateStr,
} from '../../utils/erpCalculator';
import { PurchaseView } from './PurchaseView';
import { ConfirmModal } from '../common/ConfirmModal';

interface InventoryHubViewProps {
  state: ErpAppState;
  initialSubTab?: 'stock' | 'purchase';
  onNavigate: (tab: ActiveTab) => void;
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
  onExportInventory: () => void;
  onExportPurchase: () => void;
}

const KIND_LABELS: Record<ItemKind, string> = {
  RAW: '원자재',
  INTERMEDIATE: '중간제품',
  FINAL: '완제품',
};

export const InventoryHubView: React.FC<InventoryHubViewProps> = ({
  state,
  initialSubTab = 'stock',
  onNavigate,
  onAddMaterial,
  onUpdateMaterial,
  onDeleteMaterial,
  onRegisterAdjustment,
  onExportInventory,
  onExportPurchase,
}) => {
  const [subTab, setSubTab] = useState<'stock' | 'purchase'>(initialSubTab);

  // 검색 및 필터
  const [searchQuery, setSearchQuery] = useState('');
  const [kindFilter, setKindFilter] = useState<'ALL' | ItemKind>('ALL');

  // 신규 자재 추가 폼
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newSpec, setNewSpec] = useState('');
  const [newKind, setNewKind] = useState<ItemKind>('RAW');
  const [newUnit, setNewUnit] = useState('EA');
  const [newInitialStock, setNewInitialStock] = useState('0');
  const [newMinStock, setNewMinStock] = useState('1000');
  const [newNotes, setNewNotes] = useState('');

  // 인라인 자재 수정
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editSpec, setEditSpec] = useState('');
  const [editMin, setEditMin] = useState('');
  const [editNotes, setEditNotes] = useState('');

  // 빠른 재고 실사 조정 모달
  const [adjustTarget, setAdjustTarget] = useState<InventoryItem | null>(null);
  const [adjustAfterQty, setAdjustAfterQty] = useState('');
  const [adjustReason, setAdjustReason] = useState('현장 실사 수량 반영');

  // 삭제 확인 모달
  const [deleteTarget, setDeleteTarget] = useState<InventoryItem | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 3500);
  };

  const purchaseReqs = useMemo(() => calculatePurchaseRequirements(state), [state]);
  const shortageMap = useMemo(() => {
    const m = new Map<string, number>();
    purchaseReqs.forEach((r) => m.set(r.item.id, r.netPurchaseShortage));
    return m;
  }, [purchaseReqs]);

  const shortageCount = purchaseReqs.filter((r) => r.status === 'SHORTAGE').length;

  const filteredItems = useMemo(() => {
    let list = state.items.filter((i) => i.active);
    if (kindFilter !== 'ALL') {
      list = list.filter((i) => i.kind === kindFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          i.specification.toLowerCase().includes(q) ||
          i.notes.toLowerCase().includes(q)
      );
    }
    return list;
  }, [state.items, kindFilter, searchQuery]);

  const handleQuickAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed) return;
    onAddMaterial({
      name: trimmed,
      specification: newSpec.trim() || '-',
      unit: newUnit.trim() || 'EA',
      kind: newKind,
      initialStock: Math.max(0, parseInt(newInitialStock.replace(/,/g, ''), 10) || 0),
      minimumStock: Math.max(0, parseInt(newMinStock.replace(/,/g, ''), 10) || 0),
      notes: newNotes.trim(),
    });
    showToast(`신규 자재 [${trimmed}] 이(가) 추가되었습니다.`);
    setNewName('');
    setNewSpec('');
    setNewInitialStock('0');
    setNewNotes('');
    setShowAddForm(false);
  };

  const startEdit = (item: InventoryItem) => {
    setEditingId(item.id);
    setEditName(item.name);
    setEditSpec(item.specification);
    setEditMin(String(item.minimumStock));
    setEditNotes(item.notes);
  };

  const saveEdit = (itemId: string) => {
    onUpdateMaterial(itemId, {
      name: editName.trim() || '자재',
      specification: editSpec.trim(),
      minimumStock: Math.max(0, parseInt(editMin, 10) || 0),
      notes: editNotes.trim(),
    });
    setEditingId(null);
    showToast('자재 정보가 수정되었습니다.');
  };

  const openAdjustModal = (item: InventoryItem) => {
    setAdjustTarget(item);
    setAdjustAfterQty(String(item.currentStock));
    setAdjustReason('현장 실사 수량 반영');
  };

  const handleConfirmAdjust = (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustTarget) return;
    const after = parseInt(adjustAfterQty.replace(/,/g, ''), 10);
    if (isNaN(after) || after < 0) return;
    onRegisterAdjustment({
      adjustmentDate: getTodayDateStr(),
      itemId: adjustTarget.id,
      afterQuantity: after,
      reason: adjustReason,
      worker: '현장 관리자',
    });
    showToast(`[${adjustTarget.name}] 현재 재고가 ${formatNum(after)} ${adjustTarget.unit}로 조정되었습니다.`);
    setAdjustTarget(null);
  };

  return (
    <div className="space-y-5">
      {/* 상단 심플 2-탭 전환 */}
      <div className="inline-flex p-1 rounded-xl bg-white dark:bg-[#1E232D] border border-slate-200/90 dark:border-slate-800 shadow-2xs">
        <button
          type="button"
          onClick={() => setSubTab('stock')}
          className={`px-4 py-2 rounded-lg text-xs sm:text-sm font-bold flex items-center space-x-1.5 transition cursor-pointer ${
            subTab === 'stock'
              ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <Package size={15} />
          <span>현재 재고 · 자재 추가</span>
        </button>
        <button
          type="button"
          onClick={() => setSubTab('purchase')}
          className={`px-4 py-2 rounded-lg text-xs sm:text-sm font-bold flex items-center space-x-1.5 transition cursor-pointer ${
            subTab === 'purchase'
              ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <ShoppingCart size={15} />
          <span>구매 필요량 산출</span>
          {shortageCount > 0 && (
            <span className="ml-1 px-1.5 py-0.5 text-[10px] font-mono rounded bg-rose-500 text-white">
              {shortageCount}
            </span>
          )}
        </button>
      </div>

      {notice && (
        <div className="bg-white dark:bg-[#1E232D] border border-emerald-200 dark:border-emerald-900 rounded-xl p-3.5 flex items-center space-x-2.5 shadow-2xs">
          <CheckCircle2 size={18} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span className="text-sm font-bold text-slate-900 dark:text-slate-100">{notice}</span>
        </div>
      )}

      {subTab === 'purchase' ? (
        <PurchaseView state={state} onExportPurchase={onExportPurchase} />
      ) : (
        <div className="space-y-4">
          {/* 상단 컨트롤 + 신규 자재 추가 칸 */}
          <div className="bg-white dark:bg-[#1E232D] border border-slate-200/90 dark:border-slate-800 rounded-xl p-4 sm:p-5 shadow-2xs space-y-3.5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                  자재 및 제품 현재고 ({state.items.length}종)
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  신규 자재를 추가하거나 각 행의 조정·수정 버튼으로 수량을 즉시 관리할 수 있습니다.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddForm((p) => !p)}
                  className="px-3.5 py-2 text-xs font-bold rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-white dark:text-slate-900 text-white flex items-center space-x-1.5 cursor-pointer"
                >
                  {showAddForm ? <X size={14} /> : <Plus size={14} />}
                  <span>{showAddForm ? '입력창 닫기' : '신규 자재 추가'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate('receipts')}
                  className="px-3 py-2 text-xs font-semibold rounded-lg border border-slate-250 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 text-slate-700 dark:text-slate-200 flex items-center space-x-1 cursor-pointer"
                >
                  <Truck size={14} />
                  <span>자재 입고</span>
                </button>
                <button
                  type="button"
                  onClick={onExportInventory}
                  className="px-3 py-2 text-xs font-semibold rounded-lg border border-slate-250 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 text-slate-700 dark:text-slate-200 flex items-center space-x-1 cursor-pointer"
                >
                  <FileSpreadsheet size={14} className="text-emerald-600 dark:text-emerald-400" />
                  <span>엑셀</span>
                </button>
              </div>
            </div>

            {showAddForm && (
              <form
                onSubmit={handleQuickAdd}
                className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 space-y-3"
              >
                <div className="text-xs font-bold text-slate-700 dark:text-slate-200">
                  새 자재 추가 입력 (추가 시 재고 · 입고 · BOM에 즉시 반영)
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-2.5">
                  <div className="lg:col-span-2">
                    <label className="block text-[11px] font-bold text-slate-500 mb-1">
                      자재명 *
                    </label>
                    <input
                      type="text"
                      required
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="예: 스프링 와셔, U볼트"
                      className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-500 mb-1">
                      규격
                    </label>
                    <input
                      type="text"
                      value={newSpec}
                      onChange={(e) => setNewSpec(e.target.value)}
                      placeholder="예: M10"
                      className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-500 mb-1">
                      구분
                    </label>
                    <select
                      value={newKind}
                      onChange={(e) => setNewKind(e.target.value as ItemKind)}
                      className="w-full px-2.5 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 cursor-pointer"
                    >
                      <option value="RAW">원자재</option>
                      <option value="INTERMEDIATE">중간제품</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-500 mb-1">
                      단위
                    </label>
                    <select
                      value={newUnit}
                      onChange={(e) => setNewUnit(e.target.value)}
                      className="w-full px-2.5 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 cursor-pointer"
                    >
                      <option value="EA">EA</option>
                      <option value="SET">SET</option>
                      <option value="KG">KG</option>
                      <option value="M">M</option>
                      <option value="BOX">BOX</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-500 mb-1">
                      초기 재고
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={newInitialStock}
                      onChange={(e) => setNewInitialStock(e.target.value)}
                      className="w-full px-3 py-2 text-sm font-mono font-bold text-right rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-500 mb-1">
                      최소 적정 재고
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={newMinStock}
                      onChange={(e) => setNewMinStock(e.target.value)}
                      className="w-full px-3 py-2 text-sm font-mono font-bold text-right rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                    />
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row gap-2.5">
                  <input
                    type="text"
                    value={newNotes}
                    onChange={(e) => setNewNotes(e.target.value)}
                    placeholder="비고 / 용도 메모 (선택)"
                    className="flex-1 px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                  />
                  <button
                    type="submit"
                    className="px-5 py-2 rounded-lg text-sm font-bold bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 text-white flex items-center justify-center space-x-1.5 cursor-pointer shrink-0"
                  >
                    <Plus size={16} />
                    <span>자재 등록하기</span>
                  </button>
                </div>
              </form>
            )}

            {/* 필터 바 */}
            <div className="flex flex-wrap items-center justify-between gap-2.5 pt-3 border-t border-slate-150 dark:border-slate-800">
              <div className="flex flex-wrap items-center gap-1.5">
                {(['ALL', 'RAW', 'INTERMEDIATE', 'FINAL'] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setKindFilter(k)}
                    className={`px-3 py-1.5 text-xs font-bold rounded-lg transition cursor-pointer ${
                      kindFilter === k
                        ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                        : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 hover:bg-slate-200'
                    }`}
                  >
                    {k === 'ALL' ? '전체' : KIND_LABELS[k]}
                  </button>
                ))}
              </div>

              <div className="relative">
                <Search
                  size={14}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="자재명, 규격 검색..."
                  className="pl-8 pr-3 py-1.5 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 outline-none focus:bg-white"
                />
              </div>
            </div>
          </div>

          {/* 재고 테이블 */}
          <div className="bg-white dark:bg-[#1E232D] border border-slate-200/90 dark:border-slate-800 rounded-xl shadow-2xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[900px]">
                <thead className="bg-slate-50 dark:bg-slate-800/80 text-xs font-bold text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
                  <tr>
                    <th className="py-3 px-4 w-24">구분</th>
                    <th className="py-3 px-4">품목명</th>
                    <th className="py-3 px-3">규격</th>
                    <th className="py-3 px-3 text-right">현재 재고</th>
                    <th className="py-3 px-3 text-right">입고 누계</th>
                    <th className="py-3 px-3 text-right">사용 누계</th>
                    <th className="py-3 px-3 text-right">추가 필요</th>
                    <th className="py-3 px-3 text-center">상태</th>
                    <th className="py-3 px-4">비고</th>
                    <th className="py-3 px-4 text-center w-32">관리</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-150 dark:divide-slate-800 text-sm">
                  {filteredItems.map((item) => {
                    const shortage = shortageMap.get(item.id) || 0;
                    const isFinal = item.kind === 'FINAL';
                    const isEditing = editingId === item.id;
                    const status = isFinal
                      ? 'FINAL'
                      : item.currentStock <= 0 || shortage > 0
                      ? 'SHORTAGE'
                      : item.currentStock < item.minimumStock
                      ? 'WARNING'
                      : 'SUFFICIENT';

                    return (
                      <tr
                        key={item.id}
                        className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                      >
                        <td className="py-3 px-4 text-xs font-semibold text-slate-500 dark:text-slate-400">
                          {KIND_LABELS[item.kind]}
                        </td>
                        <td className="py-3 px-4 font-bold text-slate-900 dark:text-slate-100">
                          {isEditing ? (
                            <input
                              type="text"
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              className="w-full px-2 py-1 text-sm rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800"
                            />
                          ) : (
                            item.name
                          )}
                        </td>
                        <td className="py-3 px-3 font-mono text-xs text-slate-600 dark:text-slate-400">
                          {isEditing ? (
                            <input
                              type="text"
                              value={editSpec}
                              onChange={(e) => setEditSpec(e.target.value)}
                              className="w-24 px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800"
                            />
                          ) : (
                            item.specification || '-'
                          )}
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums font-black text-base text-slate-900 dark:text-white">
                          {formatNum(item.currentStock)}{' '}
                          <span className="text-xs font-normal text-slate-400">{item.unit}</span>
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                          {formatNum(item.totalInbound)}
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400">
                          {formatNum(item.totalUsed)}
                        </td>
                        <td
                          className={`py-3 px-3 text-right font-mono tabular-nums font-bold ${
                            shortage > 0
                              ? 'text-rose-600 dark:text-rose-400'
                              : 'text-slate-400'
                          }`}
                        >
                          {shortage > 0 ? formatNum(shortage) : '-'}
                        </td>
                        <td className="py-3 px-3 text-center">
                          {status === 'FINAL' && (
                            <span className="inline-flex px-2 py-0.5 rounded text-xs font-bold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                              완제품
                            </span>
                          )}
                          {status === 'SHORTAGE' && (
                            <span className="inline-flex px-2 py-0.5 rounded text-xs font-bold bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300">
                              부족
                            </span>
                          )}
                          {status === 'WARNING' && (
                            <span className="inline-flex px-2 py-0.5 rounded text-xs font-bold bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">
                              주의
                            </span>
                          )}
                          {status === 'SUFFICIENT' && (
                            <span className="inline-flex px-2 py-0.5 rounded text-xs font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                              정상
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-xs text-slate-500 dark:text-slate-400 max-w-[200px] truncate">
                          {isEditing ? (
                            <input
                              type="text"
                              value={editNotes}
                              onChange={(e) => setEditNotes(e.target.value)}
                              className="w-full px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800"
                            />
                          ) : (
                            item.notes || '-'
                          )}
                        </td>
                        <td className="py-3 px-4 text-center">
                          {isEditing ? (
                            <div className="flex items-center justify-center space-x-1">
                              <button
                                type="button"
                                onClick={() => saveEdit(item.id)}
                                className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded cursor-pointer"
                                title="저장"
                              >
                                <Check size={15} />
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingId(null)}
                                className="p-1.5 text-slate-400 hover:bg-slate-100 rounded cursor-pointer"
                                title="취소"
                              >
                                <X size={15} />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-center space-x-1">
                              <button
                                type="button"
                                onClick={() => openAdjustModal(item)}
                                className="px-2 py-1 text-[11px] font-bold rounded bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 inline-flex items-center space-x-1 cursor-pointer"
                                title="실물 재고 수량 직접 조정"
                              >
                                <SlidersHorizontal size={12} />
                                <span>조정</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => startEdit(item)}
                                className="p-1.5 text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 rounded hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                                title="이름/규격/메모 수정"
                              >
                                <Edit3 size={14} />
                              </button>
                              {item.kind !== 'FINAL' && (
                                <button
                                  type="button"
                                  onClick={() => setDeleteTarget(item)}
                                  className="p-1.5 text-slate-400 hover:text-rose-600 rounded hover:bg-rose-50 dark:hover:bg-rose-950/30 cursor-pointer"
                                  title="자재 삭제"
                                >
                                  <Trash2 size={14} />
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 빠른 재고 실사 조정 모달 */}
      {adjustTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/45 backdrop-blur-[1px]">
          <form
            onSubmit={handleConfirmAdjust}
            className="w-full max-w-md bg-white dark:bg-[#1E232D] border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                재고 수량 직접 조정 ({adjustTarget.name})
              </h3>
              <button
                type="button"
                onClick={() => setAdjustTarget(null)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 flex justify-between text-xs">
                <span className="text-slate-500">현재 전산 재고</span>
                <span className="font-mono font-bold text-slate-900 dark:text-white">
                  {formatNum(adjustTarget.currentStock)} {adjustTarget.unit}
                </span>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  변경 후 실제 재고 ({adjustTarget.unit})
                </label>
                <input
                  type="number"
                  min="0"
                  required
                  autoFocus
                  value={adjustAfterQty}
                  onChange={(e) => setAdjustAfterQty(e.target.value)}
                  className="w-full px-3 py-2 text-lg font-mono font-black text-right rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  조정 사유
                </label>
                <input
                  type="text"
                  required
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                />
              </div>
            </div>
            <div className="px-5 py-3.5 bg-slate-50 dark:bg-slate-800/60 border-t border-slate-150 dark:border-slate-800 flex justify-end space-x-2">
              <button
                type="button"
                onClick={() => setAdjustTarget(null)}
                className="px-4 py-2 text-sm font-semibold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 cursor-pointer"
              >
                취소
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-sm font-bold rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 text-white cursor-pointer"
              >
                재고 조정 반영
              </button>
            </div>
          </form>
        </div>
      )}

      <ConfirmModal
        isOpen={Boolean(deleteTarget)}
        title="자재 삭제"
        description={
          deleteTarget
            ? `[${deleteTarget.name} (${deleteTarget.specification || '-'})] 자재를 목록에서 삭제하시겠습니까?\n연결된 BOM 항목도 함께 정리됩니다.`
            : ''
        }
        confirmLabel="삭제"
        onConfirm={() => {
          if (deleteTarget) {
            onDeleteMaterial(deleteTarget.id);
            showToast(`[${deleteTarget.name}] 자재가 삭제되었습니다.`);
            setDeleteTarget(null);
          }
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
};
