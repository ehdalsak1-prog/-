import React, { useState } from 'react';
import {
  X,
  Download,
  ZoomIn,
  ZoomOut,
  RotateCw,
  Maximize2,
  Calendar,
  Building2,
  FileText,
  Boxes,
  ExternalLink,
  Trash2,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { StoredReceiptSlip } from '../utils/slipStorage';
import { MaterialItem } from '../App';

interface SlipViewerModalProps {
  slip: StoredReceiptSlip | null;
  isOpen: boolean;
  isLoading?: boolean;
  onClose: () => void;
  associatedItems?: MaterialItem[];
  onDeleteSlip?: (slipId: string) => void;
  allSlips?: StoredReceiptSlip[];
  onNavigateSlip?: (slipId: string) => void;
}

export default function SlipViewerModal({
  slip,
  isOpen,
  isLoading = false,
  onClose,
  associatedItems = [],
  onDeleteSlip,
  allSlips = [],
  onNavigateSlip,
}: SlipViewerModalProps) {
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [rotation, setRotation] = useState<number>(0);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  if (!isOpen) return null;

  if (!slip) {
    return (
      <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4 no-print">
        <div className="bg-white rounded-2xl border border-slate-300 p-6 max-w-sm w-full text-center shadow-2xl">
          <FileText className="w-12 h-12 text-blue-500 mx-auto mb-3 animate-pulse" />
          <h3 className="text-base font-bold text-slate-900">
            {isLoading ? '전표 이미지를 불러오는 중입니다...' : '전표 정보를 찾을 수 없습니다'}
          </h3>
          <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
            {isLoading
              ? '필요한 시점에 전표 원본을 불러오고 있습니다. 잠시만 기다려 주세요.'
              : '해당 전표 원본 데이터가 삭제되었거나 연결되지 않았습니다.'}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="mt-5 w-full py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-bold transition-colors"
          >
            확인
          </button>
        </div>
      </div>
    );
  }

  const handleZoomIn = () => setZoomLevel((prev) => Math.min(prev + 0.25, 3.0));
  const handleZoomOut = () => setZoomLevel((prev) => Math.max(prev - 0.25, 0.5));
  const handleResetZoom = () => {
    setZoomLevel(1);
    setRotation(0);
  };
  const handleRotate = () => setRotation((prev) => (prev + 90) % 360);

  const handleDownloadImage = async () => {
    if (!slip.imageUrl) return;
    const cleanSupplier = (slip.supplierName || '전표').replace(/[\\/:*?"<>|]/g, '');
    const cleanDate = slip.documentDate || new Date().toISOString().split('T')[0];
    const filename = `전표_${cleanSupplier}_${cleanDate}.jpg`;

    if (slip.imageUrl.startsWith('http')) {
      try {
        const res = await fetch(slip.imageUrl);
        if (res.ok) {
          const blob = await res.blob();
          const objUrl = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = objUrl;
          link.download = filename;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(objUrl);
          return;
        }
      } catch {
        // Fallback below
      }
    }

    const link = document.createElement('a');
    link.href = slip.imageUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 no-print animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl border border-slate-300 shadow-2xl w-full max-w-5xl max-h-[94vh] flex flex-col overflow-hidden">
        {/* Header Bar */}
        <div className="px-5 py-3.5 bg-slate-900 text-white flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="px-2.5 py-1 rounded-md bg-blue-600 font-bold text-xs uppercase tracking-wide">
              {slip.documentType || '전표 원본'}
            </span>
            <div className="min-w-0">
              <h3 className="text-sm sm:text-base font-bold text-white truncate flex items-center gap-2">
                <span>{slip.title || `${slip.supplierName} 전표`}</span>
                {slip.sheetName && (
                  <span className="text-xs font-normal text-slate-400">
                    · [{slip.sheetName}]
                  </span>
                )}
              </h3>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {allSlips.length > 1 && onNavigateSlip && (() => {
              const curIdx = allSlips.findIndex((s) => s.id === slip.id);
              return (
                <div className="flex items-center gap-1 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-xs shrink-0">
                  <button
                    type="button"
                    disabled={curIdx <= 0}
                    onClick={() => curIdx > 0 && onNavigateSlip(allSlips[curIdx - 1].id)}
                    className="p-1 hover:text-blue-400 disabled:opacity-30 disabled:hover:text-inherit transition-colors"
                    title="이전 전표"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="font-mono text-slate-200 px-1 font-bold text-xs">
                    {curIdx >= 0 ? curIdx + 1 : 1} / {allSlips.length}
                  </span>
                  <button
                    type="button"
                    disabled={curIdx >= allSlips.length - 1}
                    onClick={() => curIdx < allSlips.length - 1 && onNavigateSlip(allSlips[curIdx + 1].id)}
                    className="p-1 hover:text-blue-400 disabled:opacity-30 disabled:hover:text-inherit transition-colors"
                    title="다음 전표"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              );
            })()}

            <button
              type="button"
              onClick={handleDownloadImage}
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold transition-colors inline-flex items-center gap-1.5 shadow-xs"
              title="소장용 원본 전표 사진 다운로드 (.jpg)"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">사진 다운로드</span>
            </button>

            {onDeleteSlip && !showDeleteConfirm && (
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-bold transition-colors inline-flex items-center gap-1.5 shadow-xs"
                title="이 전표 사진 삭제"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">전표 삭제</span>
              </button>
            )}

            {onDeleteSlip && showDeleteConfirm && (
              <div className="flex items-center gap-1.5 bg-rose-950/90 p-1 rounded-lg border border-rose-500/60 animate-in fade-in">
                <span className="text-xs text-rose-200 font-bold px-1">정말 삭제할까요?</span>
                <button
                  type="button"
                  onClick={() => {
                    onDeleteSlip(slip.id);
                    onClose();
                  }}
                  className="px-2.5 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded text-xs font-bold shadow-xs"
                >
                  삭제 확인
                </button>
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(false)}
                  className="px-2 py-1 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded text-xs font-semibold"
                >
                  취소
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              title="닫기"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Multi-slip Tab Strip if more than 1 slip */}
        {allSlips.length > 1 && onNavigateSlip && (
          <div className="bg-slate-900/95 px-5 py-2 border-b border-slate-800 flex items-center gap-2 overflow-x-auto shrink-0">
            <span className="text-[11px] font-bold text-slate-400 whitespace-nowrap">
              연결된 전표 ({allSlips.length}장):
            </span>
            {allSlips.map((s, idx) => {
              const isCurrent = s.id === slip.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onNavigateSlip(s.id)}
                  className={`px-2.5 py-1 rounded-md text-xs font-bold transition-all flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                    isCurrent
                      ? 'bg-amber-400 text-slate-950 shadow-xs scale-105'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  <span>전표 {idx + 1}</span>
                  <span className="text-[10px] opacity-80 truncate max-w-[120px]">
                    {s.title || s.supplierName || s.documentType}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Metadata Strip */}
        <div className="bg-slate-100 px-5 py-2.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-700 shrink-0">
          <div className="flex flex-wrap items-center gap-3">
            {slip.supplierName && (
              <span className="inline-flex items-center gap-1 font-semibold text-slate-900">
                <Building2 className="w-3.5 h-3.5 text-blue-600" />
                <span>구매처: {slip.supplierName}</span>
              </span>
            )}
            {slip.documentDate && (
              <span className="inline-flex items-center gap-1 font-mono text-slate-600">
                <Calendar className="w-3.5 h-3.5 text-slate-500" />
                <span>일자: {slip.documentDate}</span>
              </span>
            )}
            {slip.totalAmount !== undefined && slip.totalAmount > 0 && (
              <span className="font-semibold text-slate-800">
                총액: {slip.totalAmount.toLocaleString()}원
              </span>
            )}
            {slip.notes && (
              <span className="text-slate-500 truncate max-w-xs" title={slip.notes}>
                비고: {slip.notes}
              </span>
            )}
          </div>

          {/* Zoom & Rotation Controls */}
          <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg p-0.5 shadow-2xs">
            <button
              type="button"
              onClick={handleZoomIn}
              className="p-1 rounded text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
              title="확대"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <span className="text-[11px] font-mono px-1 font-semibold text-slate-500 min-w-[42px] text-center">
              {Math.round(zoomLevel * 100)}%
            </span>
            <button
              type="button"
              onClick={handleZoomOut}
              className="p-1 rounded text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
              title="축소"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <div className="w-px h-3.5 bg-slate-200 mx-0.5" />
            <button
              type="button"
              onClick={handleRotate}
              className="p-1 rounded text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
              title="90도 회전 (세로/가로 맞춤)"
            >
              <RotateCw className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleResetZoom}
              className="px-2 py-0.5 text-[11px] font-medium text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded transition-colors"
              title="크기 원래대로"
            >
              초기화
            </button>
          </div>
        </div>

        {/* Modal Main Content: Image Viewer + Side Registered Items Bar */}
        <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-hidden">
          {/* Main Pan/Zoom Image Area */}
          <div className="flex-1 bg-slate-900 overflow-auto p-4 flex items-center justify-center relative select-none">
            {slip.imageUrl ? (
              <div
                style={{
                  transform: `scale(${zoomLevel}) rotate(${rotation}deg)`,
                  transition: 'transform 0.15s ease-out',
                }}
                className="max-w-full max-h-full flex items-center justify-center"
              >
                <img
                  src={slip.imageUrl}
                  alt={slip.title}
                  className="max-h-[75vh] w-auto object-contain rounded shadow-2xl"
                  draggable={false}
                />
              </div>
            ) : (
              <div className="text-center text-slate-400 py-12">
                <FileText className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>전표 이미지가 제공되지 않았습니다.</p>
              </div>
            )}
          </div>

          {/* Associated Items Side Panel */}
          {associatedItems.length > 0 && (
            <div className="w-full md:w-80 bg-white border-t md:border-t-0 md:border-l border-slate-200 p-4 overflow-y-auto max-h-60 md:max-h-none shrink-0 flex flex-col">
              <div className="flex items-center gap-1.5 pb-2.5 mb-2.5 border-b border-slate-200">
                <Boxes className="w-4 h-4 text-blue-600" />
                <h4 className="text-xs font-bold text-slate-900">
                  이 전표로 등록된 자재 ({associatedItems.length}건)
                </h4>
              </div>

              <div className="space-y-2 flex-1 overflow-y-auto">
                {associatedItems.map((item, idx) => (
                  <div
                    key={item.id}
                    className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                  >
                    <div className="flex items-start justify-between gap-1">
                      <span className="font-bold text-slate-900">{item.name}</span>
                      <span className="font-mono text-slate-400 text-[10px]">#{idx + 1}</span>
                    </div>
                    {item.spec && item.spec !== '-' && (
                      <div className="text-slate-500 text-[11px] mt-0.5">
                        규격: {item.spec}
                      </div>
                    )}
                    <div className="flex items-center justify-between mt-1 text-[11px]">
                      <span className="font-bold text-blue-700">
                        {item.quantity.toLocaleString()} {item.unit}
                      </span>
                      {item.packQty && (
                        <span className="text-slate-500 font-mono">
                          (입수 {item.packQty.toLocaleString()} {item.subUnit || 'EA'})
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500 shrink-0">
          <span>
            💾 안전하게 브라우저 로컬 저장소에 영구 보관 중입니다. 언제든 원본 사진을 다운로드할 수 있습니다.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg font-semibold transition-colors"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
