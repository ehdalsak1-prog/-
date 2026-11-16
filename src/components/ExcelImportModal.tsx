import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  X,
  Upload,
  ClipboardPaste,
  FileSpreadsheet,
  SlidersHorizontal,
  Check,
  Filter,
  FolderPlus,
  Layers,
  RotateCcw,
  Ban,
  Eye,
  EyeOff,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';
import { MaterialItem, MaterialSheet, getTotalConvertedQty } from '../App';
import {
  ParsedRawSheet,
  ColumnMapping,
  CandidateRow,
  MarkerFilterOption,
  AppliedRuleSummary,
  parseExcelFileToRawSheets,
  parseClipboardTableText,
  detectSheetStructure,
  buildCandidateRows,
  applyExclusionInstructions,
  autoConvertRawSheetItems,
} from '../utils/importExcel';

export interface SingleSheetImportPayload {
  destinationMode: 'existing' | 'new';
  targetSheetId?: string;
  newSheetName?: string;
  newSheetSubtitle?: string;
  items: Omit<MaterialItem, 'id' | 'createdAt'>[];
}

export interface MultiSheetImportPayload {
  sheetsToCreate: Array<{
    name: string;
    subtitle: string;
    items: Omit<MaterialItem, 'id' | 'createdAt'>[];
  }>;
}

interface ExcelImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  sheets: MaterialSheet[];
  activeTabId: string;
  initialFile?: File | null;
  onImportSingle: (payload: SingleSheetImportPayload) => void;
  onImportMultipleSheets: (payload: MultiSheetImportPayload) => void;
}

const SAMPLE_PASTE_TEXT = [
  'NO\t품명\t용도\t규격\t단위\t제작 및 구매수량\t비고\t대상',
  '1\t40A BASE\t라인 이전 자재\t-\t파레트\t5\t1파레트 = 630 EA\tO',
  '2\t전동 지게차[SBF-25A]\t하역 장비\t2.5 Ton\tEA\t1\t청주→용인 이설\tO',
  '3\t건전지\t공용 비치\tAA\tBOX\t20\t-\tO',
  '4\t개구부 주의 스티커\t안전 표지\t-\tEA\t100\t회의실 참고\t',
  '5\t펀칭기\t사무용\t-\t\t\t\tO',
].join('\n');

const QUICK_EXCLUSION_CHIPS = [
  { label: '+ 수량 빈칸(미정) 빼줘', phrase: '수량 빈칸 빼줘' },
  { label: '+ 동그라미(O) 표시만 넣어줘', phrase: '동그라미 표시만 넣어줘' },
  { label: '+ 규격 없는 거 빼줘', phrase: '규격 없는거 빼줘' },
  { label: '+ 비고 없는 거 빼줘', phrase: '비고 없는거 빼줘' },
];

export default function ExcelImportModal({
  isOpen,
  onClose,
  sheets,
  activeTabId,
  initialFile,
  onImportSingle,
  onImportMultipleSheets,
}: ExcelImportModalProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [inputTab, setInputTab] = useState<'file' | 'paste'>('file');
  const [isDragging, setIsDragging] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  // Source data state
  const [sourceFileName, setSourceFileName] = useState<string>('');
  const [rawSheets, setRawSheets] = useState<ParsedRawSheet[]>([]);
  const [selectedRawSheetIdx, setSelectedRawSheetIdx] = useState<number>(0);
  const [pasteText, setPasteText] = useState<string>('');

  // Special Exclusion / Inclusion Instructions State ('빼달라고 하면 빼주는 특이사항 칸')
  const [exclusionText, setExclusionText] = useState<string>('');
  const [appliedRules, setAppliedRules] = useState<AppliedRuleSummary[]>([]);
  const [hideExcludedRows, setHideExcludedRows] = useState<boolean>(false);

  // Structure & Mapping state
  const [headerRowIndex, setHeaderRowIndex] = useState<number>(-1);
  const [columnLabels, setColumnLabels] = useState<string[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({
    nameCol: 0,
    supplierCol: -1,
    specCol: -1,
    qtyCol: -1,
    unitCol: -1,
    packQtyCol: -1,
    dateCol: -1,
    usageCol: -1,
    remarksCol: -1,
  });
  const [markerOptions, setMarkerOptions] = useState<MarkerFilterOption[]>([]);
  const [activeMarkerKey, setActiveMarkerKey] = useState<string | null>(null);
  const [showMappingEditor, setShowMappingEditor] = useState<boolean>(false);

  // Candidate preview rows (editable & selectable)
  const [candidates, setCandidates] = useState<CandidateRow[]>([]);

  // Destination settings
  const defaultSheetId =
    activeTabId !== 'ALL' && sheets.some((s) => s.id === activeTabId)
      ? activeTabId
      : sheets[0]?.id || '';

  const [destinationMode, setDestinationMode] = useState<'existing' | 'new'>('existing');
  const [targetSheetId, setTargetSheetId] = useState<string>(defaultSheetId);
  const [newSheetName, setNewSheetName] = useState<string>('');
  const [newSheetSubtitle, setNewSheetSubtitle] = useState<string>('');
  const [defaultDate, setDefaultDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );

  // Sync defaultSheetId when modal opens
  useEffect(() => {
    if (isOpen) {
      const nextDefault =
        activeTabId !== 'ALL' && sheets.some((s) => s.id === activeTabId)
          ? activeTabId
          : sheets[0]?.id || '';
      setTargetSheetId(nextDefault);
    }
  }, [isOpen, activeTabId, sheets]);

  // Handle initialFile dropped onto main screen
  useEffect(() => {
    if (isOpen && initialFile) {
      setInputTab('file');
      void handleProcessFile(initialFile);
    }
  }, [isOpen, initialFile]);

  const currentRawSheet = rawSheets[selectedRawSheetIdx] || null;

  const applySheetDetection = (
    sheet: ParsedRawSheet,
    dateVal: string,
    currentExclusion: string
  ) => {
    const detected = detectSheetStructure(sheet.rows);
    setHeaderRowIndex(detected.headerRowIndex);
    setColumnLabels(detected.columnLabels);
    setMapping(detected.mapping);
    setMarkerOptions(detected.markerOptions);
    setActiveMarkerKey(null);

    const built = buildCandidateRows(
      sheet.rows,
      detected.headerRowIndex,
      detected.mapping,
      dateVal
    );
    const evaluated = applyExclusionInstructions(
      built,
      currentExclusion,
      detected.markerOptions
    );
    setCandidates(evaluated.updatedCandidates);
    setAppliedRules(evaluated.appliedRules);
  };

  const handleExclusionTextChange = (nextText: string) => {
    setExclusionText(nextText);
    setActiveMarkerKey(null);
    if (candidates.length > 0) {
      const evaluated = applyExclusionInstructions(candidates, nextText, markerOptions);
      setCandidates(evaluated.updatedCandidates);
      setAppliedRules(evaluated.appliedRules);
    } else {
      setAppliedRules([]);
    }
  };

  const handleToggleQuickChip = (phrase: string) => {
    const parts = exclusionText
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const exists = parts.some((p) => p === phrase);
    const nextText = exists
      ? parts.filter((p) => p !== phrase).join(', ')
      : [...parts, phrase].join(', ');
    handleExclusionTextChange(nextText);
  };

  const handleProcessFile = async (file: File) => {
    setParseError(null);
    setIsParsing(true);
    try {
      const parsedSheets = await parseExcelFileToRawSheets(file);
      if (parsedSheets.length === 0) {
        setParseError('엑셀 파일에서 데이터가 있는 표를 찾지 못했습니다.');
        setRawSheets([]);
        setCandidates([]);
        setAppliedRules([]);
        return;
      }

      setSourceFileName(file.name);
      setRawSheets(parsedSheets);
      setSelectedRawSheetIdx(0);

      const firstSheet = parsedSheets[0];
      const baseFileName = file.name.replace(/\.[^.]+$/, '').trim();
      const suggestedSheetName =
        firstSheet.sheetName && !/^sheet\d+$/i.test(firstSheet.sheetName.trim())
          ? firstSheet.sheetName.trim()
          : baseFileName;

      if (suggestedSheetName && !newSheetName) {
        setNewSheetName(suggestedSheetName);
      }

      applySheetDetection(firstSheet, defaultDate, exclusionText);
    } catch (err) {
      console.error('Excel parse error:', err);
      setParseError(
        '파일을 읽는 중 오류가 발생했습니다. .xlsx, .xls, .csv 형식인지 확인해 주세요.'
      );
    } finally {
      setIsParsing(false);
    }
  };

  const handleSelectRawSheetTab = (idx: number) => {
    const target = rawSheets[idx];
    if (!target) return;
    setSelectedRawSheetIdx(idx);
    if (target.sheetName && !/^sheet\d+$/i.test(target.sheetName.trim())) {
      setNewSheetName(target.sheetName.trim());
    }
    applySheetDetection(target, defaultDate, exclusionText);
  };

  const handleParsePasteText = (raw: string) => {
    setPasteText(raw);
    setParseError(null);
    if (!raw.trim()) {
      setRawSheets([]);
      setCandidates([]);
      setAppliedRules([]);
      return;
    }

    const rows = parseClipboardTableText(raw);
    if (rows.length === 0) {
      setParseError('붙여넣은 텍스트에서 표 데이터를 찾지 못했습니다.');
      setRawSheets([]);
      setCandidates([]);
      setAppliedRules([]);
      return;
    }

    const virtualSheet: ParsedRawSheet = {
      sheetName: '붙여넣은 표',
      rows,
    };
    setSourceFileName('클립보드 붙여넣기');
    setRawSheets([virtualSheet]);
    setSelectedRawSheetIdx(0);
    applySheetDetection(virtualSheet, defaultDate, exclusionText);
  };

  // Rebuild candidates whenever user manually adjusts column mapping, header row, or default date
  const rebuildWithMapping = (
    nextHeaderIdx: number,
    nextMapping: ColumnMapping,
    nextDate: string
  ) => {
    if (!currentRawSheet) return;
    const nextLabels =
      nextHeaderIdx >= 0 && currentRawSheet.rows[nextHeaderIdx]
        ? currentRawSheet.rows[nextHeaderIdx].map((cell, idx) =>
            cell ? `${cell} (${idx + 1}열)` : `빈 머리글 (${idx + 1}열)`
          )
        : Array.from(
            { length: currentRawSheet.rows[0]?.length || 0 },
            (_, idx) => `${idx + 1}열`
          );

    setHeaderRowIndex(nextHeaderIdx);
    setColumnLabels(nextLabels);
    setMapping(nextMapping);
    setActiveMarkerKey(null);

    const built = buildCandidateRows(
      currentRawSheet.rows,
      nextHeaderIdx,
      nextMapping,
      nextDate
    );
    const evaluated = applyExclusionInstructions(built, exclusionText, markerOptions);
    setCandidates(evaluated.updatedCandidates);
    setAppliedRules(evaluated.appliedRules);
  };

  const handleMarkerFilter = (opt: MarkerFilterOption) => {
    const key = `${opt.colIndex}:${opt.markerValue}`;
    if (activeMarkerKey === key) {
      setActiveMarkerKey(null);
      const evaluated = applyExclusionInstructions(candidates, exclusionText, markerOptions);
      setCandidates(evaluated.updatedCandidates);
      setAppliedRules(evaluated.appliedRules);
      return;
    }

    setActiveMarkerKey(key);
    setCandidates((prev) =>
      prev.map((c) => {
        const rawCell = (c.rawCells[opt.colIndex] || '').trim();
        const normalized =
          rawCell.toUpperCase() === 'O' || rawCell === '○' || rawCell === 'ㅇ'
            ? 'O'
            : rawCell;
        const matched = normalized === opt.markerValue;
        return {
          ...c,
          selected: matched && !c.excludeReason,
        };
      })
    );
  };

  const handleToggleAllRows = (checked: boolean) => {
    setActiveMarkerKey(null);
    setCandidates((prev) =>
      prev.map((c) => ({
        ...c,
        selected: checked,
        excludeReason: checked ? undefined : c.excludeReason || '직접 제외',
      }))
    );
  };

  const handleToggleSingleRow = (idx: number) => {
    setCandidates((prev) =>
      prev.map((c, i) => {
        if (i !== idx) return c;
        const nextSelected = !c.selected;
        return {
          ...c,
          selected: nextSelected,
          excludeReason: nextSelected ? undefined : '직접 제외',
        };
      })
    );
  };

  const handleMoveCandidateRow = (idx: number, direction: 'up' | 'down') => {
    setCandidates((prev) => {
      const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= prev.length) return prev;
      const copy = [...prev];
      const [moved] = copy.splice(idx, 1);
      copy.splice(targetIdx, 0, moved);
      return copy;
    });
  };

  const handleInlineEditCandidate = (
    idx: number,
    field: 'name' | 'supplier' | 'spec' | 'quantity' | 'unit' | 'packQty' | 'remarks',
    value: string
  ) => {
    setCandidates((prev) =>
      prev.map((c, i) => {
        if (i !== idx) return c;
        const item = { ...c.previewItem };
        if (field === 'name') item.name = value;
        else if (field === 'supplier') item.supplier = value === '-' ? '' : value;
        else if (field === 'spec') item.spec = value || '-';
        else if (field === 'quantity') {
          const parsed = parseFloat(value);
          item.quantity = isNaN(parsed) || parsed < 0 ? 0 : parsed;
          if (item.quantity > 0 && (!item.unit || item.unit === '-')) {
            item.unit = 'EA';
          }
        } else if (field === 'unit') {
          item.unit = value || '-';
        } else if (field === 'packQty') {
          const pq = parseFloat(value);
          item.packQty = !isNaN(pq) && pq > 0 ? pq : undefined;
          item.subUnit = item.packQty ? item.subUnit || 'EA' : undefined;
        } else if (field === 'remarks') {
          item.remarks = value;
        }
        return { ...c, previewItem: item };
      })
    );
  };

  const selectedCandidates = useMemo(
    () => candidates.filter((c) => c.selected && c.previewItem.name.trim() !== ''),
    [candidates]
  );

  const excludedCount = useMemo(
    () => candidates.filter((c) => !c.selected).length,
    [candidates]
  );

  const visibleCandidateEntries = useMemo(() => {
    const withIdx = candidates.map((cand, originalIdx) => ({ cand, originalIdx }));
    if (hideExcludedRows) {
      return withIdx.filter((entry) => entry.cand.selected);
    }
    return withIdx;
  }, [candidates, hideExcludedRows]);

  const handleConfirmSingleImport = () => {
    if (selectedCandidates.length === 0) {
      setParseError('가져올 자재 항목이 없습니다. 제외 조건이나 체크박스를 확인해 주세요.');
      return;
    }

    if (destinationMode === 'new' && !newSheetName.trim()) {
      setParseError('새로 만들 시트 이름을 입력해 주세요. (예: 사무용품)');
      return;
    }

    onImportSingle({
      destinationMode,
      targetSheetId: destinationMode === 'existing' ? targetSheetId : undefined,
      newSheetName: destinationMode === 'new' ? newSheetName.trim() : undefined,
      newSheetSubtitle:
        destinationMode === 'new'
          ? newSheetSubtitle.trim() || `${sourceFileName || '엑셀'}에서 가져온 자재 목록`
          : undefined,
      items: selectedCandidates.map((c) => c.previewItem),
    });
  };

  const multiSheetSummary = useMemo(() => {
    if (rawSheets.length <= 1) return [];
    return rawSheets
      .filter(
        (rs) =>
          rs.sheetName !== '전체 통합 현황' && rs.sheetName !== '품목별 합계 현황'
      )
      .map((rs) => ({
        name: rs.sheetName,
        subtitle: `${sourceFileName || '엑셀 파일'}에서 일괄 가져온 시트`,
        items: autoConvertRawSheetItems(rs, defaultDate, exclusionText),
      }))
      .filter((s) => s.items.length > 0);
  }, [rawSheets, defaultDate, sourceFileName, exclusionText]);

  const handleConfirmMultiSheetImport = () => {
    if (multiSheetSummary.length === 0) return;
    onImportMultipleSheets({ sheetsToCreate: multiSheetSummary });
  };

  const handleResetSource = () => {
    setSourceFileName('');
    setRawSheets([]);
    setCandidates([]);
    setPasteText('');
    setParseError(null);
    setActiveMarkerKey(null);
    setAppliedRules([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const mappingSummaryText = useMemo(() => {
    const labelOf = (colIdx: number) => {
      if (colIdx < 0) return '없음';
      const raw = columnLabels[colIdx] || `${colIdx + 1}열`;
      return raw.replace(/\s*\(\d+열\)$/, '');
    };
    const parts = [`품목명: [${labelOf(mapping.nameCol)}]`];
    if (mapping.supplierCol >= 0) parts.push(`구매처: [${labelOf(mapping.supplierCol)}]`);
    if (mapping.specCol >= 0) parts.push(`규격: [${labelOf(mapping.specCol)}]`);
    if (mapping.qtyCol >= 0) parts.push(`수량: [${labelOf(mapping.qtyCol)}]`);
    if (mapping.unitCol >= 0) parts.push(`단위: [${labelOf(mapping.unitCol)}]`);
    if (mapping.packQtyCol >= 0) parts.push(`입수량: [${labelOf(mapping.packQtyCol)}]`);
    if (mapping.usageCol >= 0 || mapping.remarksCol >= 0) {
      const noteCols = [mapping.usageCol, mapping.remarksCol]
        .filter((idx) => idx >= 0)
        .map(labelOf)
        .join(' + ');
      parts.push(`비고: [${noteCols}]`);
    }
    return parts.join(' · ');
  }, [columnLabels, mapping]);

  const unmatchedKeywords = useMemo(
    () => appliedRules.map((r) => r.unmatchedKeyword).filter(Boolean) as string[],
    [appliedRules]
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5">
      <div className="bg-white rounded-2xl max-w-6xl w-full shadow-2xl border border-slate-200 flex flex-col max-h-[92vh] overflow-hidden">
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-4 bg-white shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-bold text-slate-900 truncate">
                엑셀 표 자동 가져오기
              </h2>
              <p className="text-xs text-slate-500 truncate">
                엑셀 파일 업로드 또는 셀 복사·붙여넣기 후, 원하지 않는 항목은 특이사항 칸에 적어 자동으로 뺄 수 있습니다.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors shrink-0"
            title="닫기"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Input Mode Switcher */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-xl">
              <button
                type="button"
                onClick={() => setInputTab('file')}
                className={`px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                  inputTab === 'file'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Upload className="w-3.5 h-3.5 text-emerald-600" />
                <span>1. 엑셀 파일 업로드 (.xlsx / .xls / .csv)</span>
              </button>
              <button
                type="button"
                onClick={() => setInputTab('paste')}
                className={`px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                  inputTab === 'paste'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <ClipboardPaste className="w-3.5 h-3.5 text-blue-600" />
                <span>2. 엑셀 셀 복사 · 붙여넣기 (Ctrl+V)</span>
              </button>
            </div>

            {rawSheets.length > 0 && (
              <button
                type="button"
                onClick={handleResetSource}
                className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg flex items-center gap-1.5 transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>다른 표 다시 올리기</span>
              </button>
            )}
          </div>

          {parseError && (
            <div className="px-4 py-3 rounded-xl bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-700 flex items-center justify-between gap-2">
              <span>{parseError}</span>
              <button
                type="button"
                onClick={() => setParseError(null)}
                className="text-rose-500 hover:text-rose-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Source Input Area */}
          {inputTab === 'file' ? (
            rawSheets.length === 0 || sourceFileName === '클립보드 붙여넣기' ? (
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
                  if (file) void handleProcessFile(file);
                }}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-7 sm:p-8 text-center cursor-pointer transition-colors ${
                  isDragging
                    ? 'border-emerald-500 bg-emerald-50/60'
                    : 'border-slate-300 hover:border-emerald-500 hover:bg-slate-50'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.xlsm,.csv"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleProcessFile(file);
                  }}
                />
                <div className="w-11 h-11 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-2.5">
                  <Upload className="w-5 h-5" />
                </div>
                <p className="text-sm font-bold text-slate-900">
                  {isParsing
                    ? '엑셀 표를 분석하고 있습니다...'
                    : '여기에 엑셀 파일을 끌어다 놓거나 클릭하여 선택하세요'}
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  품명 · 규격 · 단위 · 수량 · 용도 · 비고 · O 체크 표시까지 자동으로 인식합니다 (.xlsx, .xls, .csv)
                </p>
              </div>
            ) : (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <FileSpreadsheet className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span className="font-bold text-slate-900">{sourceFileName}</span>
                  <span className="text-slate-400">·</span>
                  <span className="text-slate-600">인식된 시트 {rawSheets.length}개</span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {multiSheetSummary.length > 1 && (
                    <button
                      type="button"
                      onClick={handleConfirmMultiSheetImport}
                      className="px-3 py-1.5 text-xs font-semibold text-emerald-800 bg-emerald-100 hover:bg-emerald-200 rounded-lg flex items-center gap-1.5 transition-colors"
                    >
                      <Layers className="w-3.5 h-3.5" />
                      <span>
                        엑셀 내 {multiSheetSummary.length}개 시트 통째로 추가 (총{' '}
                        {multiSheetSummary.reduce((s, x) => s + x.items.length, 0)}건)
                      </span>
                    </button>
                  )}

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.xls,.xlsm,.csv"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void handleProcessFile(file);
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg transition-colors"
                  >
                    파일 변경
                  </button>
                </div>
              </div>
            )
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <label className="font-semibold text-slate-700">
                  엑셀에서 표 영역을 드래그해 복사(Ctrl+C)한 뒤 아래 칸에 붙여넣기(Ctrl+V) 하세요
                </label>
                <button
                  type="button"
                  onClick={() => handleParsePasteText(SAMPLE_PASTE_TEXT)}
                  className="text-blue-600 hover:text-blue-800 font-semibold"
                >
                  예시 표 넣어보기
                </button>
              </div>
              <textarea
                rows={candidates.length > 0 ? 3 : 5}
                value={pasteText}
                onChange={(e) => handleParsePasteText(e.target.value)}
                placeholder={
                  '엑셀에서 머리글 포함(또는 데이터만) 복사하여 그대로 붙여넣으세요.\n예: NO | 제조사 | 품명 | 용도 | 규격 | 단위 | 제작 및 구매수량 | 비고'
                }
                className="w-full p-3 text-xs font-mono bg-slate-50 focus:bg-white border border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 rounded-xl outline-none transition-colors"
              />
            </div>
          )}

          {/* ==================== 특이사항 / 제외·선별 요청 칸 (Always Visible!) ==================== */}
          <div className="bg-amber-50/50 border border-amber-200/90 rounded-xl p-4 space-y-2.5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <label
                  htmlFor="exclusion-instruction-input"
                  className="text-xs sm:text-sm font-bold text-slate-900 flex items-center gap-1.5"
                >
                  <Ban className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>특이사항 / 제외·선별 요청 칸 (넣고 싶지 않은 항목 자동 빼기)</span>
                </label>
                <p className="text-xs text-slate-600 mt-0.5">
                  빼고 싶은 품목명·번호·조건을 편하게 적어주시면 표에서 알아서 제외(체크 해제)합니다.
                </p>
              </div>

              {exclusionText.trim() && (
                <button
                  type="button"
                  onClick={() => handleExclusionTextChange('')}
                  className="self-start sm:self-auto px-2.5 py-1 text-xs font-semibold text-slate-600 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg transition-colors whitespace-nowrap"
                >
                  요청 초기화 (전체 다시 포함)
                </button>
              )}
            </div>

            <textarea
              id="exclusion-instruction-input"
              rows={2}
              value={exclusionText}
              onChange={(e) => handleExclusionTextChange(e.target.value)}
              placeholder="예: 수량 빈칸 빼줘, 1~5번 제외, 스티커랑 건전지 빼고 넣어줘, 동그라미(O) 표시만 넣어줘"
              className="w-full px-3.5 py-2.5 text-xs sm:text-sm bg-white border border-amber-300 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 rounded-lg outline-none transition-colors text-slate-900 placeholder:text-slate-400"
            />

            {/* Quick 1-Click Condition Buttons */}
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-[11px] font-semibold text-slate-500 mr-1">
                자주 쓰는 제외 조건 클릭:
              </span>
              {QUICK_EXCLUSION_CHIPS.map((chip) => {
                const isSelected = exclusionText
                  .split(',')
                  .map((s) => s.trim())
                  .includes(chip.phrase);
                return (
                  <button
                    key={chip.phrase}
                    type="button"
                    onClick={() => handleToggleQuickChip(chip.phrase)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                      isSelected
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                    }`}
                  >
                    {chip.label}
                  </button>
                );
              })}
            </div>

            {/* Live Feedback of Applied Exclusion Rules */}
            {exclusionText.trim() && currentRawSheet && (
              <div className="pt-2 border-t border-amber-200/70 flex flex-col gap-1 text-xs">
                {appliedRules.length > 0 && (
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-slate-700">
                    <span className="font-bold text-slate-900">적용 결과:</span>
                    <span>
                      {appliedRules
                        .map((r) => `${r.label} (${r.affectedCount}건)`)
                        .join(' · ')}
                    </span>
                    <span className="text-slate-400">→</span>
                    <span className="font-bold text-rose-700">
                      총 {excludedCount}건 제외됨
                    </span>
                    <span className="text-slate-400">/</span>
                    <span className="font-bold text-blue-700">
                      대장에 등록할 {selectedCandidates.length}건 남음
                    </span>
                  </div>
                )}

                {unmatchedKeywords.length > 0 && (
                  <div className="text-amber-800 font-medium">
                    * 표에서 찾지 못한 단어: {unmatchedKeywords.map((k) => `'${k}'`).join(', ')} (품목명이나 철자를 확인해 주세요)
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Sheet Tabs when uploaded Excel has multiple sheets */}
          {rawSheets.length > 1 && inputTab === 'file' && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
              <span className="text-xs font-semibold text-slate-500 mr-1 shrink-0">
                엑셀 시트 선택:
              </span>
              {rawSheets.map((rs, idx) => (
                <button
                  key={`${rs.sheetName}-${idx}`}
                  type="button"
                  onClick={() => handleSelectRawSheetTab(idx)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                    selectedRawSheetIdx === idx
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {rs.sheetName} ({rs.rows.length}행)
                </button>
              ))}
            </div>
          )}

          {/* Destination & Column Mapping Controls (Visible once rows are parsed) */}
          {currentRawSheet && (
            <>
              {/* Destination Selection Bar */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 grid grid-cols-1 lg:grid-cols-12 gap-4 items-end">
                <div className="lg:col-span-4">
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    저장할 시트 선택
                  </label>
                  <div className="flex p-1 bg-slate-200/80 rounded-lg gap-1">
                    <button
                      type="button"
                      onClick={() => setDestinationMode('existing')}
                      className={`flex-1 py-1.5 px-2.5 text-xs font-semibold rounded-md transition-colors ${
                        destinationMode === 'existing'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      기존 시트에 추가
                    </button>
                    <button
                      type="button"
                      onClick={() => setDestinationMode('new')}
                      className={`flex-1 py-1.5 px-2.5 text-xs font-semibold rounded-md flex items-center justify-center gap-1 transition-colors ${
                        destinationMode === 'new'
                          ? 'bg-white text-blue-700 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <FolderPlus className="w-3.5 h-3.5" />
                      <span>새 시트 생성</span>
                    </button>
                  </div>
                </div>

                {destinationMode === 'existing' ? (
                  <div className="lg:col-span-5">
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      대상 시트
                    </label>
                    <select
                      value={targetSheetId}
                      onChange={(e) => setTargetSheetId(e.target.value)}
                      className="w-full px-3 py-2 text-sm font-semibold bg-white border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {sheets.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} (현재 {s.items.length}건)
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="lg:col-span-5 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                        새 시트 이름 <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={newSheetName}
                        onChange={(e) => setNewSheetName(e.target.value)}
                        placeholder="예: 사무용품, 소모품 발주"
                        className="w-full px-3 py-2 text-sm font-semibold bg-white border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                        시트 설명 (선택)
                      </label>
                      <input
                        type="text"
                        value={newSheetSubtitle}
                        onChange={(e) => setNewSheetSubtitle(e.target.value)}
                        placeholder="예: 사무동 비치 물품"
                        className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                )}

                <div className="lg:col-span-3">
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    기본 반입일자 (일자 열 없을 때 적용)
                  </label>
                  <input
                    type="date"
                    value={defaultDate}
                    onChange={(e) => {
                      const nextDate = e.target.value;
                      setDefaultDate(nextDate);
                      rebuildWithMapping(headerRowIndex, mapping, nextDate);
                    }}
                    className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* Auto-Detected Column Mapping Summary & Optional Customizer */}
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 bg-white flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2 text-slate-600">
                    <span className="font-bold text-slate-900">열 자동 매핑 결과</span>
                    <span className="text-slate-300">·</span>
                    <span>{mappingSummaryText}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowMappingEditor((v) => !v)}
                    className="px-2.5 py-1 rounded-md text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 flex items-center gap-1 transition-colors"
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5" />
                    <span>{showMappingEditor ? '열 설정 접기' : '열 매핑 직접 조정'}</span>
                  </button>
                </div>

                {showMappingEditor && (
                  <div className="p-4 bg-slate-50 border-t border-slate-200 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-200/80 text-xs">
                      <span className="text-slate-600">
                        엑셀 표의 열 이름이 특이한 경우 아래에서 직접 연결할 열을 선택하세요.
                      </span>
                      <label className="inline-flex items-center gap-2 font-semibold text-slate-700 cursor-pointer">
                        <span>머리글(제목) 행 위치:</span>
                        <select
                          value={headerRowIndex}
                          onChange={(e) =>
                            rebuildWithMapping(
                              parseInt(e.target.value, 10),
                              mapping,
                              defaultDate
                            )
                          }
                          className="px-2 py-1 text-xs bg-white border border-slate-300 rounded-md"
                        >
                          <option value={-1}>머리글 없음 (1행부터 데이터)</option>
                          {currentRawSheet.rows
                            .slice(0, Math.min(currentRawSheet.rows.length, 10))
                            .map((r, rIdx) => (
                              <option key={rIdx} value={rIdx}>
                                {rIdx + 1}행 ({r.filter(Boolean).slice(0, 3).join(', ')})
                              </option>
                            ))}
                        </select>
                      </label>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-9 gap-2.5 text-xs">
                      {(
                        [
                          { key: 'nameCol', label: '자재 품목명 *', required: true },
                          { key: 'supplierCol', label: '구매처', required: false },
                          { key: 'specCol', label: '규격 / 사양', required: false },
                          { key: 'qtyCol', label: '반입 수량', required: false },
                          { key: 'unitCol', label: '단위', required: false },
                          { key: 'packQtyCol', label: '단위당 입수량', required: false },
                          { key: 'dateCol', label: '반입일자', required: false },
                          { key: 'usageCol', label: '용도 (비고 병합)', required: false },
                          { key: 'remarksCol', label: '비고', required: false },
                        ] as const
                      ).map((field) => (
                        <div key={field.key}>
                          <label className="block font-semibold text-slate-700 mb-1 truncate">
                            {field.label}
                          </label>
                          <select
                            value={mapping[field.key]}
                            onChange={(e) => {
                              const nextVal = parseInt(e.target.value, 10);
                              rebuildWithMapping(
                                headerRowIndex,
                                { ...mapping, [field.key]: nextVal },
                                defaultDate
                              );
                            }}
                            className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded-md outline-none focus:border-blue-500"
                          >
                            {!field.required && <option value={-1}>(사용 안 함)</option>}
                            {columnLabels.map((lbl, cIdx) => (
                              <option key={cIdx} value={cIdx}>
                                {lbl}
                              </option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Filter & Selection Toolbar */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold text-slate-900">
                    미리보기 ({selectedCandidates.length}건 포함 · {excludedCount}건 제외됨)
                  </span>

                  {markerOptions.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 ml-1">
                      {markerOptions.map((opt) => {
                        const key = `${opt.colIndex}:${opt.markerValue}`;
                        const isActive = activeMarkerKey === key;
                        return (
                          <button
                            key={key}
                            type="button"
                            onClick={() => handleMarkerFilter(opt)}
                            className={`px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 border transition-colors ${
                              isActive
                                ? 'bg-blue-600 text-white border-blue-600'
                                : 'bg-amber-50 text-amber-900 border-amber-300 hover:bg-amber-100'
                            }`}
                          >
                            <Filter className="w-3 h-3" />
                            <span>
                              &apos;{opt.markerValue}&apos; 표시 항목만 선택 ({opt.matchCount}건)
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  {excludedCount > 0 && (
                    <button
                      type="button"
                      onClick={() => setHideExcludedRows((v) => !v)}
                      className={`px-2.5 py-1 rounded-md font-semibold flex items-center gap-1 transition-colors ${
                        hideExcludedRows
                          ? 'bg-slate-900 text-white'
                          : 'bg-rose-50 text-rose-700 hover:bg-rose-100'
                      }`}
                    >
                      {hideExcludedRows ? (
                        <>
                          <Eye className="w-3.5 h-3.5" />
                          <span>제외된 {excludedCount}건도 함께 보기</span>
                        </>
                      ) : (
                        <>
                          <EyeOff className="w-3.5 h-3.5" />
                          <span>제외된 {excludedCount}건 화면에서 숨기기</span>
                        </>
                      )}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => handleToggleAllRows(true)}
                    className="px-2.5 py-1 rounded-md font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 transition-colors"
                  >
                    전체 선택
                  </button>
                  <button
                    type="button"
                    onClick={() => handleToggleAllRows(false)}
                    className="px-2.5 py-1 rounded-md font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors"
                  >
                    전체 해제
                  </button>
                </div>
              </div>

              {/* Ledger Preview Table (Inline Editable + Per-Row Exclude) */}
              <div className="border-2 border-slate-800 rounded-xl overflow-hidden">
                <div className="overflow-x-auto max-h-[340px]">
                  <table className="w-full text-center border-collapse text-xs">
                    <thead className="sticky top-0 z-10">
                      <tr className="bg-[#1e293b] text-white font-bold divide-x divide-slate-600">
                        <th className="py-2.5 px-2.5 w-16">빼기</th>
                        <th className="py-2.5 px-2.5 w-10">
                          <input
                            type="checkbox"
                            checked={
                              candidates.length > 0 &&
                              candidates.every((c) => c.selected)
                            }
                            onChange={(e) => handleToggleAllRows(e.target.checked)}
                            className="w-4 h-4 rounded accent-blue-600 cursor-pointer"
                            title="전체 포함 / 제외"
                          />
                        </th>
                        <th className="py-2.5 px-2 w-20">순서</th>
                        <th className="py-2.5 px-2.5 w-28">반입일자</th>
                        <th className="py-2.5 px-2.5 min-w-[110px]">구매처</th>
                        <th className="py-2.5 px-3 text-left min-w-[200px]">자재 품목명</th>
                        <th className="py-2.5 px-2.5 min-w-[110px]">규격 / 사양</th>
                        <th className="py-2.5 px-2.5 w-24">반입 수량</th>
                        <th className="py-2.5 px-2.5 w-20">단위</th>
                        <th className="py-2.5 px-2.5 w-28">단위당 입수량</th>
                        <th className="py-2.5 px-3 w-32">총 수량</th>
                        <th className="py-2.5 px-3 min-w-[180px]">비고</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 bg-white">
                      {visibleCandidateEntries.length === 0 ? (
                        <tr>
                          <td colSpan={12} className="py-8 text-slate-400">
                            {candidates.length === 0
                              ? '추출 가능한 데이터 행이 없습니다. 상단 [열 매핑 직접 조정]을 확인해 주세요.'
                              : '모든 행이 제외 조건에 의해 숨겨졌습니다. 위 [요청 초기화] 또는 [제외된 건 함께 보기]를 눌러주세요.'}
                          </td>
                        </tr>
                      ) : (
                        visibleCandidateEntries.map(({ cand, originalIdx }) => {
                          const item = cand.previewItem;
                          const hasQty = item.quantity > 0;
                          const conv = hasQty ? getTotalConvertedQty(item) : null;
                          const totalLabel = !hasQty
                            ? '-'
                            : conv !== null
                            ? `${conv.toLocaleString()} ${item.subUnit || 'EA'}`
                            : `${item.quantity.toLocaleString()} ${item.unit}`;

                          return (
                            <tr
                              key={cand.rowIndex}
                              className={`divide-x divide-slate-200 transition-colors ${
                                cand.selected
                                  ? 'bg-white hover:bg-blue-50/30'
                                  : 'bg-rose-50/40 opacity-60'
                              }`}
                            >
                              <td className="py-1.5 px-2">
                                <button
                                  type="button"
                                  onClick={() => handleToggleSingleRow(originalIdx)}
                                  className={`px-2 py-1 rounded text-[11px] font-semibold transition-colors whitespace-nowrap ${
                                    cand.selected
                                      ? 'text-rose-600 bg-rose-50 hover:bg-rose-600 hover:text-white border border-rose-200'
                                      : 'text-blue-700 bg-blue-50 hover:bg-blue-100'
                                  }`}
                                >
                                  {cand.selected ? '빼기' : '복구'}
                                </button>
                              </td>
                              <td className="py-2 px-2">
                                <input
                                  type="checkbox"
                                  checked={cand.selected}
                                  onChange={() => handleToggleSingleRow(originalIdx)}
                                  className="w-4 h-4 rounded accent-blue-600 cursor-pointer"
                                />
                              </td>
                              <td className="py-1.5 px-2 font-mono tabular-nums text-slate-600 whitespace-nowrap">
                                <div className="flex items-center justify-center gap-1">
                                  <span>{originalIdx + 1}</span>
                                  {!hideExcludedRows && candidates.length > 1 && (
                                    <span className="flex flex-col -space-y-0.5">
                                      <button
                                        type="button"
                                        disabled={originalIdx === 0}
                                        onClick={() => handleMoveCandidateRow(originalIdx, 'up')}
                                        className="p-0.5 text-slate-400 hover:text-blue-600 disabled:opacity-25"
                                        title="위로 이동"
                                      >
                                        <ChevronUp className="w-3 h-3" />
                                      </button>
                                      <button
                                        type="button"
                                        disabled={originalIdx === candidates.length - 1}
                                        onClick={() => handleMoveCandidateRow(originalIdx, 'down')}
                                        className="p-0.5 text-slate-400 hover:text-blue-600 disabled:opacity-25"
                                        title="아래로 이동"
                                      >
                                        <ChevronDown className="w-3 h-3" />
                                      </button>
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="py-2 px-2 font-mono tabular-nums text-slate-700 whitespace-nowrap">
                                {item.date}
                              </td>
                              <td className="py-1.5 px-2">
                                <input
                                  type="text"
                                  value={item.supplier || ''}
                                  placeholder="-"
                                  onChange={(e) =>
                                    handleInlineEditCandidate(
                                      originalIdx,
                                      'supplier',
                                      e.target.value
                                    )
                                  }
                                  className="w-full px-1.5 py-1 text-center text-slate-700 bg-transparent hover:bg-slate-100 focus:bg-white border border-transparent focus:border-blue-400 rounded outline-none"
                                />
                              </td>
                              <td className="py-1.5 px-2 text-left">
                                <div className="flex items-center gap-1.5">
                                  <input
                                    type="text"
                                    value={item.name}
                                    onChange={(e) =>
                                      handleInlineEditCandidate(
                                        originalIdx,
                                        'name',
                                        e.target.value
                                      )
                                    }
                                    className={`w-full px-1.5 py-1 font-bold bg-transparent hover:bg-slate-100 focus:bg-white border border-transparent focus:border-blue-400 rounded outline-none ${
                                      cand.selected
                                        ? 'text-slate-900'
                                        : 'text-slate-400 line-through'
                                    }`}
                                  />
                                  {!cand.selected && cand.excludeReason && (
                                    <span className="text-[11px] font-medium text-rose-600 whitespace-nowrap shrink-0">
                                      ({cand.excludeReason})
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="py-1.5 px-2">
                                <input
                                  type="text"
                                  value={item.spec === '-' ? '' : item.spec}
                                  placeholder="-"
                                  onChange={(e) =>
                                    handleInlineEditCandidate(
                                      originalIdx,
                                      'spec',
                                      e.target.value
                                    )
                                  }
                                  className="w-full px-1.5 py-1 text-center text-slate-700 bg-transparent hover:bg-slate-100 focus:bg-white border border-transparent focus:border-blue-400 rounded outline-none"
                                />
                              </td>
                              <td className="py-1.5 px-2">
                                <input
                                  type="number"
                                  step="any"
                                  min="0"
                                  value={item.quantity === 0 ? '' : item.quantity}
                                  placeholder="-"
                                  onChange={(e) =>
                                    handleInlineEditCandidate(
                                      originalIdx,
                                      'quantity',
                                      e.target.value
                                    )
                                  }
                                  className="w-full px-1.5 py-1 text-center font-mono tabular-nums font-bold text-slate-900 bg-transparent hover:bg-slate-100 focus:bg-white border border-transparent focus:border-blue-400 rounded outline-none"
                                />
                              </td>
                              <td className="py-1.5 px-2">
                                <input
                                  type="text"
                                  value={item.unit === '-' ? '' : item.unit}
                                  placeholder="-"
                                  onChange={(e) =>
                                    handleInlineEditCandidate(
                                      originalIdx,
                                      'unit',
                                      e.target.value
                                    )
                                  }
                                  className="w-full px-1.5 py-1 text-center text-slate-700 bg-transparent hover:bg-slate-100 focus:bg-white border border-transparent focus:border-blue-400 rounded outline-none"
                                />
                              </td>
                              <td className="py-1.5 px-2">
                                <input
                                  type="number"
                                  step="any"
                                  min="0"
                                  value={item.packQty ?? ''}
                                  placeholder="-"
                                  onChange={(e) =>
                                    handleInlineEditCandidate(
                                      originalIdx,
                                      'packQty',
                                      e.target.value
                                    )
                                  }
                                  className="w-full px-1.5 py-1 text-center font-mono tabular-nums text-slate-600 bg-transparent hover:bg-slate-100 focus:bg-white border border-transparent focus:border-blue-400 rounded outline-none"
                                />
                              </td>
                              <td className="py-2 px-3 text-right font-mono tabular-nums font-bold whitespace-nowrap">
                                <span
                                  className={
                                    !hasQty
                                      ? 'text-slate-400 font-normal'
                                      : conv !== null
                                      ? 'text-blue-700'
                                      : 'text-slate-900'
                                  }
                                >
                                  {totalLabel}
                                </span>
                              </td>
                              <td className="py-1.5 px-2 text-left">
                                <input
                                  type="text"
                                  value={item.remarks}
                                  placeholder="-"
                                  onChange={(e) =>
                                    handleInlineEditCandidate(
                                      originalIdx,
                                      'remarks',
                                      e.target.value
                                    )
                                  }
                                  className="w-full px-1.5 py-1 text-slate-600 bg-transparent hover:bg-slate-100 focus:bg-white border border-transparent focus:border-blue-400 rounded outline-none"
                                />
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Sticky Footer Actions */}
        <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
          <div className="text-xs text-slate-600">
            {currentRawSheet ? (
              <span>
                제외된 <strong className="font-semibold text-rose-700">{excludedCount}건</strong>을 빼고, 선택된{' '}
                <strong className="font-semibold text-blue-700">
                  {selectedCandidates.length}건
                </strong>
                만 대장에 들어갑니다.
              </span>
            ) : (
              <span>
                특이사항(제외 조건)을 미리 적어두거나, 엑셀 파일을 올린 뒤 바로 적어주셔도 실시간 반영됩니다.
              </span>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-200/70 rounded-lg transition-colors"
            >
              취소
            </button>
            <button
              type="button"
              disabled={selectedCandidates.length === 0}
              onClick={handleConfirmSingleImport}
              className="px-5 py-2.5 text-xs sm:text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed rounded-lg transition-colors flex items-center gap-1.5"
            >
              <Check className="w-4 h-4" />
              <span>
                {destinationMode === 'new'
                  ? `새 시트에 ${selectedCandidates.length}건 자동 등록`
                  : `선택한 ${selectedCandidates.length}건 대장에 넣기`}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
