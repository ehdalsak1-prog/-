import React, { useState, useMemo, useRef } from 'react';
import {
  X,
  Search,
  Download,
  Eye,
  Trash2,
  Calendar,
  Building2,
  Receipt,
  Plus,
  FileText,
  Boxes,
  Sparkles,
  Camera,
  Upload,
} from 'lucide-react';
import { StoredReceiptSlip } from '../utils/slipStorage';
import { MaterialSheet } from '../App';

interface SlipArchiveModalProps {
  isOpen: boolean;
  onClose: () => void;
  slips: StoredReceiptSlip[];
  sheets: MaterialSheet[];
  activeTabId: string;
  onSelectSlip: (slip: StoredReceiptSlip) => void;
  onDeleteSlip: (slipId: string) => void;
  onClearAllSlips?: () => void;
  onOpenScanNewSlip: (initialFile?: File) => void;
}

export default function SlipArchiveModal({
  isOpen,
  onClose,
  slips = [],
  sheets = [],
  activeTabId,
  onSelectSlip,
  onDeleteSlip,
  onClearAllSlips,
  onOpenScanNewSlip,
}: SlipArchiveModalProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [filterSheetId, setFilterSheetId] = useState<string>('ALL');
  const [isDragging, setIsDragging] = useState(false);
  const [confirmDeleteSlipId, setConfirmDeleteSlipId] = useState<string | null>(null);
  const [showClearAllConfirm, setShowClearAllConfirm] = useState(false);
  const [visibleLimit, setVisibleLimit] = useState(24);

  // Safe slips list
  const safeSlips = Array.isArray(slips) ? slips : [];

  const filteredSlips = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return safeSlips.filter((s) => {
      if (!s) return false;
      const supplier = (s.supplierName || '').toLowerCase();
      const title = (s.title || '').toLowerCase();
      const docType = (s.documentType || '').toLowerCase();
      const docDate = s.documentDate || '';
      const notes = (s.notes || '').toLowerCase();
      const itemNames = Array.isArray(s.itemNames) ? s.itemNames : [];

      const matchSearch =
        !q ||
        supplier.includes(q) ||
        title.includes(q) ||
        docType.includes(q) ||
        docDate.includes(q) ||
        notes.includes(q) ||
        itemNames.some((n) => (n || '').toLowerCase().includes(q));

      const matchSheet =
        filterSheetId === 'ALL' || s.sheetId === filterSheetId;

      return matchSearch && matchSheet;
    });
  }, [safeSlips, searchTerm, filterSheetId]);

  if (!isOpen) return null;

  const handleDownloadSlip = (slip: StoredReceiptSlip, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!slip?.imageUrl) return;
    const cleanSupplier = (slip.supplierName || '전표').replace(/[\\/:*?"<>|]/g, '');
    const cleanDate = slip.documentDate || new Date().toISOString().split('T')[0];
    const link = document.createElement('a');
    link.href = slip.imageUrl;
    link.download = `전표_${cleanSupplier}_${cleanDate}.jpg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDirectFileSelected = (file: File) => {
    if (file && file.type.startsWith('image/')) {
      onClose();
      onOpenScanNewSlip(file);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 no-print animate-in fade-in duration-200"
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (file) handleDirectFileSelected(file);
      }}
    >
      <input
        type="file"
        ref={fileInputRef}
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleDirectFileSelected(file);
        }}
      />

      <div className="bg-white rounded-2xl border border-slate-300 shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-amber-500 text-white flex items-center justify-center shrink-0 shadow-xs">
              <Receipt className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight">
                  전표 원본 사진 보관함
                </h2>
                <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800">
                  총 {safeSlips.length}건 소장 중
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                납품증·거래명세서·이설확인서 등 소장된 원본 사진을 언제든 확인하고 고화질로 다운로드할 수 있습니다.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {safeSlips.length > 0 && onClearAllSlips && !showClearAllConfirm && (
              <button
                type="button"
                onClick={() => setShowClearAllConfirm(true)}
                className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-300 rounded-lg text-xs font-bold transition-colors inline-flex items-center gap-1.5 shadow-2xs"
                title="보관함의 모든 전표 사진 전체 비우기 / 삭제"
              >
                <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                <span>전표 전체 비우기</span>
              </button>
            )}

            {safeSlips.length > 0 && onClearAllSlips && showClearAllConfirm && (
              <div className="flex items-center gap-1.5 bg-rose-50 border border-rose-300 p-1 rounded-lg animate-in fade-in">
                <span className="text-xs font-bold text-rose-800 px-1">모든 전표를 삭제할까요?</span>
                <button
                  type="button"
                  onClick={() => {
                    onClearAllSlips();
                    setShowClearAllConfirm(false);
                  }}
                  className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded text-xs font-bold shadow-xs"
                >
                  전체 삭제 확인
                </button>
                <button
                  type="button"
                  onClick={() => setShowClearAllConfirm(false)}
                  className="px-2 py-1 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded text-xs font-semibold"
                >
                  취소
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-colors inline-flex items-center gap-1.5 shadow-xs"
              title="새 전표 사진 업로드"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>전표 사진 추가</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg transition-colors ml-1"
              title="닫기"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Quick Action / Notice Strip */}
        <div className="bg-amber-50/70 px-5 py-2.5 border-b border-amber-200/80 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-900 shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              <strong>안내:</strong> 전표 사진을 클릭하면 <strong>확대/축소(Zoom)</strong>, <strong>90도 회전</strong>, <strong>소장용 사진 다운로드</strong>가 가능합니다.
            </span>
          </div>

          <div className="flex items-center gap-2 text-[11px] text-amber-800">
            <span>여기에 새 전표 사진을 바로 드래그하거나 붙여넣을 수도 있습니다</span>
          </div>
        </div>

        {/* Filter & Search Bar */}
        <div className="px-5 py-3 bg-white border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs shrink-0">
          <div className="flex items-center gap-2 flex-1 max-w-md">
            <div className="relative w-full">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="구매처, 품목명, 일자, 비고 검색..."
                className="w-full pl-9 pr-7 py-2 bg-slate-50 focus:bg-white border border-slate-300 rounded-lg outline-none focus:border-blue-500 transition-colors"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
            <span className="font-semibold text-slate-500 whitespace-nowrap">시트 필터:</span>
            <select
              value={filterSheetId}
              onChange={(e) => setFilterSheetId(e.target.value)}
              className="bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-1.5 font-semibold text-slate-700 outline-none focus:border-blue-500"
            >
              <option value="ALL">전체 시트 ({safeSlips.length})</option>
              {sheets.map((s) => {
                const count = safeSlips.filter((sl) => sl?.sheetId === s.id).length;
                return (
                  <option key={s.id} value={s.id}>
                    {s.name} ({count})
                  </option>
                );
              })}
            </select>
          </div>
        </div>

        {/* Slips Gallery Grid */}
        <div className="p-5 overflow-y-auto flex-1 min-h-0 bg-slate-50/50">
          {filteredSlips.length === 0 ? (
            <div className="text-center py-14 bg-white rounded-2xl border-2 border-dashed border-slate-300 p-6">
              <Receipt className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <h3 className="text-sm font-bold text-slate-800">
                {safeSlips.length === 0
                  ? '보관된 전표 사진이 없습니다.'
                  : '검색 조건에 맞는 전표가 없습니다.'}
              </h3>
              <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                {safeSlips.length === 0
                  ? '아래 버튼을 눌러 납품증이나 거래명세서 사진을 보관함에 등록해주세요.'
                  : `'${searchTerm}' 검색어 또는 선택된 시트 필터를 초기화해보세요.`}
              </p>

              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                {searchTerm && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchTerm('');
                      setFilterSheetId('ALL');
                    }}
                    className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold"
                  >
                    필터 초기화
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-colors inline-flex items-center gap-1.5 shadow-xs"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>사진 파일 선택하여 추가</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredSlips.slice(0, visibleLimit).map((slip) => {
                  const itemNames = Array.isArray(slip.itemNames) ? slip.itemNames : [];
                  return (
                    <div
                      key={slip.id}
                      onClick={() => onSelectSlip(slip)}
                      className="group bg-white border border-slate-200 hover:border-blue-500 rounded-xl overflow-hidden shadow-xs hover:shadow-md transition-all cursor-pointer flex flex-col"
                    >
                      {/* Image Thumbnail Container */}
                      <div className="h-44 bg-slate-900 relative overflow-hidden flex items-center justify-center">
                        {slip.imageUrl ? (
                          <img
                            src={slip.imageUrl}
                            alt={slip.title}
                            loading="lazy"
                            decoding="async"
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200 opacity-90 group-hover:opacity-100"
                            onError={(e) => {
                              // If asset path fails, fallback to clean text placeholder
                              (e.target as HTMLElement).style.display = 'none';
                            }}
                          />
                      ) : (
                        <div className="text-slate-500 flex flex-col items-center">
                          <FileText className="w-8 h-8 opacity-40 mb-1" />
                          <span className="text-[11px]">이미지 없음</span>
                        </div>
                      )}

                      <div className="absolute top-2 left-2 flex flex-wrap items-center gap-1.5">
                        <span className="px-2 py-0.5 rounded bg-blue-600/90 text-white font-bold text-[10px] shadow-xs backdrop-blur-xs">
                          {slip.documentType || '전표'}
                        </span>
                        {slip.sheetName && (
                          <span className="px-2 py-0.5 rounded bg-slate-900/80 text-slate-200 text-[10px] shadow-xs backdrop-blur-xs truncate max-w-[140px]">
                            {slip.sheetName}
                          </span>
                        )}
                      </div>

                      <div className="absolute bottom-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          type="button"
                          onClick={(e) => handleDownloadSlip(slip, e)}
                          className="p-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-md shadow-md text-xs font-semibold flex items-center gap-1"
                          title="소장용 원본 사진 다운로드 (.jpg)"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Slip Card Details */}
                    <div className="p-3.5 flex-1 flex flex-col justify-between">
                      <div>
                        <div className="flex items-start justify-between gap-1 mb-1">
                          <h4 className="font-bold text-sm text-slate-900 truncate">
                            {slip.supplierName || '구매처 미지정'}
                          </h4>
                          <span className="font-mono text-xs text-slate-500 shrink-0">
                            {slip.documentDate}
                          </span>
                        </div>

                        {itemNames.length > 0 && (
                          <div className="text-xs text-slate-600 line-clamp-1 mb-1">
                            <strong className="text-blue-700 font-semibold">
                              자재 {itemNames.length}건:
                            </strong>{' '}
                            {itemNames.slice(0, 3).join(', ')}
                            {itemNames.length > 3 && ` 외 ${itemNames.length - 3}건`}
                          </div>
                        )}

                        {slip.notes && (
                          <p className="text-[11px] text-slate-400 truncate">
                            비고: {slip.notes}
                          </p>
                        )}
                      </div>

                      <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs">
                        <span className="text-[11px] text-slate-400 font-mono">
                          {new Date(slip.createdAt || Date.now()).toLocaleDateString('ko-KR')} 등록
                        </span>

                        <div className="flex items-center gap-2">
                          {confirmDeleteSlipId === slip.id ? (
                            <div
                              className="flex items-center gap-1 bg-rose-50 border border-rose-300 p-0.5 rounded-md"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <span className="text-[11px] font-bold text-rose-800 px-1">삭제?</span>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onDeleteSlip(slip.id);
                                  setConfirmDeleteSlipId(null);
                                }}
                                className="px-2 py-0.5 bg-rose-600 hover:bg-rose-700 text-white rounded text-[11px] font-bold shadow-2xs"
                              >
                                삭제
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setConfirmDeleteSlipId(null);
                                }}
                                className="px-1.5 py-0.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded text-[11px]"
                              >
                                취소
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setConfirmDeleteSlipId(slip.id);
                              }}
                              className="px-2 py-1 text-xs font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-md transition-colors inline-flex items-center gap-1 shadow-2xs"
                              title="전표 보관함에서 삭제"
                            >
                              <Trash2 className="w-3 h-3 text-rose-600" />
                              <span>전표 삭제</span>
                            </button>
                          )}
                          <span className="text-blue-600 font-bold hover:underline inline-flex items-center gap-1 text-xs">
                            <span>크게 보기</span>
                            <Eye className="w-3.5 h-3.5" />
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                  );
                })}
              </div>

              {filteredSlips.length > visibleLimit && (
                <div className="flex items-center justify-center pt-2">
                  <button
                    type="button"
                    onClick={() => setVisibleLimit((prev) => prev + 24)}
                    className="px-4 py-2 rounded-lg bg-white hover:bg-blue-50 border border-slate-300 hover:border-blue-300 text-xs font-bold text-slate-700 hover:text-blue-700 transition-colors shadow-2xs"
                  >
                    전표 더 보기 ({visibleLimit} / {filteredSlips.length}장 표시 중)
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500 shrink-0">
          <span>
            총 <strong className="text-slate-800 font-bold">{safeSlips.length}</strong>장의 전표가 공용 보관함에 등록되어 있습니다.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="w-full sm:w-auto px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg font-semibold transition-colors"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
