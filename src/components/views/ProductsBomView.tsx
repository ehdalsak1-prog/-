import React, { useState } from 'react';
import {
  Layers,
  Plus,
  Trash2,
  Edit3,
  Check,
  X,
  FileSpreadsheet,
  CheckCircle2,
} from 'lucide-react';
import { ErpAppState, ItemKind, Product, ProductCategory } from '../../types/erp';
import { calculateProductStats, formatNum } from '../../utils/erpCalculator';
import { ConfirmModal } from '../common/ConfirmModal';
import { AddMaterialModal } from '../common/AddMaterialModal';

interface ProductsBomViewProps {
  state: ErpAppState;
  onAddProduct: (params: {
    productName: string;
    category: ProductCategory;
    unit: string;
    targetQuantity: number;
  }) => void;
  onUpdateProductName: (productId: string, newName: string) => void;
  onDeleteProduct: (productId: string) => void;
  onAddBomLine: (productId: string, materialItemId: string, quantity: number) => void;
  onUpdateBomQty: (bomId: string, quantity: number) => void;
  onDeleteBomLine: (bomId: string) => void;
  onAddMaterial: (params: {
    name: string;
    specification: string;
    unit: string;
    kind: ItemKind;
    initialStock: number;
    minimumStock: number;
    notes: string;
  }) => string;
  onExportBom: () => void;
}

export const ProductsBomView: React.FC<ProductsBomViewProps> = ({
  state,
  onAddProduct,
  onUpdateProductName,
  onDeleteProduct,
  onAddBomLine,
  onUpdateBomQty,
  onDeleteBomLine,
  onAddMaterial,
  onExportBom,
}) => {
  // 신규 제품 폼
  const [productName, setProductName] = useState('');
  const [category, setCategory] = useState<ProductCategory>('FINAL');
  const [targetQuantity, setTargetQuantity] = useState('1000');

  // 제품명 수정 상태
  const [editingProdId, setEditingProdId] = useState<string | null>(null);
  const [editProdName, setEditProdName] = useState('');

  // 제품 삭제 확인 모달
  const [deleteProdTarget, setDeleteProdTarget] = useState<Product | null>(null);

  // 각 제품 카드별 "추가할 자재 선택" 및 "수량" 상태
  const [cardMaterialMap, setCardMaterialMap] = useState<Record<string, string>>({});
  const [cardQtyMap, setCardQtyMap] = useState<Record<string, string>>({});

  // 새 자재 빠른 추가 모달 (어떤 제품 카드에서 열었는지 추적)
  const [addMaterialForProductId, setAddMaterialForProductId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const showNotice = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 3000);
  };

  const selectableMaterials = state.items.filter((i) => i.active && i.kind !== 'FINAL');

  const handleCreateProduct = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = productName.trim();
    if (!trimmed) return;
    onAddProduct({
      productName: trimmed,
      category,
      unit: 'EA',
      targetQuantity: Math.max(0, parseInt(targetQuantity, 10) || 0),
    });
    showNotice(`새 제품 [${trimmed}] 이(가) 추가되었습니다. 아래 카드에서 자재를 연결하세요.`);
    setProductName('');
  };

  const handleAddMaterialToProduct = (product: Product) => {
    const validOptions = selectableMaterials.filter((m) => m.id !== product.linkedItemId);
    const chosenMatId = cardMaterialMap[product.id] || validOptions[0]?.id || '';
    const qtyVal = parseFloat(cardQtyMap[product.id] || '1');
    if (!chosenMatId || isNaN(qtyVal) || qtyVal <= 0) return;

    onAddBomLine(product.id, chosenMatId, qtyVal);
    setCardQtyMap((prev) => ({ ...prev, [product.id]: '1' }));
    showNotice(`[${product.productName}] 소요 자재가 반영되었습니다.`);
  };

  return (
    <div className="space-y-6">
      {notice && (
        <div className="bg-white dark:bg-[#1E232D] border border-emerald-200 dark:border-emerald-900 rounded-xl p-3.5 flex items-center space-x-2.5 shadow-2xs">
          <CheckCircle2 size={18} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span className="text-sm font-bold text-slate-900 dark:text-slate-100">{notice}</span>
        </div>
      )}

      {/* 상단: 신규 제품 추가 1-줄 카드 */}
      <form
        onSubmit={handleCreateProduct}
        className="bg-white dark:bg-[#1E232D] border border-slate-200/90 dark:border-slate-800 rounded-xl p-5 shadow-2xs space-y-4"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center space-x-2.5">
            <div className="w-9 h-9 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 flex items-center justify-center">
              <Layers size={18} />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                제품 추가 및 소요 자재(BOM) 설정
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                제품을 추가·수정·삭제하고 각 제품 카드 안에서 들어가는 자재 수량을 바로 설정할 수 있습니다.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onExportBom}
            className="px-3.5 py-2 text-xs font-bold rounded-lg border border-slate-250 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 text-slate-700 dark:text-slate-200 flex items-center space-x-1.5 cursor-pointer self-start sm:self-auto"
          >
            <FileSpreadsheet size={15} className="text-emerald-600 dark:text-emerald-400" />
            <span>BOM 엑셀</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 pt-3 border-t border-slate-150 dark:border-slate-800">
          <div className="lg:col-span-2">
            <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1">
              새 제품명 *
            </label>
            <input
              type="text"
              required
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
              placeholder="예: 40A POST 600L"
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1">
              구분
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as ProductCategory)}
              className="w-full px-3 py-2 text-sm font-bold rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 cursor-pointer"
            >
              <option value="FINAL">완제품</option>
              <option value="INTERMEDIATE">중간제품</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1">
              목표 수량 (EA)
            </label>
            <input
              type="number"
              min="0"
              value={targetQuantity}
              onChange={(e) => setTargetQuantity(e.target.value)}
              className="w-full px-3 py-2 text-sm font-mono font-bold text-right rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
            />
          </div>

          <div className="flex items-end">
            <button
              type="submit"
              className="w-full py-2 px-4 rounded-lg text-sm font-bold bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 text-white flex items-center justify-center space-x-1.5 cursor-pointer"
            >
              <Plus size={15} />
              <span>제품 추가</span>
            </button>
          </div>
        </div>
      </form>

      {/* 제품별 통합 카드 (이름 수정 + 삭제 + BOM 자재 설정) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {state.products.map((product) => {
          const stats = calculateProductStats(
            product,
            state.items,
            state.bom,
            state.productionRecords
          );
          const lines = state.bom.filter((b) => b.productId === product.id);
          const validOptions = selectableMaterials.filter((m) => m.id !== product.linkedItemId);
          const selectedMatId = cardMaterialMap[product.id] || validOptions[0]?.id || '';
          const qtyStr = cardQtyMap[product.id] ?? '1';
          const isEditing = editingProdId === product.id;

          return (
            <div
              key={product.id}
              className="bg-white dark:bg-[#1E232D] border border-slate-200/90 dark:border-slate-800 rounded-xl shadow-2xs overflow-hidden flex flex-col"
            >
              {/* 카드 헤더 */}
              <div className="p-4 border-b border-slate-150 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center space-x-2 mb-1">
                    <span
                      className={`text-[11px] font-bold px-2 py-0.5 rounded ${
                        product.category === 'FINAL'
                          ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                          : 'bg-slate-200/80 text-slate-700 dark:bg-slate-700 dark:text-slate-200'
                      }`}
                    >
                      {product.category === 'FINAL' ? '완제품' : '중간제품'}
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                      목표 {formatNum(product.targetQuantity)} · 가능 {formatNum(stats.producibleQty)} EA
                    </span>
                  </div>

                  {isEditing ? (
                    <div className="flex items-center space-x-1.5 mt-1">
                      <input
                        type="text"
                        autoFocus
                        value={editProdName}
                        onChange={(e) => setEditProdName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && editProdName.trim()) {
                            onUpdateProductName(product.id, editProdName.trim());
                            setEditingProdId(null);
                            showNotice('제품명이 수정되었습니다.');
                          }
                          if (e.key === 'Escape') setEditingProdId(null);
                        }}
                        className="flex-1 min-w-0 px-2.5 py-1 text-sm font-bold rounded-lg border border-slate-400 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (editProdName.trim()) {
                            onUpdateProductName(product.id, editProdName.trim());
                            showNotice('제품명이 수정되었습니다.');
                          }
                          setEditingProdId(null);
                        }}
                        className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded cursor-pointer"
                        title="저장"
                      >
                        <Check size={15} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingProdId(null)}
                        className="p-1.5 text-slate-400 hover:bg-slate-100 rounded cursor-pointer"
                        title="취소"
                      >
                        <X size={15} />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center space-x-1.5">
                      <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 truncate">
                        {product.productName}
                      </h3>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingProdId(product.id);
                          setEditProdName(product.productName);
                        }}
                        className="p-1 text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 rounded hover:bg-slate-200/60 dark:hover:bg-slate-700 cursor-pointer"
                        title="제품명 수정"
                      >
                        <Edit3 size={14} />
                      </button>
                    </div>
                  )}
                </div>

                {/* 제품 삭제 버튼 */}
                <button
                  type="button"
                  onClick={() => setDeleteProdTarget(product)}
                  className="px-2.5 py-1.5 text-xs font-bold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg inline-flex items-center space-x-1 shrink-0 cursor-pointer"
                  title="제품 삭제"
                >
                  <Trash2 size={14} />
                  <span>삭제</span>
                </button>
              </div>

              {/* 카드 본문: 이 제품 1EA에 들어가는 자재 목록 */}
              <div className="divide-y divide-slate-150 dark:divide-slate-800 flex-1">
                {lines.length === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-400">
                    등록된 소요 자재가 없습니다. 아래에서 자재를 추가하세요.
                  </div>
                ) : (
                  lines.map((line) => {
                    const mat = state.items.find((i) => i.id === line.materialItemId);
                    return (
                      <div
                        key={line.id}
                        className="px-4 py-2.5 flex items-center justify-between gap-3 hover:bg-slate-50/70 dark:hover:bg-slate-800/30"
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                            {mat?.name || '삭제된 자재'}
                          </div>
                          <div className="text-xs font-mono text-slate-400">
                            {mat?.specification || '-'} · {mat?.kind === 'INTERMEDIATE' ? '중간제품' : '원자재'}
                          </div>
                        </div>

                        <div className="flex items-center space-x-2 shrink-0">
                          <input
                            type="number"
                            min="0.01"
                            step="any"
                            value={line.quantity}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              if (!isNaN(val) && val > 0) {
                                onUpdateBomQty(line.id, val);
                              }
                            }}
                            className="w-20 px-2 py-1 text-sm font-mono font-bold text-right rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                          />
                          <span className="text-xs font-bold text-slate-500 w-7">
                            {mat?.unit || 'EA'}
                          </span>
                          <button
                            type="button"
                            onClick={() => onDeleteBomLine(line.id)}
                            className="p-1.5 text-slate-400 hover:text-rose-600 rounded hover:bg-rose-50 dark:hover:bg-rose-950/30 cursor-pointer"
                            title="이 자재 제외"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* 카드 하단: 이 제품에 바로 자재 추가 */}
              <div className="p-3 bg-slate-50/60 dark:bg-slate-800/30 border-t border-slate-150 dark:border-slate-800">
                <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
                  <select
                    value={selectedMatId}
                    onChange={(e) =>
                      setCardMaterialMap((prev) => ({
                        ...prev,
                        [product.id]: e.target.value,
                      }))
                    }
                    className="flex-1 min-w-[140px] px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                  >
                    {validOptions.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} ({m.specification || '-'})
                      </option>
                    ))}
                  </select>

                  <input
                    type="number"
                    min="0.01"
                    step="any"
                    value={qtyStr}
                    onChange={(e) =>
                      setCardQtyMap((prev) => ({ ...prev, [product.id]: e.target.value }))
                    }
                    className="w-16 px-2 py-1.5 text-xs font-mono font-bold text-right rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                    title="1EA당 소요 수량"
                  />

                  <button
                    type="button"
                    onClick={() => handleAddMaterialToProduct(product)}
                    className="px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 text-white shrink-0 cursor-pointer"
                  >
                    + 자재 넣기
                  </button>

                  <button
                    type="button"
                    onClick={() => setAddMaterialForProductId(product.id)}
                    className="px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 text-slate-700 dark:text-slate-200 shrink-0 cursor-pointer"
                    title="목록에 없는 새 자재 등록"
                  >
                    새 자재
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 제품 삭제 확인 모달 */}
      <ConfirmModal
        isOpen={Boolean(deleteProdTarget)}
        title="제품 삭제"
        description={
          deleteProdTarget
            ? `[${deleteProdTarget.productName}] 제품을 삭제하시겠습니까?\n이 제품에 연결된 소요 자재(BOM) 설정 및 제품 재고 항목도 함께 삭제됩니다.`
            : ''
        }
        confirmLabel="제품 삭제"
        onConfirm={() => {
          if (deleteProdTarget) {
            onDeleteProduct(deleteProdTarget.id);
            showNotice(`[${deleteProdTarget.productName}] 제품이 삭제되었습니다.`);
            setDeleteProdTarget(null);
          }
        }}
        onCancel={() => setDeleteProdTarget(null)}
      />

      {/* 새 자재 추가 모달 */}
      <AddMaterialModal
        isOpen={Boolean(addMaterialForProductId)}
        onClose={() => setAddMaterialForProductId(null)}
        onAddMaterial={onAddMaterial}
        onCreated={(createdId) => {
          if (addMaterialForProductId) {
            setCardMaterialMap((prev) => ({
              ...prev,
              [addMaterialForProductId]: createdId,
            }));
          }
          showNotice('새 자재가 추가되어 선택되었습니다.');
        }}
      />
    </div>
  );
};
