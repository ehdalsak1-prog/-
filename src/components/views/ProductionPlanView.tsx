import React, { useState } from 'react';
import { Target, Check, FileSpreadsheet, Edit3, X } from 'lucide-react';
import { ErpAppState } from '../../types/erp';
import { calculateDashboardSummary, formatNum, formatPercent } from '../../utils/erpCalculator';

interface ProductionPlanViewProps {
  state: ErpAppState;
  onUpdateTarget: (productId: string, newTarget: number) => void;
  onUpdateProductName: (productId: string, newName: string) => void;
  onExportPlan: () => void;
}

export const ProductionPlanView: React.FC<ProductionPlanViewProps> = ({
  state,
  onUpdateTarget,
  onUpdateProductName,
  onExportPlan,
}) => {
  const summary = calculateDashboardSummary(state);
  const allStats = [...summary.finalProductStats, ...summary.intermediateProductStats];
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const handleTargetChange = (productId: string, valStr: string) => {
    const val = parseInt(valStr.replace(/,/g, ''), 10);
    const clean = isNaN(val) || val < 0 ? 0 : val;
    onUpdateTarget(productId, clean);
    setSavedNotice('목표 수량이 실시간 반영되었습니다.');
    setTimeout(() => setSavedNotice(null), 1800);
  };

  const startEditName = (productId: string, currentName: string) => {
    setEditingId(productId);
    setEditName(currentName);
  };

  const saveEditName = (productId: string) => {
    if (editName.trim()) {
      onUpdateProductName(productId, editName.trim());
      setSavedNotice('제품명이 수정되었습니다.');
      setTimeout(() => setSavedNotice(null), 1800);
    }
    setEditingId(null);
  };

  return (
    <div className="space-y-5">
      <div className="bg-white dark:bg-[#1E232D] border border-slate-200/90 dark:border-slate-800 rounded-xl p-5 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 flex items-center justify-center">
            <Target size={20} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
              제품별 생산 계획 및 목표 관리
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
              제품명과 목표 수량을 수정하면 전체 현황 및 자재 필요량이 즉시 재계산됩니다.
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          {savedNotice && (
            <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 inline-flex items-center space-x-1">
              <Check size={14} />
              <span>{savedNotice}</span>
            </span>
          )}
          <button
            type="button"
            onClick={onExportPlan}
            className="px-3.5 py-2 text-xs font-bold rounded-lg border border-slate-250 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-200 flex items-center space-x-1.5 cursor-pointer"
          >
            <FileSpreadsheet size={15} className="text-emerald-600 dark:text-emerald-400" />
            <span>엑셀 다운로드</span>
          </button>
        </div>
      </div>

      {/* 완제품 총괄 요약 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="bg-white dark:bg-[#1E232D] border border-slate-200/90 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500 font-bold">완제품 합계 목표</div>
          <div className="text-2xl font-black font-mono tabular-nums text-slate-900 dark:text-white mt-1">
            {formatNum(summary.totalFinalTarget)} <span className="text-xs font-normal text-slate-400">EA</span>
          </div>
        </div>
        <div className="bg-white dark:bg-[#1E232D] border border-slate-200/90 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500 font-bold">완제품 완료</div>
          <div className="text-2xl font-black font-mono tabular-nums text-emerald-600 dark:text-emerald-400 mt-1">
            {formatNum(summary.totalFinalCompleted)} <span className="text-xs font-normal text-slate-400">EA</span>
          </div>
        </div>
        <div className="bg-white dark:bg-[#1E232D] border border-slate-200/90 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500 font-bold">완제품 잔여</div>
          <div className="text-2xl font-black font-mono tabular-nums text-slate-900 dark:text-white mt-1">
            {formatNum(summary.totalFinalRemaining)} <span className="text-xs font-normal text-slate-400">EA</span>
          </div>
        </div>
        <div className="bg-white dark:bg-[#1E232D] border border-slate-200/90 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500 font-bold">전체 진행률</div>
          <div className="text-2xl font-black font-mono tabular-nums text-slate-900 dark:text-white mt-1">
            {formatPercent(summary.overallProgressPercent)}%
          </div>
        </div>
      </div>

      {/* 제품별 목표 테이블 */}
      <div className="bg-white dark:bg-[#1E232D] border border-slate-200/90 dark:border-slate-800 rounded-xl shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[700px]">
            <thead className="bg-slate-50 dark:bg-slate-800/80 text-xs font-bold text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th className="py-3 px-4 w-28">구분</th>
                <th className="py-3 px-4">제품명 (수정 가능)</th>
                <th className="py-3 px-4 text-right w-44">목표 수량 (직접 입력)</th>
                <th className="py-3 px-4 text-right w-32">완료 수량</th>
                <th className="py-3 px-4 text-right w-32">잔여 수량</th>
                <th className="py-3 px-4 w-44">진행률</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-150 dark:divide-slate-800 text-sm">
              {allStats.map((s) => {
                const isEditing = editingId === s.product.id;
                return (
                  <tr
                    key={s.product.id}
                    className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                  >
                    <td className="py-3.5 px-4">
                      <span
                        className={`text-xs font-bold px-2 py-0.5 rounded ${
                          s.product.category === 'FINAL'
                            ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                            : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                        }`}
                      >
                        {s.product.category === 'FINAL' ? '완제품' : '중간제품'}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 font-bold text-slate-900 dark:text-slate-100">
                      {isEditing ? (
                        <div className="flex items-center space-x-1.5">
                          <input
                            type="text"
                            autoFocus
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveEditName(s.product.id);
                              if (e.key === 'Escape') setEditingId(null);
                            }}
                            className="px-2.5 py-1 text-sm font-bold rounded-lg border border-slate-400 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                          />
                          <button
                            type="button"
                            onClick={() => saveEditName(s.product.id)}
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
                        <div className="flex items-center space-x-2">
                          <span>{s.product.productName}</span>
                          <button
                            type="button"
                            onClick={() => startEditName(s.product.id, s.product.productName)}
                            className="p-1 text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 rounded hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                            title="제품명 수정"
                          >
                            <Edit3 size={14} />
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <div className="flex items-center justify-end space-x-1.5">
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={s.product.targetQuantity}
                          onChange={(e) => handleTargetChange(s.product.id, e.target.value)}
                          className="w-28 px-2.5 py-1.5 text-base font-extrabold font-mono text-right rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 outline-none focus:border-slate-500"
                        />
                        <span className="text-xs font-bold text-slate-400">EA</span>
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums font-bold text-emerald-600 dark:text-emerald-400 text-base">
                      {formatNum(s.completedQty)}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums font-bold text-slate-900 dark:text-white text-base">
                      {formatNum(s.remainingQty)}
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="flex items-center space-x-2">
                        <div className="flex-1 h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-emerald-600 dark:bg-emerald-500 rounded-full"
                            style={{ width: `${Math.min(100, s.progressPercent)}%` }}
                          />
                        </div>
                        <span className="text-xs font-mono font-bold text-slate-700 dark:text-slate-300 w-12 text-right">
                          {formatPercent(s.progressPercent)}%
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
