import React, { useRef, useState, useMemo } from 'react';
import {
  X,
  Upload,
  Trash2,
  Receipt,
  FileImage,
} from 'lucide-react';
import { StoredReceiptSlip, compressReceiptImage, saveSlipToDB, isImageFile } from '../utils/slipStorage';
import { MaterialItem } from '../App';

interface AttachSlipModalProps {
  isOpen: boolean;
  onClose: () => void;
  item: MaterialItem | null;
  sheetId: string | null;
  sheetName: string;
  slips: StoredReceiptSlip[];
  onAttachSlip: (sheetId: string, itemId: string, slipId: string) => void;
  onRemoveSlip: (sheetId: string, itemId: string, targetSlipId?: string) => void;
  onOpenViewer: (slipId: string) => void;
  onAddNewSlipToArchive: (slip: StoredReceiptSlip) => void;
  onOpenAiScan?: (initialFile?: File) => void;
}

export default function AttachSlipModal({
  isOpen,
  onClose,
  item,
  sheetId,
  sheetName,
  slips = [],
  onAttachSlip,
  onRemoveSlip,
  onOpenViewer,
  onAddNewSlipToArchive,
}: AttachSlipModalProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Extract all slip IDs connected to this item
  const itemSlipIds = useMemo(() => {
    if (!item) return [];
    const ids: string[] = [];
    if (Array.isArray(item.slipIds)) {
      for (const id of item.slipIds) {
        if (id && !ids.includes(id)) ids.push(id);
      }
    }
    if (item.slipId && !ids.includes(item.slipId)) {
      ids.push(item.slipId);
    }
    return ids;
  }, [item]);

  const attachedSlips = useMemo(() => {
    return slips.filter((s) => itemSlipIds.includes(s.id));
  }, [slips, itemSlipIds]);

  if (!isOpen || !item || !sheetId) return null;

  const handleDirectImageUpload = async (file: File) => {
    if (!file) return;
    if (!isImageFile(file)) {
      setErrorMessage('전표 사진(JPG, PNG 등 이미지 파일)만 등록할 수 있습니다.');
      return;
    }
    try {
      setIsProcessing(true);
      setErrorMessage(null);
      const compressedDataUrl = await compressReceiptImage(file, 1920, 0.85);
      if (!compressedDataUrl) {
        setErrorMessage('이미지 파일을 읽을 수 없습니다. 다른 사진을 시도해주세요.');
        return;
      }
      const now = Date.now();
      const newSlipId = `slip-manual-${now}-${Math.random().toString(36).slice(2, 6)}`;
      const orderNumber = attachedSlips.length + 1;
      const cleanFileName = file.name || `전표_${item.name}_${orderNumber}.jpg`;

      const newSlip: StoredReceiptSlip = {
        id: newSlipId,
        title: `${item.name} 전표 (${orderNumber}차)`,
        documentType: '납품/반입 전표',
        supplierName: item.supplier && item.supplier !== '-' ? item.supplier : '',
        documentDate: item.date || new Date().toISOString().split('T')[0],
        sheetId: sheetId,
        sheetName: sheetName,
        itemIds: [item.id],
        itemNames: [item.name],
        imageUrl: compressedDataUrl,
        fileName: cleanFileName,
        fileSize: Math.round(compressedDataUrl.length * 0.75),
        createdAt: now,
      };

      await saveSlipToDB(newSlip);
      onAddNewSlipToArchive(newSlip);
      onAttachSlip(sheetId, item.id, newSlipId);
    } catch (err) {
      console.error('Failed to attach direct slip photo:', err);
      setErrorMessage('전표 사진 저장 중 오류가 발생했습니다.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 no-print animate-in fade-in duration-150">
      <input
        type="file"
        ref={fileInputRef}
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleDirectImageUpload(file);
          if (e.target) e.target.value = '';
        }}
      />

      <div className="bg-white rounded-2xl border border-slate-300 shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-base text-slate-900">
                전표 사진 등록
              </h3>
              {attachedSlips.length > 0 && (
                <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800">
                  {attachedSlips.length}장 등록됨
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              품목: <strong className="text-blue-700 font-semibold">{item.name}</strong>
              {item.supplier && (
                <span className="text-slate-600"> · 구매처: {item.supplier}</span>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1">
          {/* Simple Upload & Drag Drop Box */}
          <div
            onClick={() => !isProcessing && fileInputRef.current?.click()}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes('Files')) {
                e.preventDefault();
                e.stopPropagation();
                setIsDraggingOver(true);
              }
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                setIsDraggingOver(false);
              }
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDraggingOver(false);
              const droppedFile = e.dataTransfer.files?.[0];
              if (droppedFile) {
                if (isImageFile(droppedFile)) {
                  handleDirectImageUpload(droppedFile);
                } else {
                  setErrorMessage('전표 사진(JPG, PNG 등 이미지 파일)만 등록할 수 있습니다.');
                }
              }
            }}
            className={`cursor-pointer border-2 border-dashed rounded-xl p-6 text-center transition-all ${
              isDraggingOver
                ? 'border-blue-500 bg-blue-50/80 scale-[1.01]'
                : 'border-blue-300 hover:border-blue-500 bg-blue-50/40 hover:bg-blue-50/70'
            }`}
          >
            <div className="w-12 h-12 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center mx-auto mb-2.5 shadow-2xs">
              <Upload className="w-6 h-6" />
            </div>
            <p className="text-sm font-bold text-slate-800">
              {isProcessing ? '전표 사진 처리 중...' : '클릭하여 사진 선택 (또는 사진 끌어다 놓기)'}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              컴퓨터의 사진 파일(JPG, PNG)을 선택하거나 여기에 놓으면 즉시 등록됩니다.
            </p>
          </div>

          {errorMessage && (
            <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl">
              {errorMessage}
            </div>
          )}

          {/* Currently Registered Slips */}
          {attachedSlips.length > 0 && (
            <div className="pt-2 border-t border-slate-100">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <Receipt className="w-3.5 h-3.5 text-amber-600" />
                  <span>등록된 전표 목록 ({attachedSlips.length}장)</span>
                </span>
                <span className="text-[11px] text-slate-400">
                  사진 클릭 시 크게 보기
                </span>
              </div>

              <div className="space-y-2">
                {attachedSlips.map((slip, idx) => (
                  <div
                    key={slip.id}
                    className="p-2.5 bg-slate-50 hover:bg-slate-100/80 border border-slate-200 rounded-xl flex items-center justify-between gap-3 transition-colors"
                  >
                    <div
                      className="flex items-center gap-2.5 min-w-0 cursor-pointer flex-1"
                      onClick={() => {
                        onClose();
                        onOpenViewer(slip.id);
                      }}
                      title="클릭하여 원본 사진 크게 보기"
                    >
                      {slip.imageUrl ? (
                        <img
                          src={slip.imageUrl}
                          alt={slip.title}
                          className="w-11 h-11 object-cover rounded-lg border border-slate-300 shrink-0 shadow-2xs"
                        />
                      ) : (
                        <div className="w-11 h-11 bg-amber-100 text-amber-800 rounded-lg flex items-center justify-center font-bold text-xs shrink-0">
                          <FileImage className="w-5 h-5 text-amber-600" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-900 shrink-0">
                            전표 {idx + 1}
                          </span>
                          <p className="text-xs font-bold text-slate-800 truncate">
                            {slip.title || slip.fileName || '전표 원본'}
                          </p>
                        </div>
                        <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                          {slip.documentDate || '날짜 미지정'}
                          {slip.supplierName && ` · ${slip.supplierName}`}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onOpenViewer(slip.id);
                        }}
                        className="px-2 py-1 bg-white hover:bg-blue-50 text-blue-700 border border-slate-200 hover:border-blue-300 rounded-lg text-xs font-semibold transition-colors"
                      >
                        보기
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemoveSlip(sheetId, item.id, slip.id)}
                        className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                        title="이 전표 삭제"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-bold transition-colors"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
