import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  PlusCircle,
  PackageCheck,
} from 'lucide-react';
import { ActiveTab, ErpAppState, ProductionRecord } from '../../types/erp';
import {
  calculateProductStats,
  formatNum,
  getTodayDateStr,
} from '../../utils/erpCalculator';
import { validateProductionStock } from '../../utils/erpActions';

interface ProductionEntryViewProps {
  state: ErpAppState;
  lastSelectedProductId?: string;
  onRegisterProduction: (params: {
    productionDate: string;
    productId: string;
    quantity: number;
    worker: string;
    manager: string;
    note: string;
  }) => { ok: true; record: ProductionRecord } | { ok: false; error: string };
  onNavigate: (tab: ActiveTab) => void;
}

export const ProductionEntryView: React.FC<ProductionEntryViewProps> = ({
  state,
  lastSelectedProductId,
  onRegisterProduction,
  onNavigate,
}) => {
  const activeProducts = useMemo(
    () => state.products.filter((p) => p.active),
    [state.products]
  );

  const [productId, setProductId] = useState<string>(() => {
    if (lastSelectedProductId && activeProducts.some((p) => p.id === lastSelectedProductId)) {
      return lastSelectedProductId;
    }
    return activeProducts[0]?.id || '';
  });
  const [productionDate, setProductionDate] = useState<string>(getTodayDateStr());
  const [quantityInput, setQuantityInput] = useState<string>('500');
  const [worker, setWorker] = useState<string>('현장 조립팀');
  const [manager, setManager] = useState<string>('현장 관리자');
  const [note, setNote] = useState<string>('');
  const [successRecord, setSuccessRecord] = useState<ProductionRecord | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const numericQty = useMemo(() => {
    const cleaned = quantityInput.replace(/,/g, '').trim();
    const parsed = parseInt(cleaned, 10);
    return isNaN(parsed) || parsed < 0 ? 0 : parsed;
  }, [quantityInput]);

  const effectiveProductId = activeProducts.some((p) => p.id === productId)
    ? productId
    : activeProducts[0]?.id || '';

  const selectedProduct = activeProducts.find((p) => p.id === effectiveProductId);
  const productStats = useMemo(() => {
    if (!selectedProduct) return null;
    return calculateProductStats(
      selectedProduct,
      state.items,
      state.bom,
      state.productionRecords
    );
  }, [selectedProduct, state.items, state.bom, state.productionRecords]);

  const validation = useMemo(() => {
    return validateProductionStock(state, effectiveProductId, numericQty);
  }, [state, effectiveProductId, numericQty]);

  const handleQtyChange = (raw: string) => {
    const digitsOnly = raw.replace(/[^0-9]/g, '');
    if (!digitsOnly) {
      setQuantityInput('');
      return;
    }
    setQuantityInput(Number(digitsOnly).toLocaleString('ko-KR'));
  };

  const addPresetQty = (delta: number) => {
    const next = numericQty + delta;
    setQuantityInput(next.toLocaleString('ko-KR'));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    setSuccessRecord(null);

    if (!validation.valid) {
      setSubmitError(validation.errorMessage || '자재가 부족하여 생산을 등록할 수 없습니다.');
      return;
    }

    const res = onRegisterProduction({
      productionDate,
      productId: effectiveProductId,
      quantity: numericQty,
      worker,
      manager,
      note,
    });

    if (res.ok) {
      setSuccessRecord(res.record);
      setNote('');
    } else {
      setSubmitError(res.error);
    }
  };

  return (
    <div className="space-y-6">
      {/* 등록 성공 알림 배너 */}
      {successRecord && (
        <div className="bg-white dark:bg-[#1E232D] border border-emerald-200 dark:border-emerald-900/60 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
          <div className="flex items-start sm:items-center space-x-3">
            <div className="w-9 h-9 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
              <CheckCircle2 size={19} />
            </div>
            <div>
              <div className="text-sm font-bold text-slate-900 dark:text-slate-100">
                생산 등록 완료: {successRecord.productName} {formatNum(successRecord.quantity)} EA
              </div>
              <div className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                BOM 기준 소모 자재가 자동 차감되었으며, 아래 생산 이력과 재고에 즉시 반영되었습니다.
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
        {/* 좌측: 생산 등록 폼 (2 columns) */}
        <form
          onSubmit={handleSubmit}
          className="xl:col-span-2 bg-white dark:bg-[#1E232D] border border-slate-200/90 dark:border-slate-800 rounded-xl p-5 sm:p-6 shadow-2xs space-y-5"
        >
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
              생산 실적 등록
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
              중간제품(베이스·클램프) 또는 완제품(40A POST)을 선택하고 수량을 입력하면 자재가 자동 차감됩니다.
            </p>
          </div>

          {/* 제품 선택 */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
              생산 제품 선택
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {activeProducts.map((p) => {
                const selected = p.id === effectiveProductId;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setProductId(p.id);
                      setSubmitError(null);
                    }}
                    className={`p-3 rounded-lg border text-left transition cursor-pointer ${
                      selected
                        ? 'border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900'
                        : 'border-slate-250 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/50 text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <div className="text-[11px] opacity-75 font-medium">
                      {p.category === 'FINAL' ? '완제품' : '중간제품'}
                    </div>
                    <div className="text-sm font-bold mt-0.5 truncate">{p.productName}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 생산일자 + 생산수량 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                생산일자
              </label>
              <input
                type="date"
                required
                value={productionDate}
                onChange={(e) => setProductionDate(e.target.value)}
                className="w-full px-3 py-2.5 text-sm font-mono font-bold rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 outline-none focus:border-slate-500 focus:bg-white"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                생산수량 (EA)
              </label>
              <div className="relative">
                <input
                  type="text"
                  inputMode="numeric"
                  required
                  value={quantityInput}
                  onChange={(e) => handleQtyChange(e.target.value)}
                  placeholder="0"
                  className="w-full pl-3 pr-10 py-2.5 text-base font-extrabold font-mono text-right rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 outline-none focus:border-slate-500"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                  EA
                </span>
              </div>
            </div>
          </div>

          {/* 빠른 수량 버튼 */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-slate-500 dark:text-slate-400 mr-1">빠른 입력:</span>
            {[100, 500, 1000].map((val) => (
              <button
                key={val}
                type="button"
                onClick={() => addPresetQty(val)}
                className="px-2.5 py-1 text-xs font-bold font-mono rounded border border-slate-250 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-200 cursor-pointer"
              >
                +{formatNum(val)}
              </button>
            ))}
            {productStats && productStats.producibleQty > 0 && (
              <button
                type="button"
                onClick={() =>
                  setQuantityInput(productStats.producibleQty.toLocaleString('ko-KR'))
                }
                className="px-2.5 py-1 text-xs font-bold rounded border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 cursor-pointer"
              >
                최대 가능 ({formatNum(productStats.producibleQty)})
              </button>
            )}
          </div>

          {/* 작업자 / 담당자 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                작업자
              </label>
              <input
                type="text"
                value={worker}
                onChange={(e) => setWorker(e.target.value)}
                placeholder="작업자 또는 팀명"
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 outline-none focus:border-slate-500 focus:bg-white"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                담당자
              </label>
              <input
                type="text"
                value={manager}
                onChange={(e) => setManager(e.target.value)}
                placeholder="담당 관리자"
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 outline-none focus:border-slate-500 focus:bg-white"
              />
            </div>
          </div>

          {/* 비고 */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
              비고 (작업 구역 / 특이사항)
            </label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="예: 야간 조립, 3F 구역 출고용"
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 outline-none focus:border-slate-500 focus:bg-white"
            />
          </div>

          {submitError && (
            <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs sm:text-sm font-bold text-rose-700 dark:text-rose-300 flex items-center space-x-2">
              <AlertCircle size={16} className="shrink-0" />
              <span>{submitError}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={!validation.valid}
            className="w-full py-3 px-4 rounded-xl text-sm sm:text-base font-bold bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 dark:bg-slate-100 dark:hover:bg-white dark:disabled:bg-slate-700 text-white dark:text-slate-900 disabled:text-slate-500 flex items-center justify-center space-x-2 transition cursor-pointer disabled:cursor-not-allowed shadow-2xs"
          >
            <PlusCircle size={18} />
            <span>
              {validation.valid
                ? `${selectedProduct?.productName || ''} ${formatNum(numericQty)} EA 생산 등록`
                : '자재 재고 부족 (등록 불가)'}
            </span>
          </button>
        </form>

        {/* 우측: 실시간 BOM 자재 검증 패널 (3 columns) */}
        <div className="xl:col-span-3 bg-white dark:bg-[#1E232D] border border-slate-200/90 dark:border-slate-800 rounded-xl shadow-2xs overflow-hidden flex flex-col">
          <div className="p-5 border-b border-slate-200/80 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center space-x-2.5">
              <PackageCheck size={20} className="text-slate-600 dark:text-slate-300" />
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  생산 전 BOM 자재 검증 ({selectedProduct?.productName})
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {selectedProduct?.category === 'FINAL'
                    ? '완제품 조립 시 중간제품(베이스·클램프) 및 파이프·락링만 차감되며, 볼트/너트는 중복 차감되지 않습니다.'
                    : '중간제품 생산 시 소요 원자재가 자동 차감되고 해당 중간제품 재고가 증가합니다.'}
                </p>
              </div>
            </div>

            {productStats && (
              <div className="text-xs font-bold px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-mono">
                현재 재고 최대 가능: {formatNum(productStats.producibleQty)} EA
              </div>
            )}
          </div>

          <div className="overflow-x-auto flex-1">
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-50 dark:bg-slate-800/80 text-xs font-bold text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th className="py-3 px-4">소요 자재명</th>
                  <th className="py-3 px-3">규격</th>
                  <th className="py-3 px-3 text-right">1EA당 소요</th>
                  <th className="py-3 px-3 text-right">총 필요수량</th>
                  <th className="py-3 px-3 text-right">현재 재고</th>
                  <th className="py-3 px-4 text-right">생산 후 잔량 / 부족</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-150 dark:divide-slate-800 text-sm">
                {!productStats || productStats.bomDetails.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-slate-400">
                      등록된 BOM 항목이 없습니다. BOM 관리에서 소요 자재를 설정해 주세요.
                    </td>
                  </tr>
                ) : (
                  productStats.bomDetails.map((b) => {
                    const reqTotal = b.perUnitQty * numericQty;
                    const afterStock = b.currentStock - reqTotal;
                    const isShort = afterStock < 0;
                    return (
                      <tr
                        key={b.bomId}
                        className={
                          isShort
                            ? 'bg-rose-50/40 dark:bg-rose-950/15'
                            : 'hover:bg-slate-50/60 dark:hover:bg-slate-800/40'
                        }
                      >
                        <td className="py-3.5 px-4 font-bold text-slate-900 dark:text-slate-100">
                          {b.materialName}
                        </td>
                        <td className="py-3.5 px-3 font-mono text-xs text-slate-500 dark:text-slate-400">
                          {b.specification}
                        </td>
                        <td className="py-3.5 px-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                          {b.perUnitQty} {b.unit}
                        </td>
                        <td className="py-3.5 px-3 text-right font-mono tabular-nums font-bold text-slate-900 dark:text-white">
                          {formatNum(reqTotal)} {b.unit}
                        </td>
                        <td className="py-3.5 px-3 text-right font-mono tabular-nums font-bold text-slate-800 dark:text-slate-200">
                          {formatNum(b.currentStock)} {b.unit}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono tabular-nums font-extrabold">
                          {isShort ? (
                            <span className="text-rose-600 dark:text-rose-400">
                              {formatNum(Math.abs(afterStock))} {b.unit} 부족
                            </span>
                          ) : (
                            <span className="text-emerald-600 dark:text-emerald-400">
                              {formatNum(afterStock)} {b.unit} 남음
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* 부족 시 안내 */}
          {!validation.valid && validation.shortages.length > 0 && (
            <div className="p-4 bg-rose-50/70 dark:bg-rose-950/30 border-t border-rose-200 dark:border-rose-900 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="text-xs sm:text-sm text-rose-800 dark:text-rose-300">
                <strong>자재 부족으로 생산할 수 없습니다:</strong>{' '}
                {validation.shortages
                  .map(
                    (s) =>
                      `${s.itemName} (${formatNum(s.shortageQty)} ${s.unit} 부족)`
                  )
                  .join(', ')}
              </div>
              <button
                type="button"
                onClick={() => onNavigate('receipts')}
                className="px-3 py-1.5 text-xs font-bold rounded-lg bg-rose-600 hover:bg-rose-700 text-white shrink-0 cursor-pointer self-start sm:self-auto"
              >
                자재 입고 등록하기
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
