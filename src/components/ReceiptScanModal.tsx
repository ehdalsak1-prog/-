import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Camera,
  Upload,
  FileText,
  FileSpreadsheet,
  Check,
  CheckSquare,
  Square,
  AlertCircle,
  Loader2,
  Sparkles,
  ArrowRight,
  Eye,
  EyeOff,
  RotateCcw,
  Calendar,
  Building2,
  Trash2,
  Copy,
  Receipt,
  Plus,
} from 'lucide-react';
import { MaterialItem, MaterialSheet, getTotalConvertedQty } from '../App';
import {
  StoredReceiptSlip,
  saveSlipToDB,
  compressReceiptImage,
} from '../utils/slipStorage';

export interface ParsedSlipItem {
  id: string;
  name: string;
  spec: string;
  quantity: number;
  unit: string;
  packQty?: number;
  subUnit?: string;
  unitPrice?: number;
  amount?: number;
  remarks: string;
  supplier: string;
  date: string;
  selected: boolean;
}

export interface ParsedSlipResult {
  documentType: string;
  supplierName: string;
  documentDate: string;
  receiverName: string;
  totalAmount?: number;
  notes: string;
  items: ParsedSlipItem[];
}

interface ReceiptScanModalProps {
  isOpen: boolean;
  onClose: () => void;
  sheets: MaterialSheet[];
  activeTabId: string;
  initialFile?: File | null;
  onImportItems: (payload: {
    targetSheetId: string;
    items: Omit<MaterialItem, 'id' | 'createdAt'>[];
    sourceLabel: string;
    slipRecord?: StoredReceiptSlip;
  }) => void;
}

const COMMON_UNITS = [
  '파레트',
  'EA',
  'BOX',
  '개',
  '대',
  'set',
  '본',
  'kg',
  'm',
  '롤',
  '마대',
  '톤백',
];

export default function ReceiptScanModal({
  isOpen,
  onClose,
  sheets,
  activeTabId,
  initialFile,
  onImportItems,
}: ReceiptScanModalProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);

  const [inputMode, setInputMode] = useState<'image' | 'text'>('image');
  const [selectedImageFile, setSelectedImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [rawText, setRawText] = useState<string>('');
  const [isDragging, setIsDragging] = useState(false);

  // Target sheet
  const defaultSheetId =
    activeTabId !== 'ALL' && sheets.some((s) => s.id === activeTabId)
      ? activeTabId
      : sheets[0]?.id || '';
  const [targetSheetId, setTargetSheetId] = useState<string>(defaultSheetId);

  // Analysis status
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisStep, setAnalysisStep] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Extracted results
  const [parsedResult, setParsedResult] = useState<ParsedSlipResult | null>(null);
  const [editableItems, setEditableItems] = useState<ParsedSlipItem[]>([]);
  const [showSlipImageThumb, setShowSlipImageThumb] = useState<boolean>(true);

  // Sync default sheet when modal opens
  useEffect(() => {
    if (isOpen) {
      const nextDefault =
        activeTabId !== 'ALL' && sheets.some((s) => s.id === activeTabId)
          ? activeTabId
          : sheets[0]?.id || '';
      setTargetSheetId(nextDefault);
      setErrorMessage(null);
    }
  }, [isOpen, activeTabId, sheets]);

  // Handle initialFile passed from global window drop
  useEffect(() => {
    if (isOpen && initialFile && initialFile.type.startsWith('image/')) {
      handleFileSelected(initialFile);
    }
  }, [isOpen, initialFile]);

  // Handle global paste (Ctrl + V) when modal is open
  useEffect(() => {
    if (!isOpen) return;

    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.indexOf('image') !== -1) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            handleFileSelected(file);
            return;
          }
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [isOpen]);

  const handleFileSelected = (file: File) => {
    if (!file.type.startsWith('image/')) {
      setErrorMessage('이미지 파일(JPG, PNG, WEBP 등)을 선택해주세요.');
      return;
    }
    setErrorMessage(null);
    setSelectedImageFile(file);
    const url = URL.createObjectURL(file);
    setImagePreviewUrl(url);
    setParsedResult(null);
    setEditableItems([]);
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = (error) => reject(error);
      reader.readAsDataURL(file);
    });
  };

  const handleStartAnalysis = async () => {
    if (inputMode === 'image' && !selectedImageFile) {
      setErrorMessage('전표 사진 또는 이미지 파일을 먼저 올려주세요.');
      return;
    }
    if (inputMode === 'text' && !rawText.trim()) {
      setErrorMessage('분석할 전표 텍스트 또는 거래명세서 내용을 입력해주세요.');
      return;
    }

    try {
      setIsAnalyzing(true);
      setErrorMessage(null);
      setAnalysisStep('전표 데이터를 전송하고 있습니다...');

      let payload: { imageBase64?: string; mimeType?: string; rawText?: string } = {};

      if (inputMode === 'image' && selectedImageFile) {
        setAnalysisStep('전표 이미지 인코딩 및 전송 중...');
        const base64 = await fileToBase64(selectedImageFile);
        payload = {
          imageBase64: base64,
          mimeType: selectedImageFile.type || 'image/jpeg',
          rawText: rawText.trim() || undefined,
        };
      } else {
        payload = {
          rawText: rawText.trim(),
        };
      }

      setAnalysisStep('AI가 전표의 공급자, 일자, 자재 품목 테이블을 정밀 분석 중...');

      const response = await fetch('/api/parse-slip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const resData = await response.json();

      if (!response.ok || !resData.success) {
        throw new Error(
          resData.error || '전표 분석 요청에 실패했습니다. 다시 시도해주세요.'
        );
      }

      const raw = resData.data;
      const today = new Date().toISOString().split('T')[0];
      const normalizedDate = raw.documentDate && /^\d{4}-\d{2}-\d{2}$/.test(raw.documentDate)
        ? raw.documentDate
        : today;
      const supplier = (raw.supplierName || '').trim();

      const items: ParsedSlipItem[] = Array.isArray(raw.items)
        ? raw.items
            .filter((it: any) => it && it.name && String(it.name).trim())
            .map((it: any, idx: number) => ({
              id: `slip-item-${Date.now()}-${idx}`,
              name: String(it.name).trim(),
              spec: it.spec && String(it.spec).trim() ? String(it.spec).trim() : '-',
              quantity: typeof it.quantity === 'number' && !isNaN(it.quantity) && it.quantity > 0
                ? it.quantity
                : parseFloat(String(it.quantity).replace(/,/g, '')) || 1,
              unit: it.unit && String(it.unit).trim() ? String(it.unit).trim() : 'EA',
              packQty: it.packQty && typeof it.packQty === 'number' && it.packQty > 0
                ? it.packQty
                : undefined,
              subUnit: it.subUnit && String(it.subUnit).trim() ? String(it.subUnit).trim() : 'EA',
              unitPrice: typeof it.unitPrice === 'number' ? it.unitPrice : undefined,
              amount: typeof it.amount === 'number' ? it.amount : undefined,
              remarks: it.remarks && String(it.remarks).trim() ? String(it.remarks).trim() : '',
              supplier: supplier,
              date: normalizedDate,
              selected: true,
            }))
        : [];

      if (items.length === 0) {
        throw new Error('전표에서 자재 품목을 찾지 못했습니다. 사진이 선명한지 확인해주세요.');
      }

      const result: ParsedSlipResult = {
        documentType: raw.documentType || '전표(납품증/거래명세서)',
        supplierName: supplier,
        documentDate: normalizedDate,
        receiverName: raw.receiverName || '',
        totalAmount: raw.totalAmount,
        notes: raw.notes || '',
        items,
      };

      setParsedResult(result);
      setEditableItems(items);
    } catch (err: any) {
      console.error('Failed to parse slip:', err);
      setErrorMessage(err.message || '전표를 분석하는 중 오류가 발생했습니다.');
    } finally {
      setIsAnalyzing(false);
      setAnalysisStep('');
    }
  };

  const handleToggleSelectAll = () => {
    const allSelected = editableItems.every((it) => it.selected);
    setEditableItems((prev) => prev.map((it) => ({ ...it, selected: !allSelected })));
  };

  const handleToggleItemSelect = (id: string) => {
    setEditableItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, selected: !it.selected } : it))
    );
  };

  const handleUpdateItemField = (
    id: string,
    field: keyof ParsedSlipItem,
    value: any
  ) => {
    setEditableItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, [field]: value } : it))
    );
  };

  const handleDeleteItem = (id: string) => {
    setEditableItems((prev) => prev.filter((it) => it.id !== id));
  };

  const handleCommitToLedger = async () => {
    const selected = editableItems.filter((it) => it.selected && it.name.trim());
    if (selected.length === 0) {
      setErrorMessage('대장에 등록할 자재를 최소 1개 이상 선택해주세요.');
      return;
    }

    const targetSheet = sheets.find((s) => s.id === targetSheetId) || sheets[0];
    if (!targetSheet) return;

    const slipId = `slip-${Date.now()}`;
    let storedSlip: StoredReceiptSlip | undefined;

    // Compress & preserve original slip image for archival
    if (selectedImageFile || imagePreviewUrl) {
      try {
        const compressed = await compressReceiptImage(
          selectedImageFile || imagePreviewUrl!
        );
        const today = new Date().toISOString().split('T')[0];
        storedSlip = {
          id: slipId,
          title: `${parsedResult?.supplierName || '구매처'} ${
            parsedResult?.documentType || '전표'
          } (${parsedResult?.documentDate || today})`,
          documentType: parsedResult?.documentType || '전표',
          supplierName: parsedResult?.supplierName || '',
          documentDate: parsedResult?.documentDate || today,
          receiverName: parsedResult?.receiverName,
          totalAmount: parsedResult?.totalAmount,
          notes: parsedResult?.notes,
          sheetId: targetSheet.id,
          sheetName: targetSheet.name,
          itemIds: [],
          itemNames: selected.map((i) => i.name.trim()),
          imageUrl: compressed,
          fileName: selectedImageFile?.name,
          fileSize: selectedImageFile?.size,
          createdAt: Date.now(),
        };
        await saveSlipToDB(storedSlip);
      } catch (err) {
        console.error('Failed to store receipt slip image:', err);
      }
    }

    const itemsToImport: Omit<MaterialItem, 'id' | 'createdAt'>[] = selected.map((it) => ({
      name: it.name.trim(),
      supplier: it.supplier.trim() === '-' ? '' : it.supplier.trim(),
      spec: it.spec.trim() || '-',
      quantity: it.quantity > 0 ? it.quantity : 1,
      unit: it.unit.trim() || 'EA',
      packQty: it.packQty && it.packQty > 0 ? it.packQty : undefined,
      subUnit: it.packQty && it.packQty > 0 ? it.subUnit || 'EA' : undefined,
      isCompleted: false,
      location: '',
      remarks: it.remarks.trim(),
      date: it.date || new Date().toISOString().split('T')[0],
      slipId: storedSlip ? slipId : undefined,
    }));

    const docLabel = parsedResult?.documentType || '전표';
    const supLabel = parsedResult?.supplierName ? `(${parsedResult.supplierName})` : '';

    onImportItems({
      targetSheetId: targetSheet.id,
      items: itemsToImport,
      sourceLabel: `${docLabel} ${supLabel}`.trim(),
      slipRecord: storedSlip,
    });

    handleClose();
  };

  const handleClose = () => {
    if (imagePreviewUrl) {
      URL.revokeObjectURL(imagePreviewUrl);
    }
    setSelectedImageFile(null);
    setImagePreviewUrl(null);
    setRawText('');
    setParsedResult(null);
    setEditableItems([]);
    setErrorMessage(null);
    setIsAnalyzing(false);
    onClose();
  };

  if (!isOpen) return null;

  const selectedCount = editableItems.filter((it) => it.selected).length;
  const targetSheet = sheets.find((s) => s.id === targetSheetId) || sheets[0];

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 md:p-6 no-print">
      <div className="bg-white rounded-2xl border border-slate-300 shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in duration-200">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0 shadow-xs">
              <Receipt className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight">
                  전표 자동 분석 및 대장 등록
                </h2>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-blue-100 text-blue-700">
                  <Sparkles className="w-3 h-3 text-blue-600" />
                  <span>AI 스마트 스캔</span>
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                납품증·거래명세서·세금계산서 사진을 올리면 구매처, 반입일자, 품목명, 규격, 수량을 자동 추출합니다.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 p-2 rounded-lg transition-colors shrink-0"
            title="닫기"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body Content */}
        <div className="p-5 overflow-y-auto flex-1 min-h-0 space-y-5">
          {/* Top Target Sheet & Settings Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-100/70 border border-slate-200 rounded-xl p-3 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-700 whitespace-nowrap">
                등록할 시트:
              </span>
              <select
                value={targetSheetId}
                onChange={(e) => setTargetSheetId(e.target.value)}
                className="bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 font-bold text-slate-800 text-xs focus:border-blue-500 focus:outline-none"
              >
                {sheets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.items.length}건)
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-3 text-slate-600">
              <span className="text-[11px] text-slate-500">
                💡 PC는 파일/붙여넣기, 모바일은 카메라 촬영 지원
              </span>
            </div>
          </div>

          {/* If No Parsed Result Yet: Show Upload & Input Form */}
          {!parsedResult && (
            <div className="space-y-4">
              {/* Input Mode Tabs */}
              <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
                <button
                  type="button"
                  onClick={() => setInputMode('image')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 ${
                    inputMode === 'image'
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>전표 사진 / 이미지 업로드</span>
                </button>
                <button
                  type="button"
                  onClick={() => setInputMode('text')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 ${
                    inputMode === 'text'
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>전표 텍스트 직접 입력</span>
                </button>
              </div>

              {inputMode === 'image' ? (
                <div>
                  <input
                    type="file"
                    ref={fileInputRef}
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleFileSelected(file);
                    }}
                  />
                  <input
                    type="file"
                    ref={cameraInputRef}
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleFileSelected(file);
                    }}
                  />

                  {!imagePreviewUrl ? (
                    <div
                      onDragOver={(e) => {
                        e.preventDefault();
                        setIsDragging(true);
                      }}
                      onDragLeave={() => setIsDragging(false)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setIsDragging(false);
                        const file = e.dataTransfer.files?.[0];
                        if (file) handleFileSelected(file);
                      }}
                      className={`border-2 border-dashed rounded-2xl p-8 sm:p-10 text-center transition-colors ${
                        isDragging
                          ? 'border-blue-500 bg-blue-50/70'
                          : 'border-slate-300 bg-slate-50 hover:bg-slate-100/60'
                      }`}
                    >
                      <Receipt className="w-12 h-12 text-blue-500 mx-auto mb-3" />
                      <h3 className="text-base font-bold text-slate-800">
                        여기에 전표(납품증, 거래명세서 등) 사진을 놓아주세요
                      </h3>
                      <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                        종이 전표 사진, 스캔본, 전자 거래명세서 캡처 이미지를 올려주시면 AI가 표 내용을 자동으로 분석합니다.
                      </p>

                      <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-colors inline-flex items-center gap-1.5 shadow-xs"
                        >
                          <Upload className="w-4 h-4" />
                          <span>사진 파일 선택</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => cameraInputRef.current?.click()}
                          className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-bold transition-colors inline-flex items-center gap-1.5 shadow-xs"
                        >
                          <Camera className="w-4 h-4 text-emerald-400" />
                          <span>스마트폰 카메라로 촬영</span>
                        </button>
                      </div>

                      <div className="mt-4 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-200/80 text-[11px] font-medium text-slate-600">
                        <span>클립보드 단축키 지원:</span>
                        <kbd className="px-1.5 py-0.5 bg-white border border-slate-300 rounded font-mono font-bold text-slate-800 text-[10px]">
                          Ctrl + V
                        </kbd>
                        <span>로 바로 붙여넣을 수도 있습니다</span>
                      </div>
                    </div>
                  ) : (
                    <div className="border border-slate-200 rounded-xl p-4 bg-slate-50">
                      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 mb-3 border-b border-slate-200">
                        <div className="flex items-center gap-2 min-w-0">
                          <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                          <span className="font-bold text-xs text-slate-800 truncate">
                            {selectedImageFile?.name || '업로드된 전표 이미지'}
                          </span>
                          <span className="text-[11px] text-slate-400">
                            ({selectedImageFile ? (selectedImageFile.size / 1024).toFixed(1) : 0} KB)
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className="px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-200 rounded-md transition-colors"
                          >
                            다른 사진으로 변경
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedImageFile(null);
                              setImagePreviewUrl(null);
                            }}
                            className="px-2.5 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50 rounded-md transition-colors"
                          >
                            삭제
                          </button>
                        </div>
                      </div>

                      <div className="flex flex-col md:flex-row gap-4 items-center">
                        <div className="w-full md:w-60 h-44 bg-slate-200 rounded-lg overflow-hidden flex items-center justify-center border border-slate-300 relative group shrink-0">
                          <img
                            src={imagePreviewUrl}
                            alt="선택된 전표 사진"
                            className="w-full h-full object-contain"
                          />
                        </div>

                        <div className="flex-1 text-xs text-slate-600 space-y-2">
                          <div className="p-3 bg-white rounded-lg border border-slate-200">
                            <span className="font-bold text-slate-800 block mb-1">
                              🔍 분석 준비 완료
                            </span>
                            전표에 적힌 <strong>공급자(구매처)</strong>, <strong>반입일자</strong>, 그리고 <strong>품목명·규격·수량</strong>을 AI가 읽어내어 대장 형식으로 변환합니다.
                          </div>

                          <button
                            type="button"
                            disabled={isAnalyzing}
                            onClick={handleStartAnalysis}
                            className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 shadow-md hover:shadow-lg"
                          >
                            {isAnalyzing ? (
                              <>
                                <Loader2 className="w-4 h-4 animate-spin text-white" />
                                <span>{analysisStep || '전표 분석 중...'}</span>
                              </>
                            ) : (
                              <>
                                <Sparkles className="w-4 h-4 text-amber-300" />
                                <span>전표 AI 분석 시작하기</span>
                                <ArrowRight className="w-4 h-4" />
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="text-xs text-slate-500">
                    메신저(카카오톡), 이메일, ERP에서 복사한 전표 텍스트나 거래명세서 내용을 붙여넣어주세요.
                  </div>
                  <textarea
                    rows={6}
                    value={rawText}
                    onChange={(e) => setRawText(e.target.value)}
                    placeholder={`예시:\n[거래명세서] 공급자: 대원스틸\n일자: 2026-11-04\n1. 40A BASE / 규격: - / 수량: 9 / 단위: 파레트 (1파레트 = 630 EA)\n2. STEEL PIPE 40A / 규격: 40A*3.2T*520L / 수량: 4,000 / 단위: EA`}
                    className="w-full p-3 text-xs font-mono border border-slate-300 rounded-xl focus:border-blue-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    disabled={isAnalyzing || !rawText.trim()}
                    onClick={handleStartAnalysis}
                    className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-xl font-bold text-sm transition-colors flex items-center justify-center gap-2"
                  >
                    {isAnalyzing ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>분석 중...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4 text-amber-300" />
                        <span>텍스트 전표 AI 분석 시작</span>
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Loading Overlay / Progress Indicator */}
          {isAnalyzing && (
            <div className="p-8 text-center bg-blue-50/60 rounded-2xl border border-blue-200 animate-pulse">
              <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto mb-2" />
              <h4 className="text-sm font-bold text-slate-900">
                전표를 분석하고 있습니다
              </h4>
              <p className="text-xs text-blue-700 mt-1 font-medium">
                {analysisStep || '잠시만 기다려주세요...'}
              </p>
            </div>
          )}

          {/* Error Notice */}
          {errorMessage && (
            <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-2.5 text-xs text-rose-800">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div className="flex-1 leading-relaxed">
                <span className="font-bold">안내: </span>
                {errorMessage}
              </div>
            </div>
          )}

          {/* Parsed Results Review Grid */}
          {parsedResult && !isAnalyzing && (
            <div className="space-y-4">
              {/* Slip Metadata Banner */}
              <div className="bg-slate-900 text-white rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-md">
                <div className="flex flex-wrap items-center gap-2.5 text-xs">
                  <span className="px-2.5 py-1 rounded-md bg-blue-500 font-bold text-white uppercase text-[11px]">
                    {parsedResult.documentType}
                  </span>
                  {parsedResult.supplierName && (
                    <span className="inline-flex items-center gap-1 bg-slate-800 px-2.5 py-1 rounded-md border border-slate-700">
                      <Building2 className="w-3.5 h-3.5 text-blue-400" />
                      <strong className="text-blue-200 font-semibold">구매처:</strong>
                      <span className="text-white font-bold">{parsedResult.supplierName}</span>
                    </span>
                  )}
                  {parsedResult.documentDate && (
                    <span className="inline-flex items-center gap-1 bg-slate-800 px-2.5 py-1 rounded-md border border-slate-700 font-mono">
                      <Calendar className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-200 font-semibold">일자:</span>
                      <span className="text-white font-bold">{parsedResult.documentDate}</span>
                    </span>
                  )}
                  <span className="text-slate-300">
                    총 <strong className="text-white font-extrabold">{editableItems.length}</strong>개 품목 인식됨
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {imagePreviewUrl && (
                    <button
                      type="button"
                      onClick={() => setShowSlipImageThumb((prev) => !prev)}
                      className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 transition-colors inline-flex items-center gap-1"
                    >
                      {showSlipImageThumb ? (
                        <>
                          <EyeOff className="w-3.5 h-3.5" />
                          <span>전표 사진 접기</span>
                        </>
                      ) : (
                        <>
                          <Eye className="w-3.5 h-3.5" />
                          <span>전표 원본 보기</span>
                        </>
                      )}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setParsedResult(null);
                      setEditableItems([]);
                    }}
                    className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 hover:text-white transition-colors inline-flex items-center gap-1"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>다시 분석</span>
                  </button>
                </div>
              </div>

              {/* Collapsible Original Slip Image Cross-Check Panel */}
              {imagePreviewUrl && showSlipImageThumb && (
                <div className="border border-slate-300 rounded-xl p-3 bg-slate-100/70">
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-700 mb-2">
                    <span>전표 원본 이미지 (내용 대조용)</span>
                    <span className="text-[11px] text-slate-500">
                      수치가 모호할 땐 아래 표에서 직접 수정할 수 있습니다.
                    </span>
                  </div>
                  <div className="max-h-56 overflow-auto rounded-lg border border-slate-200 bg-white p-2 flex justify-center">
                    <img
                      src={imagePreviewUrl}
                      alt="전표 원본"
                      className="max-h-52 object-contain"
                    />
                  </div>
                </div>
              )}

              {/* Items Table with Direct Inline Edits */}
              <div className="border border-slate-300 rounded-xl overflow-hidden bg-white shadow-xs">
                <div className="p-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleToggleSelectAll}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-slate-300 bg-white hover:bg-slate-100 font-semibold text-slate-700 transition-colors"
                    >
                      {editableItems.every((it) => it.selected) ? (
                        <>
                          <CheckSquare className="w-3.5 h-3.5 text-blue-600" />
                          <span>전체 해제</span>
                        </>
                      ) : (
                        <>
                          <Square className="w-3.5 h-3.5 text-slate-400" />
                          <span>전체 선택</span>
                        </>
                      )}
                    </button>
                    <span className="text-slate-500">
                      선택: <strong className="text-blue-700 font-bold">{selectedCount}</strong> / {editableItems.length}건
                    </span>
                  </div>

                  <span className="text-[11px] text-slate-500 hidden sm:inline">
                    ※ 표 안의 품목명, 규격, 수량, 구매처, 일자를 직접 수정할 수 있습니다.
                  </span>
                </div>

                <div className="overflow-x-auto max-h-[380px]">
                  <table className="w-full text-center border-collapse text-xs">
                    <thead className="sticky top-0 z-10 bg-slate-800 text-white font-bold">
                      <tr className="divide-x divide-slate-600">
                        <th className="py-2.5 px-2 w-10 text-center">선택</th>
                        <th className="py-2.5 px-2 w-12 text-center font-mono">No.</th>
                        <th className="py-2.5 px-3 min-w-[110px] text-center">구매처</th>
                        <th className="py-2.5 px-3 min-w-[110px] text-center">반입일자</th>
                        <th className="py-2.5 px-3.5 min-w-[180px] text-left">자재 품목명 *</th>
                        <th className="py-2.5 px-3 min-w-[120px] text-center">규격 / 사양</th>
                        <th className="py-2.5 px-3 w-28 text-center">반입 수량 *</th>
                        <th className="py-2.5 px-2 w-20 text-center">단위</th>
                        <th className="py-2.5 px-3 min-w-[130px] text-center">단위당 입수량</th>
                        <th className="py-2.5 px-3 min-w-[140px] text-right bg-blue-700 text-white">
                          총 수량
                        </th>
                        <th className="py-2.5 px-3 min-w-[130px] text-left">비고</th>
                        <th className="py-2.5 px-2 w-10 text-center">삭제</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {editableItems.map((item, idx) => {
                        const totalConv = item.packQty && item.packQty > 0
                          ? item.quantity * item.packQty
                          : null;

                        return (
                          <tr
                            key={item.id}
                            className={`divide-x divide-slate-200 transition-colors ${
                              item.selected ? 'bg-white hover:bg-slate-50' : 'bg-slate-100/60 opacity-60'
                            }`}
                          >
                            <td className="py-2 px-2 text-center">
                              <input
                                type="checkbox"
                                checked={item.selected}
                                onChange={() => handleToggleItemSelect(item.id)}
                                className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
                              />
                            </td>

                            <td className="py-2 px-2 text-center font-mono text-slate-500">
                              {idx + 1}
                            </td>

                            <td className="py-1 px-1">
                              <input
                                type="text"
                                value={item.supplier}
                                onChange={(e) =>
                                  handleUpdateItemField(item.id, 'supplier', e.target.value)
                                }
                                placeholder="구매처"
                                className="w-full px-2 py-1 text-xs border border-transparent hover:border-slate-300 focus:border-blue-500 rounded bg-transparent focus:bg-white outline-none"
                              />
                            </td>

                            <td className="py-1 px-1">
                              <input
                                type="date"
                                value={item.date}
                                onChange={(e) =>
                                  handleUpdateItemField(item.id, 'date', e.target.value)
                                }
                                className="w-full px-1.5 py-1 text-xs font-mono border border-transparent hover:border-slate-300 focus:border-blue-500 rounded bg-transparent focus:bg-white outline-none"
                              />
                            </td>

                            <td className="py-1 px-1 text-left">
                              <input
                                type="text"
                                value={item.name}
                                onChange={(e) =>
                                  handleUpdateItemField(item.id, 'name', e.target.value)
                                }
                                placeholder="품목명"
                                className="w-full px-2 py-1 text-xs font-bold text-slate-900 border border-transparent hover:border-slate-300 focus:border-blue-500 rounded bg-transparent focus:bg-white outline-none"
                              />
                            </td>

                            <td className="py-1 px-1">
                              <input
                                type="text"
                                value={item.spec}
                                onChange={(e) =>
                                  handleUpdateItemField(item.id, 'spec', e.target.value)
                                }
                                placeholder="-"
                                className="w-full px-2 py-1 text-xs text-center border border-transparent hover:border-slate-300 focus:border-blue-500 rounded bg-transparent focus:bg-white outline-none"
                              />
                            </td>

                            <td className="py-1 px-1">
                              <input
                                type="number"
                                step="any"
                                min="0.001"
                                value={item.quantity}
                                onChange={(e) =>
                                  handleUpdateItemField(
                                    item.id,
                                    'quantity',
                                    parseFloat(e.target.value) || 0
                                  )
                                }
                                className="w-full px-2 py-1 text-xs text-center font-mono font-bold text-slate-900 border border-transparent hover:border-slate-300 focus:border-blue-500 rounded bg-transparent focus:bg-white outline-none"
                              />
                            </td>

                            <td className="py-1 px-1">
                              <input
                                type="text"
                                value={item.unit}
                                onChange={(e) =>
                                  handleUpdateItemField(item.id, 'unit', e.target.value)
                                }
                                className="w-full px-1.5 py-1 text-xs text-center border border-transparent hover:border-slate-300 focus:border-blue-500 rounded bg-transparent focus:bg-white outline-none"
                              />
                            </td>

                            <td className="py-1 px-1">
                              <div className="flex items-center gap-1">
                                <input
                                  type="number"
                                  step="any"
                                  min="0"
                                  value={item.packQty || ''}
                                  placeholder="입수량"
                                  onChange={(e) =>
                                    handleUpdateItemField(
                                      item.id,
                                      'packQty',
                                      e.target.value ? parseFloat(e.target.value) : undefined
                                    )
                                  }
                                  className="w-16 px-1.5 py-1 text-xs text-center font-mono border border-transparent hover:border-slate-300 focus:border-blue-500 rounded bg-transparent focus:bg-white outline-none"
                                />
                                <input
                                  type="text"
                                  value={item.subUnit || 'EA'}
                                  placeholder="EA"
                                  onChange={(e) =>
                                    handleUpdateItemField(item.id, 'subUnit', e.target.value)
                                  }
                                  className="w-10 px-1 py-1 text-xs text-center font-mono border border-transparent hover:border-slate-300 focus:border-blue-500 rounded bg-transparent focus:bg-white outline-none"
                                />
                              </div>
                            </td>

                            <td className="py-2 px-3 text-right font-mono font-bold bg-blue-50/40">
                              {totalConv !== null ? (
                                <span className="text-blue-700">
                                  {totalConv.toLocaleString()} {item.subUnit || 'EA'}
                                </span>
                              ) : (
                                <span className="text-slate-800">
                                  {item.quantity.toLocaleString()} {item.unit}
                                </span>
                              )}
                            </td>

                            <td className="py-1 px-1 text-left">
                              <input
                                type="text"
                                value={item.remarks}
                                onChange={(e) =>
                                  handleUpdateItemField(item.id, 'remarks', e.target.value)
                                }
                                placeholder="비고"
                                className="w-full px-2 py-1 text-xs border border-transparent hover:border-slate-300 focus:border-blue-500 rounded bg-transparent focus:bg-white outline-none"
                              />
                            </td>

                            <td className="py-1 px-1 text-center">
                              <button
                                type="button"
                                onClick={() => handleDeleteItem(item.id)}
                                className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                                title="목록에서 삭제"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
          <div className="text-xs text-slate-500 flex items-center gap-1.5">
            <span>대상 시트:</span>
            <strong className="text-slate-800 font-bold">[{targetSheet?.name}]</strong>
            {selectedCount > 0 && (
              <span className="text-blue-700 font-semibold">
                · {selectedCount}개 자재 등록 대기 중
              </span>
            )}
          </div>

          <div className="flex items-center gap-2.5 w-full sm:w-auto">
            <button
              type="button"
              onClick={handleClose}
              className="flex-1 sm:flex-none px-4 py-2 border border-slate-300 text-slate-700 hover:bg-slate-100 rounded-xl text-xs font-semibold transition-colors"
            >
              닫기
            </button>

            {parsedResult && (
              <button
                type="button"
                disabled={selectedCount === 0}
                onClick={handleCommitToLedger}
                className="flex-1 sm:flex-none px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-xs sm:text-sm font-bold transition-all shadow-md hover:shadow-lg flex items-center justify-center gap-2"
              >
                <Check className="w-4 h-4" />
                <span>선택한 {selectedCount}건 대장에 즉시 등록</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
