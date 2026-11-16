import React, { useMemo, useState } from 'react';
import { Search, FileSpreadsheet, BookOpen } from 'lucide-react';
import { ErpAppState, TransactionType } from '../../types/erp';
import { formatNum } from '../../utils/erpCalculator';

interface LedgerViewProps {
  state: ErpAppState;
  onExportLedger: () => void;
}

const TX_LABELS: Record<TransactionType, { label: string; style: string }> = {
  RECEIPT: {
    label: '자재 입고',
    style: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300',
  },
  PRODUCTION_USE: {
    label: '생산 사용',
    style: 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300',
  },
  PRODUCTION_OUTPUT: {
    label: '생산 완료',
    style: 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200',
  },
  PRODUCTION_CANCEL: {
    label: '생산 취소',
    style: 'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300',
  },
  ADJUSTMENT: {
    label: '재고 조정',
    style: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  },
};

export const LedgerView: React.FC<LedgerViewProps> = ({ state, onExportLedger }) => {
  const [itemFilter, setItemFilter] = useState('ALL');
  const [typeFilter, setTypeFilter] = useState<'ALL' | TransactionType>('ALL');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    return [...state.transactions]
      .sort((a, b) => {
        const cmp = b.transactionDate.localeCompare(a.transactionDate);
        return cmp !== 0 ? cmp : b.createdAt.localeCompare(a.createdAt);
      })
      .filter((t) => {
        if (itemFilter !== 'ALL' && t.itemId !== itemFilter) return false;
        if (typeFilter !== 'ALL' && t.transactionType !== typeFilter) return false;
        if (search.trim()) {
          const q = search.toLowerCase();
          return (
            t.itemName.toLowerCase().includes(q) ||
            t.worker.toLowerCase().includes(q) ||
            t.note.toLowerCase().includes(q)
          );
        }
        return true;
      });
  }, [state.transactions, itemFilter, typeFilter, search]);

  return (
    <div className="space-y-4">
      <div className="bg-white dark:bg-[#1E232D] border border-slate-200/90 dark:border-slate-800 rounded-xl p-4 sm:p-5 shadow-2xs space-y-3.5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 flex items-center justify-center">
              <BookOpen size={18} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                자재 재고 수불부 (거래 이력)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                입고, 생산 사용, 생산 완료, 취소 복원 및 실사 조정 등 모든 재고 변동 내역을 추적합니다.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onExportLedger}
            className="px-3.5 py-2 text-xs font-bold rounded-lg border border-slate-250 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 text-slate-700 dark:text-slate-200 flex items-center space-x-1.5 cursor-pointer self-start sm:self-auto"
          >
            <FileSpreadsheet size={15} className="text-emerald-600 dark:text-emerald-400" />
            <span>수불부 엑셀</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-3 border-t border-slate-150 dark:border-slate-800">
          <select
            value={itemFilter}
            onChange={(e) => setItemFilter(e.target.value)}
            className="px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-medium cursor-pointer"
          >
            <option value="ALL">전체 자재 · 제품</option>
            {state.items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name} {i.specification ? `(${i.specification})` : ''}
              </option>
            ))}
          </select>

          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as any)}
            className="px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-medium cursor-pointer"
          >
            <option value="ALL">전체 구분</option>
            <option value="RECEIPT">자재 입고</option>
            <option value="PRODUCTION_USE">생산 사용</option>
            <option value="PRODUCTION_OUTPUT">생산 완료</option>
            <option value="PRODUCTION_CANCEL">생산 취소</option>
            <option value="ADJUSTMENT">재고 조정</option>
          </select>

          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="작업자, 비고 내용 검색..."
              className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 outline-none focus:bg-white"
            />
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-[#1E232D] border border-slate-200/90 dark:border-slate-800 rounded-xl shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[820px]">
            <thead className="bg-slate-50 dark:bg-slate-800/80 text-xs font-bold text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th className="py-3 px-4 w-28">날짜</th>
                <th className="py-3 px-4">품목</th>
                <th className="py-3 px-3 w-28">구분</th>
                <th className="py-3 px-3 text-right w-28">입고(+)</th>
                <th className="py-3 px-3 text-right w-28">사용(-)</th>
                <th className="py-3 px-3 text-right w-28">변동후 잔고</th>
                <th className="py-3 px-3 w-28">작업자</th>
                <th className="py-3 px-4">비고</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-150 dark:divide-slate-800 text-sm">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    표시할 수불 내역이 없습니다.
                  </td>
                </tr>
              ) : (
                filtered.map((t) => {
                  const meta = TX_LABELS[t.transactionType];
                  return (
                    <tr
                      key={t.id}
                      className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="py-3 px-4 font-mono text-xs font-bold text-slate-600 dark:text-slate-300">
                        {t.transactionDate}
                      </td>
                      <td className="py-3 px-4 font-bold text-slate-900 dark:text-slate-100">
                        {t.itemName}
                      </td>
                      <td className="py-3 px-3">
                        <span className={`inline-flex px-2 py-0.5 rounded text-xs font-bold ${meta.style}`}>
                          {meta.label}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums font-bold text-emerald-600 dark:text-emerald-400">
                        {t.quantityChange > 0 ? `+${formatNum(t.quantityChange)}` : '-'}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums font-bold text-rose-600 dark:text-rose-400">
                        {t.quantityChange < 0 ? formatNum(Math.abs(t.quantityChange)) : '-'}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums font-extrabold text-slate-900 dark:text-white">
                        {formatNum(t.balanceAfter)}
                      </td>
                      <td className="py-3 px-3 text-xs text-slate-600 dark:text-slate-400">
                        {t.worker}
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-600 dark:text-slate-400">
                        {t.note || '-'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
