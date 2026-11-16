import React, { useState, useMemo } from 'react';
import {
  X,
  FileSpreadsheet,
  Receipt,
  Sparkles,
  Link2,
  Search,
  Check,
  Building2,
  Calendar,
  Layers,
  ArrowRight,
} from 'lucide-react';
import { MaterialSheet, MaterialItem } from '../App';

interface DropSlipIntentModalProps {
  isOpen: boolean;
  onClose: () => void;
  file: File | null;
  sheets: MaterialSheet[];
  activeTabId: string;
  onAttachToExistingItem: (sheetId: string, item: MaterialItem, file: File) => void;
  onProceedToAiScan: (file: File) => void;
}

export default function DropSlipIntentModal({
  isOpen,
  onClose,
  file,
  sheets,
  activeTabId,
  onAttachToExistingItem,
  onProceedToAiScan,
}: DropSlipIntentModalProps) {
  const [selectedSheetId, setSelectedSheetId] = useState<string>(() => {
    if (activeTabId !== 'ALL' && sheets.some((s) => s.id === activeTabId)) {
      return activeTabId;
    }
    return sheets[0]?.id || '';
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Generate object preview URL for dropped file
  React.useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const currentSheet = useMemo(() => {
    return sheets.find((s) => s.id === selectedSheetId) || sheets[0] || null;
  }, [sheets, selectedSheetId]);

  const filteredItems = useMemo(() => {
    if (!currentSheet) return [];
    const q = searchQuery.trim().toLowerCase();
    if (!q) return currentSheet.items;
    return currentSheet.items.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        (item.supplier && item.supplier.toLowerCase().includes(q)) ||
        (item.spec && item.spec.toLowerCase().includes(q))
    );
  }, [currentSheet, searchQuery]);

  if (!isOpen || !file) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 no-print animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl border border-slate-300 shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3.5 bg-slate-900 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center shrink-0">
              <Receipt className="w-4 h-4 text-white" />
            </div>
            <div>
              <h3 className="font-bold text-sm sm:text-base leading-tight">
                전표 사진 등록 방식 선택
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                끌어온 사진: <strong className="text-slate-200">{file.name}</strong> ({Math.round(file.size / 1024)} KB)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1.5 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Notice Banner */}
        <div className="bg-amber-50 border-b border-amber-200 px-5 py-2.5 text-xs text-amber-900 flex items-center gap-2 shrink-0">
          <span className="font-bold shrink-0 bg-amber-200 text-amber-950 px-1.5 py-0.5 rounded text-[11px]">
            안내
          </span>
          <span className="leading-snug">
            기존에 이미 대장에 있는 자재에 전표를 등록하시려면 <strong>왼쪽 [기존 자재 선택]</strong>을, 새 품목으로 등록하시려면 <strong>오른쪽 [신규 자재 자동 등록]</strong>을 선택하세요.
          </span>
        </div>

        {/* Content split in two primary actions */}
        <div className="p-5 overflow-y-auto flex-1 min-h-0 space-y-5 bg-slate-50/50">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
            {/* Left: Attach to Existing Item (Primary for user's intent) */}
            <div className="md:col-span-7 bg-white p-4 rounded-xl border-2 border-blue-500 shadow-xs flex flex-col">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <div className="w-6 h-6 rounded-md bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-xs">
                    1
                  </div>
                  <h4 className="font-bold text-sm text-slate-900">
                    기존 등록된 자재에 전표 사진 첨부
                  </h4>
                </div>
                <span className="text-[11px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
                  추천
                </span>
              </div>
              <p className="text-xs text-slate-500 mb-3">
                이미 작성된 품목 중 하나를 골라 이 전표를 연결합니다. (기존 품목 내용 유지)
              </p>

              {/* Sheet Selector */}
              <div className="mb-2 flex items-center gap-2">
                <label className="text-xs font-semibold text-slate-600 shrink-0">
                  시트 선택:
                </label>
                <select
                  value={selectedSheetId}
                  onChange={(e) => setSelectedSheetId(e.target.value)}
                  className="w-full text-xs font-semibold bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-blue-500"
                >
                  {sheets.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.items.length}개 자재)
                    </option>
                  ))}
                </select>
              </div>

              {/* Item Search Input */}
              <div className="relative mb-2">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="품목명, 구매처 또는 규격으로 검색..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {/* Items List */}
              <div className="flex-1 max-h-56 overflow-y-auto space-y-1.5 border border-slate-200 rounded-lg p-1.5 bg-slate-50/70">
                {filteredItems.length === 0 ? (
                  <div className="py-6 text-center text-xs text-slate-400">
                    검색된 자재가 없습니다.
                  </div>
                ) : (
                  filteredItems.map((item) => {
                    const currentSlips = item.slipIds || (item.slipId ? [item.slipId] : []);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          onAttachToExistingItem(selectedSheetId, item, file);
                          onClose();
                        }}
                        className="w-full text-left p-2.5 bg-white hover:bg-blue-50 hover:border-blue-300 border border-slate-200 rounded-lg transition-all group flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-xs text-slate-900 group-hover:text-blue-900 truncate">
                              {item.name}
                            </span>
                            {item.supplier && (
                              <span className="text-[10px] px-1.5 py-0.2 bg-slate-100 text-slate-700 rounded font-semibold truncate shrink-0">
                                {item.supplier}
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-500 mt-0.5 truncate">
                            규격: {item.spec || '-'} · 수량: {item.quantity} {item.unit}
                            {currentSlips.length > 0 && (
                              <span className="ml-1 text-amber-700 font-semibold">
                                (현재 전표 {currentSlips.length}장)
                              </span>
                            )}
                          </div>
                        </div>
                        <span className="px-2.5 py-1 bg-blue-600 group-hover:bg-blue-700 text-white rounded text-xs font-bold shrink-0 flex items-center gap-1 transition-colors shadow-2xs">
                          <span>연결</span>
                          <ArrowRight className="w-3 h-3" />
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {/* Right: Proceed to AI Scan as New Items */}
            <div className="md:col-span-5 bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <div className="w-6 h-6 rounded-md bg-purple-100 text-purple-700 flex items-center justify-center font-bold text-xs">
                    2
                  </div>
                  <h4 className="font-bold text-sm text-slate-900">
                    신규 자재로 자동 등록 (AI 분석)
                  </h4>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed mb-4">
                  전표 사진 안의 품목명, 규격, 수량을 AI가 자동 판독하여 대장에 <strong>새로운 품목 행</strong>으로 추가합니다.
                </p>

                {previewUrl && (
                  <div className="mb-3 rounded-lg overflow-hidden border border-slate-200 bg-slate-100 max-h-36 flex items-center justify-center">
                    <img
                      src={previewUrl}
                      alt="전표 미리보기"
                      className="max-h-36 w-full object-contain"
                    />
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => {
                  onProceedToAiScan(file);
                  onClose();
                }}
                className="w-full py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-bold text-xs rounded-xl shadow-xs flex items-center justify-center gap-1.5 transition-all"
              >
                <Sparkles className="w-4 h-4" />
                <span>AI 전표 분석기로 신규 등록</span>
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs text-slate-500 shrink-0">
          <span>💡 팁: 대장 표의 특정 자재 줄에 직접 사진을 끌어다 놓으면 이 창 없이 바로 첨부됩니다.</span>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-lg font-semibold transition-colors"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
