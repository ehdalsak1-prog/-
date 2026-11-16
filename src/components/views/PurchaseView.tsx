import React, { useMemo, useState } from 'react';
import { ShoppingCart, ClipboardCopy, Check, FileSpreadsheet } from 'lucide-react';
import { ErpAppState } from '../../types/erp';
import {
  calculateDashboardSummary,
  calculatePurchaseRequirements,
  formatNum,
} from '../../utils/erpCalculator';

interface PurchaseViewProps {
  state: ErpAppState;
  onExportPurchase: () => void;
}

export const PurchaseView: React.FC<PurchaseViewProps> = ({ state, onExportPurchase }) => {
  const [mode, setMode] = useState<'NET_REMAINING' | 'GROSS_TARGET'>('NET_REMAINING');
  const [copied, setCopied] = useState(false);

  const summary = useMemo(() => calculateDashboardSummary(state), [state]);
  const rows = useMemo(() => calculatePurchaseRequirements(state), [state]);

  const handleCopy = () => {
    const header =
      mode === 'GROSS_TARGET'
        ? '자재명\t규격\t단위\t전체 목표 총소요량\t기사용 누계\t현재 재고\t추가 구매 필요량'
        : '자재명\t규격\t단위\t잔여 생산 실소요량\t현재 재고\t추가 구매 필요량';

    const lines = rows.map((r) => {
      if (mode === 'GROSS_TARGET') {
        return `${r.item.name}\t${r.item.specification}\t${r.item.unit}\t${r.grossTargetNeed}\t${r.item.totalUsed}\t${r.currentStock}\t${r.grossPurchaseShortage}`;
      }
      return `${r.item.name}\t${r.item.specification}\t${r.item.unit}\t${r.netRemainingNeed}\t${r.currentStock}\t${r.netPurchaseShortage}`;
    });

    navigator.clipboard.writeText([header, ...lines].join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-5">
      {/* 상단 컨트롤 & 모드 설명 */}
      <div className="bg-white dark:bg-[#1E232D] border border-slate-200/90 dark:border-slate-800 rounded-xl p-5 shadow-2xs space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 flex items-center justify-center shrink-0">
              <ShoppingCart size={20} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                추가 구매(발주) 필요량 산출표
              </h2>
              <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                전체 목표 <strong>{formatNum(summary.totalFinalTarget)} EA</strong> (잔여{' '}
                <strong>{formatNum(summary.totalFinalRemaining)} EA</strong>) 기준 다단계 BOM 전개 소요량 및 부족 수량입니다.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="px-3 py-2 text-xs font-bold rounded-lg border border-slate-250 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 text-slate-700 dark:text-slate-200 flex items-center space-x-1.5 cursor-pointer"
            >
              {copied ? (
                <>
                  <Check size={14} className="text-emerald-600" />
                  <span>표 복사됨</span>
                </>
              ) : (
                <>
                  <ClipboardCopy size={14} />
                  <span>엑셀용 복사</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={onExportPurchase}
              className="px-3.5 py-2 text-xs font-bold rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 text-white flex items-center space-x-1.5 cursor-pointer"
            >
              <FileSpreadsheet size={15} />
              <span>엑셀 다운로드</span>
            </button>
          </div>
        </div>

        {/* 계산 기준 전환 버튼 */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-150 dark:border-slate-800">
          <div className="inline-flex p-1 rounded-lg bg-slate-100 dark:bg-slate-800">
            <button
              type="button"
              onClick={() => setMode('GROSS_TARGET')}
              className={`px-3.5 py-1.5 text-xs font-bold rounded-md transition cursor-pointer ${
                mode === 'GROSS_TARGET'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              전체 목표 기준 (총 {formatNum(summary.totalFinalTarget)} EA 산출)
            </button>
            <button
              type="button"
              onClick={() => setMode('NET_REMAINING')}
              className={`px-3.5 py-1.5 text-xs font-bold rounded-md transition cursor-pointer ${
                mode === 'NET_REMAINING'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              잔여 생산 실소요 기준 (남은 {formatNum(summary.totalFinalRemaining)} EA 반영)
            </button>
          </div>

          <div className="text-xs text-slate-500 dark:text-slate-400">
            {mode === 'GROSS_TARGET'
              ? '* 볼트·너트는 하부베이스(×4) + 클램프(×4) 합산으로 11,000 EA 기준 각 88,000 EA 총 소요량으로 계산됩니다.'
              : '* 이미 조립 완료된 분과 현재 보유 중인 하부베이스·클램프 재고를 차감한 실제 남은 제작분 기준 필요량입니다.'}
          </div>
        </div>
      </div>

      {/* 산출 결과 테이블 */}
      <div className="bg-white dark:bg-[#1E232D] border border-slate-200/90 dark:border-slate-800 rounded-xl shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[820px]">
            <thead className="bg-slate-50 dark:bg-slate-800/80 text-xs font-bold text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th className="py-3 px-4 w-24">구분</th>
                <th className="py-3 px-4">자재명</th>
                <th className="py-3 px-3">규격</th>
                <th className="py-3 px-3 text-right">
                  {mode === 'GROSS_TARGET' ? '총 목표 필요량' : '잔여 생산 실소요'}
                </th>
                <th className="py-3 px-3 text-right">기존 사용 누계</th>
                <th className="py-3 px-3 text-right">현재 보유 재고</th>
                <th className="py-3 px-4 text-right">추가 발주 필요량</th>
                <th className="py-3 px-4 text-center">상태</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-150 dark:divide-slate-800 text-sm">
              {rows.map((r) => {
                const required =
                  mode === 'GROSS_TARGET' ? r.grossTargetNeed : r.netRemainingNeed;
                const shortage =
                  mode === 'GROSS_TARGET'
                    ? r.grossPurchaseShortage
                    : r.netPurchaseShortage;

                return (
                  <tr
                    key={r.item.id}
                    className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                  >
                    <td className="py-3.5 px-4 text-xs font-semibold text-slate-500">
                      {r.item.kind === 'RAW' ? '원자재' : '중간제품'}
                    </td>
                    <td className="py-3.5 px-4 font-bold text-slate-900 dark:text-slate-100">
                      {r.item.name}
                    </td>
                    <td className="py-3.5 px-3 font-mono text-xs text-slate-500">
                      {r.item.specification || '-'}
                    </td>
                    <td className="py-3.5 px-3 text-right font-mono tabular-nums font-bold text-slate-900 dark:text-white text-base">
                      {formatNum(required)}{' '}
                      <span className="text-xs font-normal text-slate-400">{r.item.unit}</span>
                    </td>
                    <td className="py-3.5 px-3 text-right font-mono tabular-nums text-slate-500">
                      {formatNum(r.item.totalUsed)}
                    </td>
                    <td className="py-3.5 px-3 text-right font-mono tabular-nums font-bold text-slate-800 dark:text-slate-200">
                      {formatNum(r.currentStock)}
                    </td>
                    <td
                      className={`py-3.5 px-4 text-right font-mono tabular-nums font-black text-base ${
                        shortage > 0
                          ? 'text-rose-600 dark:text-rose-400'
                          : 'text-emerald-600 dark:text-emerald-400'
                      }`}
                    >
                      {shortage > 0 ? `+${formatNum(shortage)} ${r.item.unit}` : '충분'}
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      {shortage > 0 ? (
                        <span className="inline-flex px-2 py-0.5 rounded text-xs font-bold bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300">
                          발주필요
                        </span>
                      ) : (
                        <span className="inline-flex px-2 py-0.5 rounded text-xs font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                          충분
                        </span>
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
  );
};
