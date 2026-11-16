import React from 'react';
import {
  X,
  Star,
  Package,
  Calendar,
  Building2,
  Layers,
  Filter,
  Receipt,
  CheckCircle2,
  ArrowUpRight,
} from 'lucide-react';
import { MaterialItem, getItemSlipIds } from '../App';

export interface MaterialDeliveryEntry {
  item: MaterialItem;
  sheetId: string;
  sheetName: string;
}

interface MaterialQuantityModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetName: string;
  targetSpec: string;
  entries: MaterialDeliveryEntry[]; // Entries matching exact (name + spec) across integrated sheets
  sameNameEntries: MaterialDeliveryEntry[]; // Entries matching name regardless of spec
  isFavorited: boolean;
  onToggleFavorite: () => void;
  onFilterInLedger: (name: string) => void;
  onOpenSlipViewer?: (slipId: string, scopedIds?: string[]) => void;
}

function summarizeUnits(list: MaterialDeliveryEntry[]): Array<{ unit: string; qty: number }> {
  const sums: Record<string, number> = {};
  for (const { item } of list) {
    if (item.quantity > 0) {
      const rawUnit = (item.unit || 'EA').trim();
      const unit =
        rawUnit === '파렛트' || rawUnit === '팔레트'
          ? '파레트'
          : rawUnit.toLowerCase() === 'box' || rawUnit === '박스'
          ? 'BOX'
          : rawUnit.toLowerCase() === 'ea'
          ? 'EA'
          : rawUnit === '-' || !rawUnit
          ? 'EA'
          : rawUnit;
      sums[unit] = Math.round(((sums[unit] || 0) + item.quantity) * 1000) / 1000;
    }
  }
  return Object.entries(sums).map(([unit, qty]) => ({ unit, qty }));
}

export default function MaterialQuantityModal({
  isOpen,
  onClose,
  targetName,
  targetSpec,
  entries,
  sameNameEntries,
  isFavorited,
  onToggleFavorite,
  onFilterInLedger,
  onOpenSlipViewer,
}: MaterialQuantityModalProps) {
  if (!isOpen) return null;

  const unitTotals = summarizeUnits(entries);
  const sameNameUnitTotals = summarizeUnits(sameNameEntries);
  const hasOtherSpecs = sameNameEntries.length > entries.length;

  const suppliers = Array.from(
    new Set(
      entries
        .map((e) => (e.item.supplier || '').trim())
        .filter((s) => s && s !== '-')
    )
  );

  const sheetNames = Array.from(new Set(entries.map((e) => e.sheetName)));
  const dates = entries
    .map((e) => e.item.date)
    .filter(Boolean)
    .sort();
  const firstDate = dates[0] || '-';
  const latestDate = dates[dates.length - 1] || '-';

  const sortedEntries = [...entries].sort((a, b) => {
    const da = a.item.date || '';
    const db = b.item.date || '';
    if (db !== da) return db.localeCompare(da);
    return (b.item.createdAt || 0) - (a.item.createdAt || 0);
  });

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Modal Header */}
        <div className="px-5 py-4 bg-slate-900 text-white flex items-start justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-blue-300 font-semibold mb-1">
              <Package className="w-3.5 h-3.5" />
              <span>통합보기 · 품목별 총 반입 수량 조회</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg sm:text-xl font-extrabold text-white tracking-tight break-words">
                {targetName}
              </h3>
              {targetSpec && targetSpec !== '-' && (
                <span className="px-2 py-0.5 rounded-md bg-slate-700 text-slate-200 text-xs font-medium">
                  규격: {targetSpec}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onToggleFavorite}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                isFavorited
                  ? 'bg-amber-400 text-slate-950 hover:bg-amber-300'
                  : 'bg-slate-800 text-slate-200 hover:bg-slate-700 border border-slate-600'
              }`}
              title={
                isFavorited
                  ? '통합보기 [자재] 즐겨찾기에서 해제'
                  : '즐겨찾기하여 [통합보기 [자재]]로 보내기'
              }
            >
              <Star className={`w-3.5 h-3.5 ${isFavorited ? 'fill-slate-950' : ''}`} />
              <span>{isFavorited ? '즐겨찾기 [자재] 등록됨' : '즐겨찾기 추가'}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
              title="닫기"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 bg-slate-50">
          {/* Hero Total Quantity Card */}
          <div className="bg-white rounded-xl border-2 border-blue-600 p-4 sm:p-5 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <div className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2.5 py-0.5 rounded-md mb-2">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>총 반입 수량 합계 ({entries.length}회 입고)</span>
                </div>

                {unitTotals.length === 0 ? (
                  <div className="text-2xl font-extrabold text-slate-400">
                    수량 미정 (0)
                  </div>
                ) : (
                  <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                    {unitTotals.map(({ unit, qty }, idx) => (
                      <div key={unit} className="inline-flex items-baseline gap-1.5">
                        {idx > 0 && (
                          <span className="text-lg font-bold text-slate-400 mr-1">+</span>
                        )}
                        <span className="text-3xl sm:text-4xl font-black font-mono tabular-nums text-blue-700 tracking-tight">
                          {qty.toLocaleString()}
                        </span>
                        <span className="text-base sm:text-lg font-bold text-slate-700">
                          {unit}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-1 gap-2 text-xs text-slate-600 bg-slate-50 rounded-lg p-3 border border-slate-200 min-w-[200px]">
                <div className="flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span className="text-slate-500">포함 시트:</span>
                  <span className="font-semibold text-slate-900 truncate">
                    {sheetNames.join(', ') || '-'}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span className="text-slate-500">기간:</span>
                  <span className="font-mono font-semibold text-slate-900">
                    {firstDate === latestDate ? latestDate : `${firstDate} ~ ${latestDate}`}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 col-span-2 sm:col-span-1">
                  <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span className="text-slate-500">구매처:</span>
                  <span className="font-semibold text-slate-900 truncate">
                    {suppliers.length > 0 ? suppliers.join(', ') : '-'}
                  </span>
                </div>
              </div>
            </div>

            {hasOtherSpecs && sameNameUnitTotals.length > 0 && (
              <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs text-indigo-800 bg-indigo-50/70 px-3 py-2 rounded-lg border border-indigo-200">
                <span>
                  참고: 다른 규격을 포함한 <strong>&lsquo;{targetName}&rsquo;</strong> 전체 규격 통합 합계 (총{' '}
                  {sameNameEntries.length}회)
                </span>
                <span className="font-mono font-extrabold text-sm">
                  {sameNameUnitTotals
                    .map(({ unit, qty }) => `${qty.toLocaleString()} ${unit}`)
                    .join(' + ')}
                </span>
              </div>
            )}
          </div>

          {/* Individual Delivery Breakdown Table */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-2.5 bg-slate-100 border-b border-slate-200 flex items-center justify-between">
              <span className="text-xs font-bold text-slate-800">
                상세 반입 내역 ({sortedEntries.length}건 · 최신순)
              </span>
              <span className="text-[11px] text-slate-500">
                시트별 반입 일자 및 수량 상세
              </span>
            </div>

            <div className="overflow-x-auto max-h-[300px]">
              <table className="w-full text-center border-collapse text-xs">
                <thead className="bg-slate-800 text-white sticky top-0">
                  <tr className="divide-x divide-slate-600">
                    <th className="py-2 px-2 w-10">No.</th>
                    <th className="py-2 px-2.5 whitespace-nowrap">시트 구분</th>
                    <th className="py-2 px-2.5 whitespace-nowrap">반입일자</th>
                    <th className="py-2 px-2.5 whitespace-nowrap">구매처</th>
                    <th className="py-2 px-2.5 whitespace-nowrap">규격</th>
                    <th className="py-2 px-3 text-right whitespace-nowrap">반입 수량</th>
                    <th className="py-2 px-2 whitespace-nowrap">단위</th>
                    <th className="py-2 px-2.5 text-left min-w-[100px]">비고</th>
                    <th className="py-2 px-2 whitespace-nowrap">전표</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {sortedEntries.map(({ item, sheetName }, idx) => {
                    const slipIds = getItemSlipIds(item);
                    const hasSlip = slipIds.length > 0;
                    return (
                      <tr
                        key={`${sheetName}-${item.id}`}
                        className={`divide-x divide-slate-200 ${
                          idx % 2 === 1 ? 'bg-slate-50/70' : 'bg-white'
                        }`}
                      >
                        <td className="py-2 px-2 font-mono text-slate-400">{idx + 1}</td>
                        <td className="py-2 px-2.5 font-semibold text-slate-700 whitespace-nowrap">
                          {sheetName}
                        </td>
                        <td className="py-2 px-2.5 font-mono tabular-nums text-slate-700 whitespace-nowrap">
                          {item.date || '-'}
                        </td>
                        <td className="py-2 px-2.5 text-slate-700 whitespace-nowrap">
                          {item.supplier && item.supplier !== '-' ? item.supplier : '-'}
                        </td>
                        <td className="py-2 px-2.5 text-slate-600 whitespace-nowrap">
                          {item.spec && item.spec !== '-' ? item.spec : '-'}
                        </td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums font-bold text-slate-900 whitespace-nowrap">
                          {item.quantity > 0 ? item.quantity.toLocaleString() : '-'}
                        </td>
                        <td className="py-2 px-2 text-slate-600 whitespace-nowrap">
                          {item.quantity > 0 ? item.unit : '-'}
                        </td>
                        <td className="py-2 px-2.5 text-left text-slate-600">
                          {item.remarks || '-'}
                        </td>
                        <td className="py-2 px-2 whitespace-nowrap">
                          {hasSlip && onOpenSlipViewer ? (
                            <button
                              type="button"
                              onClick={() => onOpenSlipViewer(slipIds[0], slipIds)}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100 font-semibold"
                              title="연결된 전표 사진 보기"
                            >
                              <Receipt className="w-3 h-3" />
                              <span>{slipIds.length}</span>
                            </button>
                          ) : (
                            <span className="text-slate-300">-</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-slate-100 border-t-2 border-slate-300 font-bold text-slate-900">
                  <tr className="divide-x divide-slate-200">
                    <td colSpan={5} className="py-2 px-3 text-center">
                      합 계 ({entries.length}건)
                    </td>
                    <td colSpan={2} className="py-2 px-3 text-right font-mono tabular-nums text-blue-700">
                      {unitTotals.length > 0
                        ? unitTotals.map((u) => `${u.qty.toLocaleString()} ${u.unit}`).join(' + ')
                        : '-'}
                    </td>
                    <td colSpan={2} className="py-2 px-2 text-slate-500 font-normal">
                      -
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-white border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              onFilterInLedger(targetName);
              onClose();
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 transition-colors"
          >
            <Filter className="w-3.5 h-3.5" />
            <span>아래 대장에서 이 품목만 모아보기</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 transition-colors"
          >
            확인 / 닫기
          </button>
        </div>
      </div>
    </div>
  );
}
