import React, { useMemo, useRef, useState } from 'react';
import {
  Truck,
  CheckCircle2,
  Trash2,
  FileSpreadsheet,
  Plus,
  Upload,
  Download,
  AlertCircle,
  X,
  Check,
  SkipForward,
  Edit3,
} from 'lucide-react';
import { ErpAppState, InventoryItem, ItemKind, ReceiptRecord } from '../../types/erp';
import { formatNum, getTodayDateStr } from '../../utils/erpCalculator';
import { BatchReceiptInputRow } from '../../utils/erpActions';
import {
  downloadReceiptImportTemplate,
  parseReceiptsFromExcelFile,
  ParseReceiptExcelResult,
} from '../../utils/erpExcelImport';
import { ConfirmModal } from '../common/ConfirmModal';
import { AddMaterialModal } from '../common/AddMaterialModal';

interface ReceiptViewProps {
  state: ErpAppState;
  onRegisterReceipt: (params: {
    receiptDate: string;
    itemId: string;
    quantity: number;
    supplier: string;
    worker: string;
    note: string;
  }) => void;
  onUpdateReceipt: (
    receiptId: string,
    updates: {
      receiptDate: string;
      itemId: string;
      quantity: number;
      supplier: string;
      worker: string;
      note: string;
    }
  ) => void;
  onBatchImportReceipts: (rows: BatchReceiptInputRow[]) => {
    addedCount: number;
    createdItemsCount: number;
  };
  onCancelReceipt: (receiptId: string) => void;
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
  onUpdateTotalUsed: (params: {
    date: string;
    itemId: string;
    newTotalUsed: number;
    syncCurrentStock: boolean;
    reason: string;
    worker: string;
  }) => void;
  onExportReceipts: () => void;
}

export const ReceiptView: React.FC<ReceiptViewProps> = ({
  state,
  onRegisterReceipt,
  onUpdateReceipt,
  onBatchImportReceipts,
  onCancelReceipt,
  onAddMaterial,
  onUpdateMaterial,
  onUpdateTotalUsed,
  onExportReceipts,
}) => {
  const receivableItems = useMemo(
    () => state.items.filter((i) => i.active && i.kind !== 'FINAL'),
    [state.items]
  );

  const [itemId, setItemId] = useState<string>(receivableItems[0]?.id || '');
  const [receiptDate, setReceiptDate] = useState<string>(getTodayDateStr());
  const [qtyInput, setQtyInput] = useState<string>('10,000');
  const [supplier, setSupplier] = useState<string>('');
  const [worker, setWorker] = useState<string>('현장 관리자');
  const [note, setNote] = useState<string>('');
  const [notice, setNotice] = useState<string | null>(null);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<ReceiptRecord | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  // 선택된 자재 이름/규격 인라인 수정 (좌측 폼)
  const [isEditingSelectedMat, setIsEditingSelectedMat] = useState(false);
  const [editMatName, setEditMatName] = useState('');
  const [editMatSpec, setEditMatSpec] = useState('');

  // 입고 이력 행 수정 모달
  const [editingReceipt, setEditingReceipt] = useState<ReceiptRecord | null>(null);
  const [editRecDate, setEditRecDate] = useState('');
  const [editRecItemId, setEditRecItemId] = useState('');
  const [editRecQty, setEditRecQty] = useState('');
  const [editRecSupplier, setEditRecSupplier] = useState('');
  const [editRecWorker, setEditRecWorker] = useState('');
  const [editRecNote, setEditRecNote] = useState('');

  // 엑셀 일괄 업로드 상태
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [importPreview, setImportPreview] = useState<{
    fileName: string;
    result: ParseReceiptExcelResult;
  } | null>(null);
  // 신규 자동매칭 행 제외 체크, 미등록 행 선택 추가/기존자재 매핑, 수량 수정
  const [excludedNewRows, setExcludedNewRows] = useState<Set<number>>(new Set());
  const [unregisteredOverrides, setUnregisteredOverrides] = useState<
    Record<number, { include: boolean; targetItemId: string }>
  >({});
  const [qtyOverrides, setQtyOverrides] = useState<Record<number, number>>({});

  // 사용누계 수정 모달 상태
  const [isUsedModalOpen, setIsUsedModalOpen] = useState(false);
  const [usedModalItemId, setUsedModalItemId] = useState('');
  const [usedQtyInput, setUsedQtyInput] = useState('');
  const [usedSyncStock, setUsedSyncStock] = useState(true);
  const [usedReason, setUsedReason] = useState('사용누계 수량 수정');

  const selectedItem =
    receivableItems.find((i) => i.id === itemId) || receivableItems[0] || null;

  const usedModalItem =
    receivableItems.find((i) => i.id === usedModalItemId) ||
    selectedItem ||
    receivableItems[0] ||
    null;

  const numericUsedQty = useMemo(() => {
    const cleaned = usedQtyInput.replace(/,/g, '').trim();
    if (!cleaned) return 0;
    const parsed = parseInt(cleaned, 10);
    return isNaN(parsed) || parsed < 0 ? 0 : parsed;
  }, [usedQtyInput]);

  const openEditTotalUsedModal = (targetItemId?: string) => {
    const target =
      receivableItems.find((i) => i.id === targetItemId) ||
      selectedItem ||
      receivableItems[0];
    if (!target) return;
    setUsedModalItemId(target.id);
    setUsedQtyInput(target.totalUsed.toLocaleString('ko-KR'));
    setUsedSyncStock(true);
    setUsedReason('사용누계 수량 수정');
    setIsUsedModalOpen(true);
  };

  const handleSelectUsedModalItem = (nextId: string) => {
    setUsedModalItemId(nextId);
    const found = receivableItems.find((i) => i.id === nextId);
    if (found) {
      setUsedQtyInput(found.totalUsed.toLocaleString('ko-KR'));
    }
  };

  const handleSaveTotalUsed = (e: React.FormEvent) => {
    e.preventDefault();
    if (!usedModalItem) return;
    if (numericUsedQty === usedModalItem.totalUsed) {
      setIsUsedModalOpen(false);
      return;
    }

    onUpdateTotalUsed({
      date: getTodayDateStr(),
      itemId: usedModalItem.id,
      newTotalUsed: numericUsedQty,
      syncCurrentStock: usedSyncStock,
      reason: usedReason,
      worker,
    });

    setIsUsedModalOpen(false);
    setNotice(
      `[${usedModalItem.name}] 사용누계가 ${formatNum(usedModalItem.totalUsed)} → ${formatNum(
        numericUsedQty
      )} ${usedModalItem.unit}로 수정되었습니다.`
    );
    setTimeout(() => setNotice(null), 4000);
  };

  const numericQty = useMemo(() => {
    const cleaned = qtyInput.replace(/,/g, '').trim();
    const parsed = parseInt(cleaned, 10);
    return isNaN(parsed) || parsed < 0 ? 0 : parsed;
  }, [qtyInput]);

  const handleQtyChange = (raw: string) => {
    const digitsOnly = raw.replace(/[^0-9]/g, '');
    if (!digitsOnly) {
      setQtyInput('');
      return;
    }
    setQtyInput(Number(digitsOnly).toLocaleString('ko-KR'));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItem || numericQty <= 0) return;

    onRegisterReceipt({
      receiptDate,
      itemId: selectedItem.id,
      quantity: numericQty,
      supplier,
      worker,
      note,
    });

    setNotice(
      `${selectedItem.name} ${formatNum(numericQty)} ${selectedItem.unit} 입고가 완료되었습니다.`
    );
    setNote('');
    setTimeout(() => setNotice(null), 4000);
  };

  const handleExcelFile = async (file: File) => {
    setErrorNotice(null);
    try {
      const result = await parseReceiptsFromExcelFile(file, state);
      if (result.error) {
        setErrorNotice(result.error);
        return;
      }
      if (result.totalRows === 0) {
        setErrorNotice('엑셀에서 유효한 입고 데이터(자재명 및 수량)를 찾지 못했습니다.');
        return;
      }
      setExcludedNewRows(new Set());
      setUnregisteredOverrides({});
      setQtyOverrides({});
      setImportPreview({ fileName: file.name, result });
    } catch (err) {
      console.error(err);
      setErrorNotice('엑셀 파일을 읽는 중 오류가 발생했습니다. (.xlsx, .xls, .csv 지원)');
    }
  };

  const openEditReceipt = (r: ReceiptRecord) => {
    setEditingReceipt(r);
    setEditRecDate(r.receiptDate);
    setEditRecItemId(r.itemId);
    setEditRecQty(r.quantity.toLocaleString('ko-KR'));
    setEditRecSupplier(r.supplier === '-' ? '' : r.supplier);
    setEditRecWorker(r.worker);
    setEditRecNote(r.note || '');
  };

  const handleSaveEditReceipt = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingReceipt) return;
    const parsedQty = parseInt(editRecQty.replace(/,/g, '').trim(), 10) || 0;
    if (parsedQty <= 0 || !editRecItemId) return;

    onUpdateReceipt(editingReceipt.id, {
      receiptDate: editRecDate,
      itemId: editRecItemId,
      quantity: parsedQty,
      supplier: editRecSupplier,
      worker: editRecWorker,
      note: editRecNote,
    });
    const targetItem = receivableItems.find((i) => i.id === editRecItemId);
    setEditingReceipt(null);
    setNotice(
      `[${targetItem?.name || editingReceipt.itemName}] 입고 내역(${formatNum(parsedQty)} ${
        targetItem?.unit || editingReceipt.unit
      })이 수정되었습니다.`
    );
    setTimeout(() => setNotice(null), 4000);
  };

  const selectedImportCounts = useMemo(() => {
    if (!importPreview) return { newSelected: 0, unregSelected: 0, totalSelected: 0 };
    const newSelected = importPreview.result.newRows.filter(
      (r) => !excludedNewRows.has(r.rowIndex)
    ).length;
    const unregSelected = importPreview.result.unregisteredRows.filter(
      (r) => unregisteredOverrides[r.rowIndex]?.include
    ).length;
    return {
      newSelected,
      unregSelected,
      totalSelected: newSelected + unregSelected,
    };
  }, [importPreview, excludedNewRows, unregisteredOverrides]);

  const handleConfirmBatchImport = () => {
    if (!importPreview) return;
    const { newRows, duplicateRows, unregisteredRows } = importPreview.result;

    const selectedNewInputs: BatchReceiptInputRow[] = newRows
      .filter((row) => !excludedNewRows.has(row.rowIndex) && row.matchedItem !== null)
      .map((row) => ({
        receiptDate: row.receiptDate,
        matchedItemId: row.matchedItem!.id,
        quantity: qtyOverrides[row.rowIndex] ?? row.quantity,
        supplier: row.supplier,
        worker: row.worker,
        note: row.note,
      }));

    const selectedUnregInputs: BatchReceiptInputRow[] = unregisteredRows
      .filter((row) => unregisteredOverrides[row.rowIndex]?.include)
      .map((row) => {
        const targetId = unregisteredOverrides[row.rowIndex]?.targetItemId || '';
        return {
          receiptDate: row.receiptDate,
          matchedItemId: targetId || null,
          createNewIfMissing: !targetId,
          itemName: row.resolvedName,
          specification: row.specification,
          unit: row.unit,
          quantity: qtyOverrides[row.rowIndex] ?? row.quantity,
          supplier: row.supplier,
          worker: row.worker,
          note: row.note,
        };
      });

    const batchInputs = [...selectedNewInputs, ...selectedUnregInputs];
    if (batchInputs.length === 0) {
      setImportPreview(null);
      return;
    }

    const res = onBatchImportReceipts(batchInputs);
    setImportPreview(null);

    const details: string[] = [];
    if (res.createdItemsCount > 0) details.push(`신규 자재 ${res.createdItemsCount}종 등록`);
    if (duplicateRows.length > 0) details.push(`기존 이력 ${duplicateRows.length}건 건너뜀`);
    const unregExcluded = unregisteredRows.length - selectedUnregInputs.length;
    if (unregExcluded > 0) details.push(`미선택 미등록 ${unregExcluded}건 제외`);
    const detailText = details.length > 0 ? ` (${details.join(', ')})` : '';

    setNotice(`엑셀에서 입고 ${res.addedCount}건이 반영되었습니다${detailText}.`);
    setTimeout(() => setNotice(null), 5000);
  };

  const sortedReceipts = useMemo(() => {
    return [...state.receiptRecords].sort((a, b) => {
      const cmp = b.receiptDate.localeCompare(a.receiptDate);
      return cmp !== 0 ? cmp : b.createdAt.localeCompare(a.createdAt);
    });
  }, [state.receiptRecords]);

  return (
    <div className="space-y-6">
      {notice && (
        <div className="bg-white dark:bg-[#1E232D] border border-emerald-200 dark:border-emerald-900 rounded-xl p-4 flex items-center space-x-3 shadow-2xs">
          <CheckCircle2 size={19} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span className="text-sm font-bold text-slate-900 dark:text-slate-100">{notice}</span>
        </div>
      )}

      {errorNotice && (
        <div className="bg-white dark:bg-[#1E232D] border border-rose-200 dark:border-rose-900 rounded-xl p-4 flex items-center justify-between gap-3 shadow-2xs">
          <div className="flex items-center space-x-3">
            <AlertCircle size={19} className="text-rose-600 dark:text-rose-400 shrink-0" />
            <span className="text-sm font-bold text-rose-700 dark:text-rose-300">
              {errorNotice}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setErrorNotice(null)}
            className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* 상단: 엑셀 파일 자동 입고 업로드 박스 */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          const droppedFile = e.dataTransfer.files?.[0];
          if (droppedFile) handleExcelFile(droppedFile);
        }}
        className={`bg-white dark:bg-[#1E232D] border-2 border-dashed rounded-xl p-4 sm:p-5 transition-colors ${
          isDragging
            ? 'border-emerald-500 bg-emerald-50/40 dark:bg-emerald-950/20'
            : 'border-slate-300/90 dark:border-slate-700'
        }`}
      >
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
              <FileSpreadsheet size={20} />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100">
                엑셀 파일로 자재 입고 자동 등록
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                엑셀 파일을 올리면 <strong className="text-slate-700 dark:text-slate-200">현재 등록된 자재명만 찾아서</strong> 기존 이력 중복은 건너뛰고 새 내역만 등록합니다. (등록되지 않은 다른 자재는 자동 제외 · 육각볼트 → 헥사 볼트 매칭)
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                const selected = e.target.files?.[0];
                if (selected) handleExcelFile(selected);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={downloadReceiptImportTemplate}
              className="px-3 py-2 text-xs font-bold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 inline-flex items-center space-x-1.5 cursor-pointer transition"
            >
              <Download size={14} />
              <span>예시 양식</span>
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="px-4 py-2 text-xs sm:text-sm font-bold rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-white text-white dark:text-slate-900 inline-flex items-center space-x-1.5 cursor-pointer transition"
            >
              <Upload size={15} />
              <span>엑셀 파일 올리기</span>
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* 좌측: 직접 입고 등록 폼 */}
        <form
          onSubmit={handleSubmit}
          className="bg-white dark:bg-[#1E232D] border border-slate-200/90 dark:border-slate-800 rounded-xl p-5 shadow-2xs space-y-4 h-fit"
        >
          <div className="flex items-center space-x-2.5">
            <div className="w-9 h-9 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 flex items-center justify-center">
              <Truck size={18} />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                자재 입고 직접 등록
              </h2>
              <p className="text-xs text-slate-500">저장 시 현재 재고가 즉시 증가합니다.</p>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-1">
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                입고 자재(제품) 선택
              </label>
              <div className="flex items-center space-x-1.5">
                {selectedItem && (
                  <button
                    type="button"
                    onClick={() => {
                      if (isEditingSelectedMat) {
                        setIsEditingSelectedMat(false);
                      } else {
                        setEditMatName(selectedItem.name);
                        setEditMatSpec(selectedItem.specification || '');
                        setIsEditingSelectedMat(true);
                      }
                    }}
                    className="text-xs font-bold text-slate-700 dark:text-slate-200 hover:text-slate-950 dark:hover:text-white inline-flex items-center space-x-1 px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 cursor-pointer"
                  >
                    <Edit3 size={12} />
                    <span>품명 수정</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(true)}
                  className="text-xs font-bold text-slate-700 dark:text-slate-200 hover:text-slate-950 dark:hover:text-white inline-flex items-center space-x-1 px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 cursor-pointer"
                >
                  <Plus size={12} />
                  <span>새 자재 추가</span>
                </button>
              </div>
            </div>
            <select
              value={selectedItem?.id || ''}
              onChange={(e) => {
                setItemId(e.target.value);
                setIsEditingSelectedMat(false);
              }}
              className="w-full px-3 py-2.5 text-sm font-bold rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 outline-none cursor-pointer"
            >
              {receivableItems.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} ({item.specification || '-'}) — 현재고 {formatNum(item.currentStock)} {item.unit}
                </option>
              ))}
            </select>

            {isEditingSelectedMat && selectedItem && (
              <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={editMatName}
                    onChange={(e) => setEditMatName(e.target.value)}
                    placeholder="제품/자재명"
                    className="px-2.5 py-1.5 text-xs font-bold rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                  />
                  <input
                    type="text"
                    value={editMatSpec}
                    onChange={(e) => setEditMatSpec(e.target.value)}
                    placeholder="규격"
                    className="px-2.5 py-1.5 text-xs rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                  />
                </div>
                <div className="flex items-center justify-end space-x-1.5">
                  <button
                    type="button"
                    onClick={() => setIsEditingSelectedMat(false)}
                    className="px-2.5 py-1 text-xs font-semibold rounded border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 cursor-pointer"
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const trimmed = editMatName.trim();
                      if (!trimmed) return;
                      onUpdateMaterial(selectedItem.id, {
                        name: trimmed,
                        specification: editMatSpec.trim() || '-',
                      });
                      setIsEditingSelectedMat(false);
                      setNotice(`품명이 [${trimmed}] 으로 변경되었습니다.`);
                      setTimeout(() => setNotice(null), 3500);
                    }}
                    className="px-2.5 py-1 text-xs font-bold rounded bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer"
                  >
                    저장
                  </button>
                </div>
              </div>
            )}
          </div>

          {selectedItem && (
            <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500">
                  규격: <strong className="text-slate-800 dark:text-slate-200">{selectedItem.specification || '-'}</strong>
                </span>
                <span className="text-slate-500">
                  입고 후 예상 재고:{' '}
                  <strong className="font-mono text-emerald-600 dark:text-emerald-400">
                    {formatNum(selectedItem.currentStock + numericQty)} {selectedItem.unit}
                  </strong>
                </span>
              </div>
              <div className="pt-2 border-t border-slate-200/80 dark:border-slate-700/80 flex items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-500">
                  <span>
                    입고누계:{' '}
                    <strong className="font-mono text-slate-800 dark:text-slate-200">
                      {formatNum(selectedItem.totalInbound)} {selectedItem.unit}
                    </strong>
                  </span>
                  <span>
                    사용누계:{' '}
                    <strong className="font-mono text-amber-600 dark:text-amber-400">
                      {formatNum(selectedItem.totalUsed)} {selectedItem.unit}
                    </strong>
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => openEditTotalUsedModal(selectedItem.id)}
                  className="px-2.5 py-1 text-xs font-bold rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/50 dark:hover:bg-amber-950/80 text-amber-800 dark:text-amber-300 inline-flex items-center space-x-1 shrink-0 cursor-pointer transition"
                >
                  <Edit3 size={12} />
                  <span>사용누계 수정</span>
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                입고일
              </label>
              <input
                type="date"
                required
                value={receiptDate}
                onChange={(e) => setReceiptDate(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono font-bold rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                입고 수량 ({selectedItem?.unit || 'EA'})
              </label>
              <input
                type="text"
                inputMode="numeric"
                required
                value={qtyInput}
                onChange={(e) => handleQtyChange(e.target.value)}
                className="w-full px-3 py-2 text-base font-extrabold font-mono text-right rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                공급업체
              </label>
              <input
                type="text"
                value={supplier}
                onChange={(e) => setSupplier(e.target.value)}
                placeholder="예: 다인철강"
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                담당자
              </label>
              <input
                type="text"
                value={worker}
                onChange={(e) => setWorker(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
              비고
            </label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="송장번호, 검수 메모 등"
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
            />
          </div>

          <button
            type="submit"
            disabled={!selectedItem || numericQty <= 0}
            className="w-full py-2.5 px-4 rounded-xl text-sm font-bold bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-white text-white dark:text-slate-900 transition cursor-pointer disabled:opacity-40"
          >
            입고 저장 및 재고 반영
          </button>
        </form>

        {/* 우측: 입고 이력 테이블 */}
        <div className="xl:col-span-2 bg-white dark:bg-[#1E232D] border border-slate-200/90 dark:border-slate-800 rounded-xl shadow-2xs overflow-hidden flex flex-col">
          <div className="p-4 sm:p-5 border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                자재 입고 이력 ({sortedReceipts.length}건)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                입고 내역을 취소하면 해당 수량만큼 현재 재고에서 차감 원복됩니다.
              </p>
            </div>
            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={() => openEditTotalUsedModal(selectedItem?.id)}
                disabled={receivableItems.length === 0}
                className="px-3 py-1.5 text-xs font-bold rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/40 dark:hover:bg-amber-950/70 text-amber-800 dark:text-amber-300 flex items-center space-x-1.5 cursor-pointer transition disabled:opacity-40"
              >
                <Edit3 size={13} />
                <span>사용누계 수정</span>
              </button>
              <button
                type="button"
                onClick={onExportReceipts}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-250 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 text-slate-700 dark:text-slate-200 flex items-center space-x-1 cursor-pointer"
              >
                <FileSpreadsheet size={14} className="text-emerald-600 dark:text-emerald-400" />
                <span>엑셀</span>
              </button>
            </div>
          </div>

          <div className="overflow-x-auto flex-1">
            <table className="w-full text-left border-collapse min-w-[680px]">
              <thead className="bg-slate-50 dark:bg-slate-800/80 text-xs font-bold text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th className="py-3 px-4">입고일</th>
                  <th className="py-3 px-4">자재명 / 규격</th>
                  <th className="py-3 px-3 text-right">입고 수량</th>
                  <th className="py-3 px-3">공급업체</th>
                  <th className="py-3 px-3">담당자</th>
                  <th className="py-3 px-3">비고</th>
                  <th className="py-3 px-3 text-center w-24">관리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-150 dark:divide-slate-800 text-sm">
                {sortedReceipts.map((r) => (
                  <tr
                    key={r.id}
                    className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                  >
                    <td className="py-3 px-4 font-mono text-xs font-bold text-slate-700 dark:text-slate-300">
                      {r.receiptDate}
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-bold text-slate-900 dark:text-slate-100">
                        {r.itemName}
                      </div>
                      <div className="text-xs font-mono text-slate-400">{r.specification}</div>
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums font-extrabold text-emerald-600 dark:text-emerald-400">
                      +{formatNum(r.quantity)}{' '}
                      <span className="text-xs font-normal text-slate-400">{r.unit}</span>
                    </td>
                    <td className="py-3 px-3 text-xs text-slate-600 dark:text-slate-300">
                      {r.supplier}
                    </td>
                    <td className="py-3 px-3 text-xs text-slate-600 dark:text-slate-400">
                      {r.worker}
                    </td>
                    <td className="py-3 px-3 text-xs text-slate-500">{r.note || '-'}</td>
                    <td className="py-3 px-3 text-center">
                      <div className="inline-flex items-center space-x-1">
                        <button
                          type="button"
                          onClick={() => openEditReceipt(r)}
                          className="p-1.5 text-slate-400 hover:text-slate-900 dark:hover:text-white rounded hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer"
                          title="입고 품목 · 수량 수정"
                        >
                          <Edit3 size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setCancelTarget(r)}
                          className="p-1.5 text-slate-400 hover:text-rose-600 rounded hover:bg-rose-50 dark:hover:bg-rose-950/30 cursor-pointer"
                          title="입고 취소"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* 엑셀 분석 결과 & 신규 입고 확인 모달 */}
      {importPreview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-[2px]"
          onClick={() => setImportPreview(null)}
        >
          <div
            className="w-full max-w-3xl bg-white dark:bg-[#1E232D] border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-white">
                  엑셀 입고 내역 자동 판별 결과
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  파일: {importPreview.fileName} (시트: {importPreview.result.sheetName})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setImportPreview(null)}
                className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4">
              {/* 판별 요약 3칸 */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-3.5 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/60">
                  <div className="text-xs font-bold text-emerald-700 dark:text-emerald-300">
                    입고 등록 예정 (선택 포함)
                  </div>
                  <div className="text-2xl font-black font-mono text-emerald-700 dark:text-emerald-400 mt-1">
                    {formatNum(selectedImportCounts.totalSelected)}건
                  </div>
                  {selectedImportCounts.unregSelected > 0 && (
                    <div className="text-[11px] font-bold text-amber-700 dark:text-amber-400 mt-0.5">
                      미등록 중 {selectedImportCounts.unregSelected}건 직접 선택 포함
                    </div>
                  )}
                </div>

                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                  <div className="text-xs font-bold text-slate-600 dark:text-slate-400">
                    이미 등록됨 (자동 건너뜀)
                  </div>
                  <div className="text-2xl font-black font-mono text-slate-700 dark:text-slate-300 mt-1">
                    {formatNum(importPreview.result.duplicateRows.length)}건
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                  <div className="text-xs font-bold text-slate-600 dark:text-slate-400">
                    미등록 자재 (선택 시 추가 가능)
                  </div>
                  <div className="text-2xl font-black font-mono text-slate-500 dark:text-slate-400 mt-1">
                    {formatNum(importPreview.result.unregisteredRows.length)}건
                  </div>
                </div>
              </div>

              {importPreview.result.unregisteredRows.length > 0 && (
                <div className="p-3 rounded-xl bg-amber-50/70 dark:bg-amber-950/25 border border-amber-200/80 dark:border-amber-900/50 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="text-amber-800 dark:text-amber-300 font-semibold">
                    <strong>미등록 자재</strong>는 기본적으로 제외됩니다. 넣고 싶은 항목은 체크박스를 선택하거나 기존 자재와 연결해 주세요.
                  </span>
                  <div className="flex items-center space-x-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        const next: Record<number, { include: boolean; targetItemId: string }> = {};
                        importPreview.result.unregisteredRows.forEach((r) => {
                          next[r.rowIndex] = {
                            include: true,
                            targetItemId: unregisteredOverrides[r.rowIndex]?.targetItemId || '',
                          };
                        });
                        setUnregisteredOverrides(next);
                      }}
                      className="px-2.5 py-1 rounded bg-white dark:bg-slate-800 border border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-300 font-bold hover:bg-amber-50 cursor-pointer"
                    >
                      미등록 전체 선택
                    </button>
                    <button
                      type="button"
                      onClick={() => setUnregisteredOverrides({})}
                      className="px-2.5 py-1 rounded bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-bold hover:bg-slate-50 cursor-pointer"
                    >
                      선택 해제
                    </button>
                  </div>
                </div>
              )}

              {selectedImportCounts.totalSelected === 0 &&
                importPreview.result.unregisteredRows.length === 0 && (
                  <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-xs sm:text-sm font-bold text-slate-700 dark:text-slate-300">
                    엑셀의 모든 내역이 이미 입고 이력에 등록되어 있어 추가로 반영할 항목이 없습니다.
                  </div>
                )}

              {/* 행별 미리보기 테이블 */}
              <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                <div className="overflow-x-auto max-h-[45vh]">
                  <table className="w-full text-left border-collapse text-xs sm:text-sm">
                    <thead className="bg-slate-50 dark:bg-slate-800/80 text-xs font-bold text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700 sticky top-0 z-10">
                      <tr>
                        <th className="py-2.5 px-3">선택 / 판별</th>
                        <th className="py-2.5 px-3">입고일</th>
                        <th className="py-2.5 px-3">자재명 / 연결 설정</th>
                        <th className="py-2.5 px-3 text-right">수량</th>
                        <th className="py-2.5 px-3">공급업체</th>
                        <th className="py-2.5 px-3">비고</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-150 dark:divide-slate-800">
                      {importPreview.result.allRows.map((row) => {
                        const isDup = row.status === 'DUPLICATE';
                        const isNew = row.status === 'NEW';
                        const isUnreg = row.status === 'UNREGISTERED';

                        const isNewIncluded = isNew && !excludedNewRows.has(row.rowIndex);
                        const unregState = unregisteredOverrides[row.rowIndex] || {
                          include: false,
                          targetItemId: '',
                        };
                        const isWillImport = isNewIncluded || (isUnreg && unregState.include);

                        return (
                          <tr
                            key={`${row.rowIndex}-${row.receiptDate}-${row.resolvedName}`}
                            className={
                              isWillImport
                                ? 'bg-white dark:bg-[#1E232D]'
                                : 'bg-slate-50/60 dark:bg-slate-800/20 text-slate-400 dark:text-slate-500'
                            }
                          >
                            <td className="py-2.5 px-3 whitespace-nowrap">
                              {isNew && (
                                <label className="inline-flex items-center space-x-2 cursor-pointer select-none">
                                  <input
                                    type="checkbox"
                                    checked={isNewIncluded}
                                    onChange={(e) => {
                                      setExcludedNewRows((prev) => {
                                        const next = new Set(prev);
                                        if (e.target.checked) next.delete(row.rowIndex);
                                        else next.add(row.rowIndex);
                                        return next;
                                      });
                                    }}
                                    className="w-4 h-4 rounded accent-emerald-600 cursor-pointer"
                                  />
                                  <span
                                    className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded text-xs font-bold ${
                                      isNewIncluded
                                        ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                                        : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                                    }`}
                                  >
                                    {isNewIncluded ? <Check size={12} /> : <X size={12} />}
                                    <span>{isNewIncluded ? '신규 등록' : '선택 제외'}</span>
                                  </span>
                                </label>
                              )}

                              {isDup && (
                                <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-xs font-bold bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                                  <SkipForward size={12} />
                                  <span>기존 건너뜀</span>
                                </span>
                              )}

                              {isUnreg && (
                                <label className="inline-flex items-center space-x-2 cursor-pointer select-none">
                                  <input
                                    type="checkbox"
                                    checked={unregState.include}
                                    onChange={(e) => {
                                      setUnregisteredOverrides((prev) => ({
                                        ...prev,
                                        [row.rowIndex]: {
                                          include: e.target.checked,
                                          targetItemId: prev[row.rowIndex]?.targetItemId || '',
                                        },
                                      }));
                                    }}
                                    className="w-4 h-4 rounded accent-amber-600 cursor-pointer"
                                  />
                                  <span
                                    className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded text-xs font-bold ${
                                      unregState.include
                                        ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                                        : 'bg-rose-50/70 text-rose-500 dark:bg-rose-950/30 dark:text-rose-400'
                                    }`}
                                  >
                                    {unregState.include ? <Plus size={12} /> : <X size={12} />}
                                    <span>{unregState.include ? '선택 추가' : '미등록 제외'}</span>
                                  </span>
                                </label>
                              )}
                            </td>

                            <td className="py-2.5 px-3 font-mono text-xs whitespace-nowrap">
                              {row.receiptDate}
                            </td>

                            <td className="py-2.5 px-3">
                              <div
                                className={`font-bold ${
                                  isWillImport ? 'text-slate-900 dark:text-slate-100' : ''
                                }`}
                              >
                                {row.resolvedName}
                                {row.rawName !== row.resolvedName && (
                                  <span className="ml-1.5 text-[11px] font-normal text-slate-400">
                                    (엑셀: {row.rawName})
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] font-mono text-slate-400">
                                {row.specification}
                              </div>

                              {isUnreg && (
                                <select
                                  value={unregState.targetItemId}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setUnregisteredOverrides((prev) => ({
                                      ...prev,
                                      [row.rowIndex]: {
                                        include: true,
                                        targetItemId: val,
                                      },
                                    }));
                                  }}
                                  className="mt-1.5 w-full max-w-[230px] px-2 py-1 text-[11px] font-semibold rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 cursor-pointer"
                                >
                                  <option value="">
                                    + 새 자재({row.resolvedName})로 등록 후 입고
                                  </option>
                                  <optgroup label="기존 등록 자재에 연결">
                                    {receivableItems.map((it) => (
                                      <option key={it.id} value={it.id}>
                                        기존 연결: {it.name} ({it.specification || '-'})
                                      </option>
                                    ))}
                                  </optgroup>
                                </select>
                              )}
                            </td>

                            <td
                              className={`py-2.5 px-3 text-right font-mono font-bold whitespace-nowrap ${
                                isWillImport ? 'text-emerald-600 dark:text-emerald-400' : ''
                              }`}
                            >
                              {isDup ? (
                                <span>
                                  +{formatNum(row.quantity)} {row.unit}
                                </span>
                              ) : (
                                <div className="inline-flex items-center space-x-1">
                                  <input
                                    type="number"
                                    min="1"
                                    value={qtyOverrides[row.rowIndex] ?? row.quantity}
                                    onChange={(e) => {
                                      const val = Math.max(
                                        1,
                                        parseInt(e.target.value, 10) || row.quantity
                                      );
                                      setQtyOverrides((prev) => ({
                                        ...prev,
                                        [row.rowIndex]: val,
                                      }));
                                    }}
                                    className="w-24 px-2 py-1 text-right text-xs font-mono font-bold rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                                  />
                                  <span className="text-[11px] font-normal text-slate-400">
                                    {row.unit}
                                  </span>
                                </div>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-xs">{row.supplier || '-'}</td>
                            <td className="py-2.5 px-3 text-xs">{row.note || '-'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="px-5 py-3.5 bg-slate-50/80 dark:bg-slate-800/60 border-t border-slate-200/80 dark:border-slate-800 flex items-center justify-end space-x-2">
              <button
                type="button"
                onClick={() => setImportPreview(null)}
                className="px-4 py-2 text-sm font-semibold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 cursor-pointer"
              >
                닫기
              </button>
              {selectedImportCounts.totalSelected > 0 && (
                <button
                  type="button"
                  onClick={handleConfirmBatchImport}
                  className="px-4 py-2 text-sm font-bold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white inline-flex items-center space-x-1.5 cursor-pointer"
                >
                  <Check size={16} />
                  <span>선택된 {formatNum(selectedImportCounts.totalSelected)}건 자동 입고 등록</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 입고 내역 수정 모달 (제품명/품목 변경 및 수량 수정) */}
      {editingReceipt && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-[2px]"
          onClick={() => setEditingReceipt(null)}
        >
          <div
            className="w-full max-w-md bg-white dark:bg-[#1E232D] border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                자재 입고 내역 수정
              </h3>
              <button
                type="button"
                onClick={() => setEditingReceipt(null)}
                className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveEditReceipt} className="p-5 space-y-3.5">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  제품명 / 입고 자재 선택
                </label>
                <select
                  value={editRecItemId}
                  onChange={(e) => setEditRecItemId(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-bold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white cursor-pointer"
                >
                  {receivableItems.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} ({item.specification || '-'}) — 현재고 {formatNum(item.currentStock)} {item.unit}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    입고일
                  </label>
                  <input
                    type="date"
                    required
                    value={editRecDate}
                    onChange={(e) => setEditRecDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono font-bold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    입고 수량
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    required
                    value={editRecQty}
                    onChange={(e) => {
                      const digits = e.target.value.replace(/[^0-9]/g, '');
                      setEditRecQty(digits ? Number(digits).toLocaleString('ko-KR') : '');
                    }}
                    className="w-full px-3 py-2 text-base font-extrabold font-mono text-right rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    공급업체
                  </label>
                  <input
                    type="text"
                    value={editRecSupplier}
                    onChange={(e) => setEditRecSupplier(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    담당자
                  </label>
                  <input
                    type="text"
                    value={editRecWorker}
                    onChange={(e) => setEditRecWorker(e.target.value)}
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
                  value={editRecNote}
                  onChange={(e) => setEditRecNote(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                />
              </div>

              <div className="pt-2 flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setEditingReceipt(null)}
                  className="px-4 py-2 text-sm font-semibold rounded-lg border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm font-bold rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-white text-white dark:text-slate-900 cursor-pointer"
                >
                  수정 반영
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={Boolean(cancelTarget)}
        title="입고 내역 취소"
        description={
          cancelTarget
            ? `${cancelTarget.receiptDate} [${cancelTarget.itemName}] +${formatNum(
                cancelTarget.quantity
              )} ${cancelTarget.unit} 입고 기록을 취소하시겠습니까?\n취소 시 현재 재고에서 해당 수량이 차감됩니다.`
            : ''
        }
        confirmLabel="입고 취소"
        onConfirm={() => {
          if (cancelTarget) {
            onCancelReceipt(cancelTarget.id);
            setCancelTarget(null);
          }
        }}
        onCancel={() => setCancelTarget(null)}
      />

      {/* 사용누계 숫자 수정 모달 */}
      {isUsedModalOpen && usedModalItem && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-[2px]"
          onClick={() => setIsUsedModalOpen(false)}
        >
          <div
            className="w-full max-w-md bg-white dark:bg-[#1E232D] border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  자재 사용누계 수정
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  자재의 누적 사용 수량(사용누계)을 직접 변경합니다.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsUsedModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveTotalUsed} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  자재 선택
                </label>
                <select
                  value={usedModalItem.id}
                  onChange={(e) => handleSelectUsedModalItem(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-bold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white cursor-pointer"
                >
                  {receivableItems.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} ({item.specification || '-'}) — 사용누계 {formatNum(item.totalUsed)} {item.unit}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center p-3 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700">
                <div>
                  <div className="text-[11px] font-semibold text-slate-500">입고누계</div>
                  <div className="text-sm font-extrabold font-mono text-slate-800 dark:text-slate-200 mt-0.5">
                    {formatNum(usedModalItem.totalInbound)}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] font-semibold text-slate-500">현재 사용누계</div>
                  <div className="text-sm font-extrabold font-mono text-amber-600 dark:text-amber-400 mt-0.5">
                    {formatNum(usedModalItem.totalUsed)}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] font-semibold text-slate-500">현재 재고</div>
                  <div className="text-sm font-extrabold font-mono text-emerald-600 dark:text-emerald-400 mt-0.5">
                    {formatNum(usedModalItem.currentStock)}
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  변경할 사용누계 ({usedModalItem.unit})
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  required
                  value={usedQtyInput}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/[^0-9]/g, '');
                    setUsedQtyInput(digits === '' ? '' : Number(digits).toLocaleString('ko-KR'));
                  }}
                  placeholder="0"
                  className="w-full px-3 py-2.5 text-lg font-extrabold font-mono text-right rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                />
              </div>

              <label className="flex items-start space-x-2.5 p-3 rounded-xl bg-amber-50/70 dark:bg-amber-950/25 border border-amber-200/80 dark:border-amber-900/50 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={usedSyncStock}
                  onChange={(e) => setUsedSyncStock(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded accent-amber-600 cursor-pointer"
                />
                <div className="text-xs space-y-1">
                  <div className="font-bold text-amber-900 dark:text-amber-200">
                    사용누계 변경분만큼 현재 재고도 자동 반영
                  </div>
                  <div className="text-amber-800/80 dark:text-amber-300/80 font-mono">
                    사용누계: {formatNum(usedModalItem.totalUsed)} →{' '}
                    <strong>{formatNum(numericUsedQty)}</strong> {usedModalItem.unit}
                    <br />
                    현재 재고: {formatNum(usedModalItem.currentStock)} →{' '}
                    <strong>
                      {formatNum(
                        usedSyncStock
                          ? Math.max(
                              0,
                              usedModalItem.currentStock - (numericUsedQty - usedModalItem.totalUsed)
                            )
                          : usedModalItem.currentStock
                      )}
                    </strong>{' '}
                    {usedModalItem.unit}
                  </div>
                </div>
              </label>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  수정 사유
                </label>
                <input
                  type="text"
                  value={usedReason}
                  onChange={(e) => setUsedReason(e.target.value)}
                  placeholder="예: 실제 사용량 정정"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                />
              </div>

              <div className="pt-2 flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setIsUsedModalOpen(false)}
                  className="px-4 py-2 text-sm font-semibold rounded-lg border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm font-bold rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-white text-white dark:text-slate-900 cursor-pointer"
                >
                  사용누계 저장
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <AddMaterialModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onAddMaterial={onAddMaterial}
        onCreated={(createdId, createdName) => {
          setItemId(createdId);
          setNotice(`새 자재 [${createdName}] 이(가) 추가되어 바로 선택되었습니다.`);
          setTimeout(() => setNotice(null), 3500);
        }}
      />
    </div>
  );
};
