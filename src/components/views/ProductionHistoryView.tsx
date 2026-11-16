import React, { useMemo, useState } from 'react';
import {
  Search,
  Trash2,
  Edit3,
  FileSpreadsheet,
  Printer,
  ChevronLeft,
  ChevronRight,
  X,
} from 'lucide-react';
import { ActiveTab, ErpAppState, ProductionRecord } from '../../types/erp';
import { formatNum } from '../../utils/erpCalculator';
import { ConfirmModal } from '../common/ConfirmModal';

interface ProductionHistoryViewProps {
  state: ErpAppState;
  onCancelProduction: (recordId: string) => void;
  onUpdateProduction: (
    recordId: string,
    updates: {
      productionDate: string;
      quantity: number;
      worker: string;
      manager: string;
      note: string;
    }
  ) => { ok: true } | { ok: false; error: string };
  onNavigate: (tab: ActiveTab) => void;
  onExportProduction: () => void;
}

const PAGE_SIZE = 12;

export const ProductionHistoryView: React.FC<ProductionHistoryViewProps> = ({
  state,
  onCancelProduction,
  onUpdateProduction,
  onNavigate,
  onExportProduction,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [productFilter, setProductFilter] = useState('ALL');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);

  const [cancelTarget, setCancelTarget] = useState<ProductionRecord | null>(null);
  const [editTarget, setEditTarget] = useState<ProductionRecord | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editQty, setEditQty] = useState('');
  const [editWorker, setEditWorker] = useState('');
  const [editManager, setEditManager] = useState('');
  const [editNote, setEditNote] = useState('');
  const [editError, setEditError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return [...state.productionRecords]
      .sort((a, b) => {
        const cmp = b.productionDate.localeCompare(a.productionDate);
        return cmp !== 0 ? cmp : b.createdAt.localeCompare(a.createdAt);
      })
      .filter((r) => {
        if (productFilter !== 'ALL' && r.productId !== productFilter) return false;
        if (dateFrom && r.productionDate < dateFrom) return false;
        if (dateTo && r.productionDate > dateTo) return false;
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          return (
            r.productName.toLowerCase().includes(q) ||
            r.worker.toLowerCase().includes(q) ||
            r.manager.toLowerCase().includes(q) ||
            (r.note && r.note.toLowerCase().includes(q))
          );
        }
        return true;
      });
  }, [state.productionRecords, productFilter, dateFrom, dateTo, searchQuery]);

  // 완제품 누계 & 목표 잔량 계산 (날짜 오름차순 기준)
  const totalFilteredQty = useMemo(
    () => filtered.reduce((sum, r) => sum + r.quantity, 0),
    [filtered]
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const openEditModal = (rec: ProductionRecord) => {
    setEditTarget(rec);
    setEditDate(rec.productionDate);
    setEditQty(String(rec.quantity));
    setEditWorker(rec.worker);
    setEditManager(rec.manager);
    setEditNote(rec.note);
    setEditError(null);
  };

  const handleSaveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTarget) return;
    const qty = parseInt(editQty.replace(/,/g, ''), 10);
    if (isNaN(qty) || qty <= 0) {
      setEditError('생산 수량은 1 이상의 정수를 입력해 주세요.');
      return;
    }
    const res = onUpdateProduction(editTarget.id, {
      productionDate: editDate,
      quantity: qty,
      worker: editWorker,
      manager: editManager,
      note: editNote,
    });
    if (res.ok) {
      setEditTarget(null);
    } else {
      setEditError(res.error);
    }
  };

  return (
    <div className="space-y-4">
      {/* 상단 필터 및 액션 바 */}
      <div className="bg-white dark:bg-[#1E232D] border border-slate-200/90 dark:border-slate-800 rounded-xl p-4 sm:p-5 shadow-2xs space-y-3.5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
              생산 실적 이력
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              생산 취소 또는 수량 수정 시 해당 생산에서 차감되었던 자재 재고가 자동으로 복원 및 재계산됩니다.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-250 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-200 flex items-center space-x-1 cursor-pointer"
            >
              <Printer size={14} />
              <span>인쇄</span>
            </button>
            <button
              type="button"
              onClick={onExportProduction}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-250 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-200 flex items-center space-x-1 cursor-pointer"
            >
              <FileSpreadsheet size={14} className="text-emerald-600 dark:text-emerald-400" />
              <span>엑셀 다운로드</span>
            </button>
          </div>
        </div>

        {/* 검색 및 필터 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 pt-3 border-t border-slate-150 dark:border-slate-800">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              placeholder="제품, 작업자, 비고 검색..."
              className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 outline-none focus:bg-white focus:border-slate-400"
            />
          </div>

          <select
            value={productFilter}
            onChange={(e) => {
              setProductFilter(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-medium outline-none cursor-pointer"
          >
            <option value="ALL">전체 제품</option>
            {state.products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.productName}
              </option>
            ))}
          </select>

          <input
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 outline-none"
            title="시작일"
          />

          <input
            type="date"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 outline-none"
            title="종료일"
          />
        </div>
      </div>

      {/* 테이블 */}
      <div className="bg-white dark:bg-[#1E232D] border border-slate-200/90 dark:border-slate-800 rounded-xl shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[820px]">
            <thead className="bg-slate-50 dark:bg-slate-800/80 text-xs font-bold text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th className="py-3 px-4 w-32">생산일자</th>
                <th className="py-3 px-4">생산 제품</th>
                <th className="py-3 px-3 text-right w-32">생산수량</th>
                <th className="py-3 px-4">작업자 / 담당</th>
                <th className="py-3 px-4">차감된 자재 내역</th>
                <th className="py-3 px-4">비고</th>
                <th className="py-3 px-4 text-center w-24">관리</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-150 dark:divide-slate-800 text-sm">
              {paginated.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    조건에 해당하는 생산 실적이 없습니다.
                  </td>
                </tr>
              ) : (
                paginated.map((rec) => (
                  <tr
                    key={rec.id}
                    className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                  >
                    <td className="py-3 px-4 font-mono font-bold text-slate-700 dark:text-slate-300">
                      {rec.productionDate}
                    </td>
                    <td className="py-3 px-4 font-bold text-slate-900 dark:text-slate-100">
                      {rec.productName}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums font-extrabold text-emerald-700 dark:text-emerald-400 text-base">
                      {formatNum(rec.quantity)} <span className="text-xs font-normal text-slate-400">EA</span>
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-600 dark:text-slate-300">
                      {rec.worker} / {rec.manager}
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-600 dark:text-slate-400">
                      {rec.consumedItems.length > 0
                        ? rec.consumedItems
                            .map((c) => `${c.itemName} -${formatNum(c.quantity)}`)
                            .join(', ')
                        : '-'}
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-600 dark:text-slate-400">
                      {rec.note || '-'}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <div className="flex items-center justify-center space-x-1">
                        <button
                          type="button"
                          onClick={() => openEditModal(rec)}
                          className="p-1.5 text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 rounded hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                          title="수량/일자 수정"
                        >
                          <Edit3 size={15} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setCancelTarget(rec)}
                          className="p-1.5 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 rounded hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
                          title="생산 취소 (자재 복원)"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot className="bg-slate-50 dark:bg-slate-800/70 border-t border-slate-200 dark:border-slate-700 text-sm font-bold">
              <tr>
                <td colSpan={2} className="py-3 px-4 text-slate-800 dark:text-slate-200">
                  검색 결과 합계 ({filtered.length}건)
                </td>
                <td className="py-3 px-3 text-right font-mono tabular-nums text-base font-black text-slate-900 dark:text-white">
                  {formatNum(totalFilteredQty)} EA
                </td>
                <td colSpan={4} className="py-3 px-4 text-xs font-normal text-slate-500">
                  * 페이지 {safePage} / {totalPages}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* 페이지네이션 */}
        {totalPages > 1 && (
          <div className="px-4 py-3 border-t border-slate-150 dark:border-slate-800 flex items-center justify-between text-xs">
            <span className="text-slate-500">
              총 {filtered.length}건 중 {(safePage - 1) * PAGE_SIZE + 1}–
              {Math.min(safePage * PAGE_SIZE, filtered.length)}건 표시
            </span>
            <div className="flex items-center space-x-1">
              <button
                type="button"
                disabled={safePage <= 1}
                onClick={() => setPage(safePage - 1)}
                className="p-1.5 rounded border border-slate-250 dark:border-slate-700 disabled:opacity-30 cursor-pointer"
              >
                <ChevronLeft size={14} />
              </button>
              <span className="px-2.5 font-mono font-bold">
                {safePage} / {totalPages}
              </span>
              <button
                type="button"
                disabled={safePage >= totalPages}
                onClick={() => setPage(safePage + 1)}
                className="p-1.5 rounded border border-slate-250 dark:border-slate-700 disabled:opacity-30 cursor-pointer"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 취소 확인 모달 */}
      <ConfirmModal
        isOpen={Boolean(cancelTarget)}
        title="생산 기록 취소 및 자재 복원"
        description={
          cancelTarget
            ? `${cancelTarget.productionDate} [${cancelTarget.productName}] ${formatNum(
                cancelTarget.quantity
              )} EA 생산 기록을 취소하시겠습니까?\n\n차감되었던 자재(${cancelTarget.consumedItems
                .map((c) => `${c.itemName} ${formatNum(c.quantity)}${c.unit}`)
                .join(', ')})가 즉시 현재 재고로 복원됩니다.`
            : ''
        }
        confirmLabel="생산 취소 및 재고 복원"
        onConfirm={() => {
          if (cancelTarget) {
            onCancelProduction(cancelTarget.id);
            setCancelTarget(null);
          }
        }}
        onCancel={() => setCancelTarget(null)}
      />

      {/* 수정 모달 */}
      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 backdrop-blur-[2px] p-4">
          <form
            onSubmit={handleSaveEdit}
            className="bg-white dark:bg-[#1E232D] border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg max-w-md w-full overflow-hidden"
          >
            <div className="flex items-center justify-between p-4 border-b border-slate-150 dark:border-slate-800">
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                생산 실적 수정 ({editTarget.productName})
              </h3>
              <button
                type="button"
                onClick={() => setEditTarget(null)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1">
                    생산일자
                  </label>
                  <input
                    type="date"
                    required
                    value={editDate}
                    onChange={(e) => setEditDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1">
                    생산수량 (EA)
                  </label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={editQty}
                    onChange={(e) => setEditQty(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono font-bold text-right rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1">
                    작업자
                  </label>
                  <input
                    type="text"
                    value={editWorker}
                    onChange={(e) => setEditWorker(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1">
                    담당자
                  </label>
                  <input
                    type="text"
                    value={editManager}
                    onChange={(e) => setEditManager(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1">
                  비고
                </label>
                <input
                  type="text"
                  value={editNote}
                  onChange={(e) => setEditNote(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                />
              </div>

              {editError && (
                <div className="p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 text-xs font-bold text-rose-700 dark:text-rose-300">
                  {editError}
                </div>
              )}
            </div>

            <div className="px-5 py-3.5 bg-slate-50 dark:bg-slate-800/60 border-t border-slate-150 dark:border-slate-800 flex justify-end space-x-2">
              <button
                type="button"
                onClick={() => setEditTarget(null)}
                className="px-4 py-2 text-sm font-semibold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 cursor-pointer"
              >
                취소
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-sm font-bold rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 text-white cursor-pointer"
              >
                수정 반영
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
