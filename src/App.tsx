/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef, Suspense, lazy } from 'react';
import {
  Boxes,
  Plus,
  Trash2,
  Edit3,
  Search,
  Printer,
  CheckCircle2,
  Copy,
  CopyPlus,
  Check,
  X,
  LayoutGrid,
  Table as TableIcon,
  Download,
  Code,
  FileSpreadsheet,
  MapPin,
  Layers,
  FolderPlus,
  ArrowRightLeft,
  Truck,
  Package,
  Upload,
  GripVertical,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  RotateCcw,
  CheckSquare,
  Square,
  Calendar,
  FolderInput,
  Maximize2,
  Minimize2,
  Star,
  Building2,
  Receipt,
  Sparkles,
  Bot,
  MessageSquare,
  Cloud,
  Loader2,
  AlertTriangle,
  RefreshCw,
  HardDrive,
} from 'lucide-react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, sanitizeFirestoreId, testConnection, diagnoseConnectivity } from './firebase';
import {
  SharedSyncStatus,
  SharedLedgerData,
  SyncableSnapshot,
  SyncConflictInfo,
  MigrationRecordInfo,
  readSharedLedgerCache,
  writeSharedLedgerCache,
  readCachedActiveTabId,
  writeCachedActiveTabId,
  subscribeSharedLedger,
  subscribeSharedSlips,
  subscribeSharedMigrations,
  fetchSingleSharedSlip,
  syncSharedChangesToFirestore,
  saveSharedSlipToCloud,
  deleteSharedSlipFromCloud,
  downloadLocalBackupJsonFile,
  fetchLegacyAccountCloudData,
  migrateToSharedLedger,
  mergeIncomingWithDirtyLocal,
  areSnapshotsEquivalent,
} from './utils/cloudSync';
import { createOfficeSuppliesSheet, OFFICE_SUPPLIES_SHEET_ID } from './utils/officeSuppliesSeed';
import {
  createCheongjuYonginSheet,
  CHEONGJU_YONGIN_SHEET_ID,
} from './utils/cheongjuYonginSeed';
import { createGoanriSheet, GOANRI_SHEET_ID } from './utils/goanriSeed';
import { aggregateMaterialItems, AggregatedItemGroup } from './utils/itemAggregation';
import type {
  SingleSheetImportPayload,
  MultiSheetImportPayload,
} from './components/ExcelImportModal';
import type { MaterialDeliveryEntry } from './components/MaterialQuantityModal';
import {
  StoredReceiptSlip,
  getAllSlipsFromDB,
  deleteSlipFromDB,
  clearAllSlipsFromDB,
  DEFAULT_SEED_SLIPS,
  compressReceiptImage,
  saveSlipToDB,
  isImageFile,
} from './utils/slipStorage';

const CloudSyncModal = lazy(() => import('./components/CloudSyncModal'));
const ExcelImportModal = lazy(() => import('./components/ExcelImportModal'));
const ReceiptScanModal = lazy(() => import('./components/ReceiptScanModal'));
const SlipViewerModal = lazy(() => import('./components/SlipViewerModal'));
const SlipArchiveModal = lazy(() => import('./components/SlipArchiveModal'));
const AttachSlipModal = lazy(() => import('./components/AttachSlipModal'));
const DropSlipIntentModal = lazy(() => import('./components/DropSlipIntentModal'));
const GeminiChatbotModal = lazy(() => import('./components/GeminiChatbotModal'));
const MaterialQuantityModal = lazy(() => import('./components/MaterialQuantityModal'));

export interface MaterialItem {
  id: string;
  name: string;
  supplier?: string; // 구매처
  spec: string;
  unit: string;
  quantity: number;
  packQty?: number; // 단위당 입수량 (예: 1파레트 = 630 EA일 때 630)
  subUnit?: string; // 낱개 환산 단위 (예: 'EA', '개')
  isCompleted: boolean;
  location: string;
  remarks: string;
  date: string;
  createdAt?: number;
  slipId?: string; // 소장된 원본 전표 ID (레거시 단일 전표 호환)
  slipIds?: string[]; // 해당 품목에 연결된 다중 전표 ID 목록
  revision?: number; // 동시 수정 충돌 감지를 위한 낙관적 잠금 리비전
}

export function getItemSlipIds(item: MaterialItem): string[] {
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
}

export interface MaterialSheet {
  id: string;
  name: string;
  subtitle: string;
  items: MaterialItem[];
}

interface ConfirmDialogState {
  title: string;
  message: string;
  confirmLabel: string;
  isDestructive?: boolean;
  onConfirm: () => void;
}

const SHEETS_STORAGE_KEY = 'field_material_sheets_v1';
const LEGACY_V3_STORAGE_KEY = 'field_material_checklist_v3';
const OFFICE_SEED_APPLIED_KEY = 'field_office_supplies_seeded_v1';
const CHEONGJU_SEED_APPLIED_KEY = 'field_cheongju_yongin_seeded_v1';
const SHEET_ORDER_GOANRI_FIRST_KEY = 'field_sheet_order_goanri_cheongju_v1';
const SITE_NAME_KEY = 'field_site_name_v2';
const LEGACY_SITE_NAME_KEY = 'field_site_name_v1';
const FAVORITE_PREFS_KEY = 'field_material_favorites_v1';
const YONGIN_ADDRESS = '경기도 용인시 처인구 백암면 고안로181번길 14-19';

interface FavoritePrefsState {
  pinnedKeys: string[];
  mutedAutoKeys: string[];
}

function makeFavoriteLookupKey(rawName: string, rawSpec?: string): string {
  const cleanName = (rawName || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const cleanSpecRaw = (rawSpec || '').trim().replace(/\s+/g, ' ');
  const cleanSpec = !cleanSpecRaw || cleanSpecRaw === '-' ? '-' : cleanSpecRaw.toLowerCase();
  return `${cleanName}||${cleanSpec}`;
}

export const FAVORITE_MATERIALS_TAB_ID = 'FAVORITE_MATERIALS';

export function isOfficeSuppliesSheet(sheet: Pick<MaterialSheet, 'id' | 'name'>): boolean {
  return sheet.id === OFFICE_SUPPLIES_SHEET_ID || sheet.name.trim() === '사무용품';
}

const COMMON_UNITS = ['파레트', 'EA', 'BOX', '개', '마대', '톤백', '랙', '대', 'set', '본', 'kg', 'm'];
const SUB_UNITS = ['EA', '개', 'set', 'kg', 'm', '매', '본'];
const PACK_CONTAINER_UNITS = ['파레트', '파렛트', '팔레트', 'PLT', '박스', 'BOX', '마대', '톤백', '랙', '단'];

export function getTotalConvertedQty(item: Pick<MaterialItem, 'quantity' | 'packQty'>): number | null {
  if (item.packQty && item.packQty > 0) {
    return Math.round(item.quantity * item.packQty * 1000) / 1000;
  }
  return null;
}

function normalizeUnitLabel(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === '파렛트' || trimmed === '팔레트') return '파레트';
  if (trimmed.toLowerCase() === 'box' || trimmed === '박스') return 'BOX';
  if (trimmed.toLowerCase() === 'ea') return 'EA';
  return trimmed;
}

function normalizeMaterialItem(rawItem: MaterialItem): MaterialItem {
  const item: MaterialItem = { ...rawItem };

  const slipIds = getItemSlipIds(item);
  item.slipIds = slipIds;
  if (slipIds.length > 0) {
    item.slipId = slipIds[0];
  } else {
    item.slipId = undefined;
  }

  if (item.location === '용인공장 지정위치') {
    item.location = '';
  }

  // Restore user-defined suppliers by removing unwanted hardcoded placeholders
  if (item.supplier === '용인공장 직발주 납품처' || item.supplier === '현장 납품처') {
    item.supplier = '';
  }

  if (item.packQty === undefined && item.remarks) {
    const match = item.remarks
      .trim()
      .match(/^1\s*(파레트|파렛트|팔레트|PLT|박스|BOX|마대|톤백|랙|단)\s*=\s*([\d,]+(?:\.\d+)?)\s*([a-zA-Z가-힣]+)$/i);

    if (match) {
      const detectedPackUnit = normalizeUnitLabel(match[1]);
      const detectedPackQty = parseFloat(match[2].replace(/,/g, ''));
      const detectedSubUnit = normalizeUnitLabel(match[3]);

      if (!isNaN(detectedPackQty) && detectedPackQty > 0) {
        const specTrimmed = (item.spec || '').trim();
        const isSpecPackWord = PACK_CONTAINER_UNITS.some(
          (u) => u.toLowerCase() === specTrimmed.toLowerCase()
        );

        item.unit = detectedPackUnit;
        item.packQty = detectedPackQty;
        item.subUnit = detectedSubUnit;
        if (isSpecPackWord) {
          item.spec = '-';
        }
        item.remarks = '';
      }
    }
  }

  return item;
}

function normalizeLoadedSheets(sheets: MaterialSheet[]): MaterialSheet[] {
  return sheets.map((sheet) => {
    let items = Array.isArray(sheet.items) ? sheet.items.map(normalizeMaterialItem) : [];
    // If 고안리공장 sheet has 0 items from old empty state, populate with seed items
    if (
      (sheet.id === 'sheet-yongin-direct' || sheet.name.includes('고안리')) &&
      items.length === 0
    ) {
      items = createGoanriSheet().items;
    }
    return {
      ...sheet,
      items,
    };
  });
}

const createDefaultSheets = (legacyItems: MaterialItem[] = []): MaterialSheet[] => [
  createGoanriSheet(),
  createCheongjuYonginSheet(),
  {
    id: 'sheet-general',
    name: '용인공장 → Y1 현장 반입',
    subtitle: '용인공장에서 Y1 현장으로 반입·이동하는 자재 목록',
    items: legacyItems.map(normalizeMaterialItem),
  },
  createOfficeSuppliesSheet(),
];

/**
 * Ensures 1st (leftmost) tab is 고안리 공장 and 2nd tab is 청주사업부 이전,
 * preserving 100% of existing items and user-edited sheet names.
 */
function enforceGoanriCheongjuSheetOrder(list: MaterialSheet[]): MaterialSheet[] {
  const remaining = [...list];

  // 1st (index 0): 고안리 공장 시트
  let goanriIdx = remaining.findIndex((s) =>
    s.name.replace(/\s+/g, '').includes('고안리')
  );
  if (goanriIdx === -1) {
    goanriIdx = remaining.findIndex(
      (s) => s.id === 'sheet-yongin-direct' || s.name.replace(/\s+/g, '') === '용인직발주반입'
    );
  }

  let firstSheet: MaterialSheet;
  if (goanriIdx !== -1) {
    const [picked] = remaining.splice(goanriIdx, 1);
    const resolvedItems =
      picked.items.length === 0 ? createGoanriSheet().items : picked.items;
    firstSheet =
      picked.name.trim() === '용인 직발주 반입'
        ? {
            ...picked,
            name: '고안리공장 납품 LIST',
            subtitle: '고안리공장(용인공장)으로 신규 발주·납품되어 반입되는 자재 목록',
            items: resolvedItems,
          }
        : {
            ...picked,
            items: resolvedItems,
          };
  } else {
    firstSheet = createGoanriSheet();
  }

  // 2nd (index 1): 청주사업부 이전 시트
  let cheongjuIdx = remaining.findIndex((s) => {
    const compact = s.name.replace(/\s+/g, '');
    return compact.includes('청주') && compact.includes('이전');
  });
  if (cheongjuIdx === -1) {
    cheongjuIdx = remaining.findIndex(
      (s) => s.id === CHEONGJU_YONGIN_SHEET_ID || s.name.replace(/\s+/g, '').includes('청주')
    );
  }

  if (cheongjuIdx !== -1) {
    const [pickedCheongju] = remaining.splice(cheongjuIdx, 1);
    const secondSheet: MaterialSheet =
      pickedCheongju.name.trim() === '청주 → 용인 이전'
        ? {
            ...pickedCheongju,
            name: '청주사업부 → 용인사업부 이전',
          }
        : pickedCheongju;
    return [firstSheet, secondSheet, ...remaining];
  }

  return [firstSheet, ...remaining];
}

export default function App() {
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const qtyInputRef = useRef<HTMLInputElement | null>(null);

  // Isolated Shared Ledger Cache (strictly separate from legacy personal LocalStorage, read-only preview until server verifies)
  const [initialCache] = useState(() => readSharedLedgerCache());
  const [initialCachedTab] = useState(() => readCachedActiveTabId());

  // Real-time Shared Company Ledger State (No Login Required)
  const [sharedData, setSharedData] = useState<SharedLedgerData | null>(null);
  const [isSharedCloudReady, setIsSharedCloudReady] = useState<boolean>(() => Boolean(initialCache));
  const [isShowingCachedPreview, setIsShowingCachedPreview] = useState<boolean>(() =>
    Boolean(initialCache)
  );
  const [isAllSheetsSynced, setIsAllSheetsSynced] = useState<boolean>(false);
  const [hasVerifiedServerData, setHasVerifiedServerData] = useState<boolean>(false);
  const [syncStatus, setSyncStatus] = useState<SharedSyncStatus>(() =>
    initialCache ? 'cached_checking' : 'connecting'
  );
  const [syncError, setSyncError] = useState<string | null>(null);
  const [connectionDiagnostic, setConnectionDiagnostic] = useState<{
    category: string;
    summary: string;
    detail: string;
  } | null>(null);
  const [syncConflicts, setSyncConflicts] = useState<SyncConflictInfo[]>([]);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [showCloudSyncModal, setShowCloudSyncModal] = useState<boolean>(false);
  const [syncRetryTrigger, setSyncRetryTrigger] = useState<number>(0);
  const [listenerRetryTrigger, setListenerRetryTrigger] = useState<number>(0);
  const [migrationCheckTick, setMigrationCheckTick] = useState<number>(0);
  const [migrationsList, setMigrationsList] = useState<MigrationRecordInfo[]>([]);
  const [hasFullSlipsLoaded, setHasFullSlipsLoaded] = useState<boolean>(false);
  const [slipViewerLoading, setSlipViewerLoading] = useState<boolean>(false);

  // Silent read-only detection of legacy per-user cloud archive if this admin browser still holds a legacy session
  const [legacyAccountData, setLegacyAccountData] = useState<{
    uid: string;
    email: string;
    siteName: string;
    sheets: MaterialSheet[];
    slips: StoredReceiptSlip[];
    favoritePinnedKeys: string[];
    favoriteMutedAutoKeys: string[];
  } | null>(null);

  const lastSyncedSnapshotRef = useRef<SyncableSnapshot | null>(null);
  const preServerCacheSnapshotRef = useRef<SyncableSnapshot | null>(
    initialCache
      ? {
          siteName: initialCache.siteName,
          favoritePinnedKeys: initialCache.favoritePinnedKeys,
          favoriteMutedAutoKeys: initialCache.favoriteMutedAutoKeys,
          sheets: initialCache.sheets,
        }
      : null
  );
  const latestLocalSnapshotRef = useRef<SyncableSnapshot | null>(null);
  const knownSheetIdsRef = useRef<Set<string>>(new Set());
  const knownItemIdsRef = useRef<Set<string>>(new Set());
  const knownSlipIdsRef = useRef<Set<string>>(new Set());
  const hasWorkspaceDocRef = useRef<boolean>(false);
  const sharedCloudExistsRef = useRef<boolean>(false);
  const hasVerifiedServerDataRef = useRef<boolean>(false);
  const hasAutoSelectedInitialTabRef = useRef<boolean>(Boolean(initialCache));
  const sharedSubRef = useRef<{ unsubscribe: () => void; requestAllSheets: () => void } | null>(
    null
  );
  const slipsSubscribedRef = useRef<boolean>(false);
  const cloudSyncTimerRef = useRef<number | null>(null);
  const isSyncInFlightRef = useRef<boolean>(false);
  const needsResyncAfterFlightRef = useRef<boolean>(false);

  // Initialize from isolated shared cache when returning, or empty while connecting so legacy LocalStorage never leaks into shared ledger
  const [sheets, setSheets] = useState<MaterialSheet[]>(() => initialCache?.sheets || []);
  const [activeTabId, setActiveTabId] = useState<string>(() => {
    if (initialCache) {
      if (
        initialCachedTab &&
        (initialCachedTab === 'ALL' ||
          initialCachedTab === FAVORITE_MATERIALS_TAB_ID ||
          initialCache.sheets.some((s) => s.id === initialCachedTab))
      ) {
        return initialCachedTab;
      }
      return initialCache.sheets[0]?.id || 'ALL';
    }
    return initialCachedTab || 'sheet-yongin-direct';
  });
  const [siteName, setSiteName] = useState<string>(
    () => initialCache?.siteName || '신규 발주 자재 반입 관리'
  );
  const [favoritePrefs, setFavoritePrefs] = useState<FavoritePrefsState>(() => ({
    pinnedKeys: initialCache?.favoritePinnedKeys || [],
    mutedAutoKeys: initialCache?.favoriteMutedAutoKeys || [],
  }));
  const [favoriteScope, setFavoriteScope] = useState<'sheet' | 'all'>('sheet');

  // Search, Filter, Pagination & View State
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState<'card' | 'table'>('table');
  const [sortOrder, setSortOrder] = useState<
    'created' | 'date_asc' | 'newest' | 'name' | 'quantity'
  >('created');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(100);

  // Item-by-Item Aggregation Summary Panel State (Clean & Minimal)
  const [isItemSummaryOpen, setIsItemSummaryOpen] = useState<boolean>(true);
  const [summarySortMode, setSummarySortMode] = useState<'ledger' | 'qty_desc' | 'name'>('ledger');
  const [summarySearch, setSummarySearch] = useState<string>('');

  // Reorder State (Drag & Drop + Direct No. Input)
  const [draggedEntry, setDraggedEntry] = useState<{
    sheetId: string;
    itemId: string;
  } | null>(null);
  const [dragOverTarget, setDragOverTarget] = useState<{
    sheetId: string;
    itemId: string;
    position: 'before' | 'after';
  } | null>(null);
  const [editingOrderTarget, setEditingOrderTarget] = useState<{
    sheetId: string;
    itemId: string;
    value: string;
  } | null>(null);

  // Undo History Stack (for instant 1-click delete & batch/clear recovery)
  const [undoHistory, setUndoHistory] = useState<
    Array<{
      label: string;
      snapshot: MaterialSheet[];
    }>
  >([]);

  // Multi-Select & Inline Cell Edit & Layout Comfort State
  const [selectedRowKeys, setSelectedRowKeys] = useState<Set<string>>(new Set());
  const [batchDateValue, setBatchDateValue] = useState<string>('');
  const [batchSupplierValue, setBatchSupplierValue] = useState<string>('');
  const [batchTargetSheetId, setBatchTargetSheetId] = useState<string>('');
  const [isFormCollapsed, setIsFormCollapsed] = useState<boolean>(false);
  const [tableDensity, setTableDensity] = useState<'comfortable' | 'compact'>('comfortable');
  const [inlineEditCell, setInlineEditCell] = useState<{
    sheetId: string;
    itemId: string;
    field: 'date' | 'supplier' | 'name' | 'spec' | 'quantity' | 'unit' | 'packQty' | 'remarks';
    value: string;
    subUnitValue?: string;
  } | null>(null);

  // New Item Form State
  const [targetSheetIdForAllView, setTargetSheetIdForAllView] = useState<string>(() => {
    const pool = (initialCache?.sheets || []).filter((s) => !isOfficeSuppliesSheet(s));
    return pool[0]?.id || initialCache?.sheets[0]?.id || 'sheet-yongin-direct';
  });
  const [name, setName] = useState('');
  const [supplier, setSupplier] = useState('');
  const [spec, setSpec] = useState('');
  const [unit, setUnit] = useState('파레트');
  const [quantity, setQuantity] = useState('');
  const [packQty, setPackQty] = useState('');
  const [subUnit, setSubUnit] = useState('EA');
  const [remarks, setRemarks] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [formError, setFormError] = useState<string | null>(null);

  // Edit Item Modal State
  const [editingState, setEditingState] = useState<{
    item: MaterialItem;
    packQtyInput: string;
    sheetId: string;
    originalSheetId: string;
  } | null>(null);

  // Sheet Add / Edit Modal State
  const [sheetModal, setSheetModal] = useState<{
    mode: 'create' | 'edit';
    sheetId?: string;
    name: string;
    subtitle: string;
  } | null>(null);

  // Confirm Dialog State
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);

  // Export / Import / Receipt Modal & Toast State
  const [showReceiptScanModal, setShowReceiptScanModal] = useState(false);
  const [droppedReceiptFile, setDroppedReceiptFile] = useState<File | null>(null);
  const [slips, setSlips] = useState<StoredReceiptSlip[]>([]);
  const [activeViewingSlipId, setActiveViewingSlipId] = useState<string | null>(null);
  const [viewerScopedSlipIds, setViewerScopedSlipIds] = useState<string[] | null>(null);
  const [showSlipArchiveModal, setShowSlipArchiveModal] = useState(false);
  const [attachingTarget, setAttachingTarget] = useState<{ sheetId: string; item: MaterialItem } | null>(null);
  const [showExcelImportModal, setShowExcelImportModal] = useState(false);
  const [droppedExcelFile, setDroppedExcelFile] = useState<File | null>(null);
  const [fileDropTargetItem, setFileDropTargetItem] = useState<{ sheetId: string; itemId: string } | null>(null);
  const [droppedSlipIntentFile, setDroppedSlipIntentFile] = useState<File | null>(null);
  const [isWindowDragging, setIsWindowDragging] = useState(false);
  const [showHtmlExportModal, setShowHtmlExportModal] = useState(false);
  const [showChatbotModal, setShowChatbotModal] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [toastState, setToastState] = useState<{
    message: string;
    canUndo?: boolean;
  } | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const lastDirectDropTimeRef = useRef<number>(0);
  const [isExportingExcel, setIsExportingExcel] = useState(false);
  const [inspectedMaterialTarget, setInspectedMaterialTarget] = useState<{
    name: string;
    spec: string;
  } | null>(null);

  // Read-only snapshot of legacy LocalStorage / IndexedDB slips for one-time admin migration (never auto-uploaded)
  const [localBackupSlips, setLocalBackupSlips] = useState<StoredReceiptSlip[]>(() => {
    try {
      if (typeof window !== 'undefined' && localStorage.getItem('field_backup_slips_cleared') === 'true') {
        return [];
      }
      const existing = localStorage.getItem('field_backup_slips_v1');
      if (existing) {
        const parsed = JSON.parse(existing);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // ignore
    }
    return [];
  });

  latestLocalSnapshotRef.current = {
    siteName,
    favoritePinnedKeys: favoritePrefs.pinnedKeys,
    favoriteMutedAutoKeys: favoritePrefs.mutedAutoKeys,
    sheets,
  };

  const showToast = (msg: string, canUndo = false) => {
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    setToastState({ message: msg, canUndo });
    toastTimerRef.current = window.setTimeout(
      () => setToastState(null),
      canUndo ? 6000 : 3200
    );
  };

  const pushUndoSnapshot = (label: string, currentSheets: MaterialSheet[]) => {
    const deepClone: MaterialSheet[] = JSON.parse(JSON.stringify(currentSheets));
    setUndoHistory((prev) => [{ label, snapshot: deepClone }, ...prev].slice(0, 15));
  };

  const handleUndoLastAction = () => {
    if (undoHistory.length === 0) return;
    const [latest, ...rest] = undoHistory;
    setSheets(latest.snapshot);
    setUndoHistory(rest);
    setSelectedRowKeys(new Set());
    showToast(`실행 취소됨: ${latest.label}`, false);
  };

  const handleCopyAddress = () => {
    navigator.clipboard.writeText(YONGIN_ADDRESS);
    setCopiedAddress(true);
    setTimeout(() => setCopiedAddress(false), 2000);
    showToast('용인사업부 주소가 클립보드에 복사되었습니다.');
  };

  // Persist last active tab ID locally (device preference) so revisit loads that sheet first
  useEffect(() => {
    if (activeTabId) {
      writeCachedActiveTabId(activeTabId);
    }
  }, [activeTabId]);

  // Promote Stage-2 background loading immediately if user switches to integrated views or starts searching
  useEffect(() => {
    if (
      activeTabId === 'ALL' ||
      activeTabId === FAVORITE_MATERIALS_TAB_ID ||
      searchTerm.trim().length > 0
    ) {
      sharedSubRef.current?.requestAllSheets();
    }
  }, [activeTabId, searchTerm]);

  // Reset pagination to page 1 when switching tabs, searching, sorting, or changing page size
  useEffect(() => {
    setCurrentPage(1);
  }, [activeTabId, searchTerm, sortOrder, pageSize]);

  // Real-time staged subscription to the single shared company ledger (no login required, non-blocking)
  useEffect(() => {
    let isCancelled = false;
    hasVerifiedServerDataRef.current = false;
    setHasVerifiedServerData(false);
    setIsAllSheetsSynced(false);
    setSyncError(null);
    setConnectionDiagnostic(null);
    setSyncStatus(preServerCacheSnapshotRef.current ? 'cached_checking' : 'connecting');

    // Never hide connection timeouts/errors behind an infinite spinner
    const watchdogTimer = window.setTimeout(() => {
      if (isCancelled || hasVerifiedServerDataRef.current) return;
      diagnoseConnectivity('공용 대장 서버 응답 시간 초과 (10초)').then((diag) => {
        if (isCancelled || hasVerifiedServerDataRef.current) return;
        setIsSharedCloudReady(true);
        setIsShowingCachedPreview(Boolean(preServerCacheSnapshotRef.current));
        setConnectionDiagnostic(diag);
        setSyncError(`${diag.summary}: ${diag.detail}`);
        setSyncStatus('error');
      });
    }, 10000);

    const priorityId = initialCachedTab || undefined;
    const sub = subscribeSharedLedger(
      {
        onData: (incoming) => {
          if (isCancelled) return;
          setSharedData(incoming);
          setIsSharedCloudReady(true);
          setIsAllSheetsSynced(incoming.isAllSheetsSynced);
          knownSheetIdsRef.current = new Set(incoming.knownSheetIds);
          knownItemIdsRef.current = new Set(incoming.knownItemIds);
          hasWorkspaceDocRef.current = incoming.hasWorkspaceDoc;
          sharedCloudExistsRef.current = incoming.cloudExists;

          if (incoming.cloudExists) {
            // While Stage 2 hasn't finished yet, preserve cached items on non-priority tabs so tab counters don't flash 0
            const cacheRef = preServerCacheSnapshotRef.current;
            const displaySheets: MaterialSheet[] =
              !incoming.isAllSheetsSynced && cacheRef
                ? incoming.sheets.map((sh) => {
                    if (sh.items.length > 0) return sh;
                    const cachedSheet = cacheRef.sheets.find((cs) => cs.id === sh.id);
                    return cachedSheet && cachedSheet.items.length > 0
                      ? { ...sh, items: cachedSheet.items }
                      : sh;
                  })
                : incoming.sheets;

            const remoteSnap: SyncableSnapshot = {
              siteName: incoming.siteName,
              favoritePinnedKeys: incoming.favoritePinnedKeys,
              favoriteMutedAutoKeys: incoming.favoriteMutedAutoKeys,
              sheets: displaySheets,
            };

            const dirtyBase = hasVerifiedServerDataRef.current
              ? lastSyncedSnapshotRef.current
              : preServerCacheSnapshotRef.current;

            const mergedSnap = dirtyBase
              ? mergeIncomingWithDirtyLocal(
                  dirtyBase,
                  latestLocalSnapshotRef.current || remoteSnap,
                  remoteSnap
                )
              : remoteSnap;

            setSheets(mergedSnap.sheets);
            setSiteName(mergedSnap.siteName);
            setFavoritePrefs({
              pinnedKeys: mergedSnap.favoritePinnedKeys,
              mutedAutoKeys: mergedSnap.favoriteMutedAutoKeys,
            });

            if (!hasAutoSelectedInitialTabRef.current && incoming.sheets.length > 0) {
              hasAutoSelectedInitialTabRef.current = true;
              const preferred =
                initialCachedTab &&
                (initialCachedTab === 'ALL' ||
                  initialCachedTab === FAVORITE_MATERIALS_TAB_ID ||
                  incoming.sheets.some((s) => s.id === initialCachedTab))
                  ? initialCachedTab
                  : incoming.sheets[0].id;
              setActiveTabId(preferred);
              setTargetSheetIdForAllView(incoming.sheets[0].id);
            }

            if (incoming.isFromServer && incoming.isAllSheetsSynced) {
              window.clearTimeout(watchdogTimer);
              hasVerifiedServerDataRef.current = true;
              setHasVerifiedServerData(true);
              setIsShowingCachedPreview(false);
              setConnectionDiagnostic(null);
              lastSyncedSnapshotRef.current = {
                siteName: incoming.siteName,
                favoritePinnedKeys: incoming.favoritePinnedKeys,
                favoriteMutedAutoKeys: incoming.favoriteMutedAutoKeys,
                sheets: incoming.sheets,
              };
              preServerCacheSnapshotRef.current = null;
              writeSharedLedgerCache({
                siteName: incoming.siteName,
                favoritePinnedKeys: incoming.favoritePinnedKeys,
                favoriteMutedAutoKeys: incoming.favoriteMutedAutoKeys,
                sheets: incoming.sheets,
              });

              if (!isSyncInFlightRef.current) {
                setSyncStatus((prev) => (prev === 'conflict' ? 'conflict' : 'saved'));
                setSyncError(null);
                setLastSyncedAt(new Date());
              }
            } else {
              // Still confirming latest server data or finishing Stage 2 sheets
              setSyncStatus((prev) =>
                prev === 'saving' || prev === 'conflict' ? prev : 'cached_checking'
              );
            }
          } else {
            if (incoming.isFromServer) {
              window.clearTimeout(watchdogTimer);
              hasVerifiedServerDataRef.current = true;
              setHasVerifiedServerData(true);
              setIsShowingCachedPreview(false);
              lastSyncedSnapshotRef.current = null;
              setSheets([]);
              setSlips([]);
              setSyncStatus('saved');
              setSyncError(null);
              setConnectionDiagnostic(null);
              setLastSyncedAt(new Date());
            }
          }
        },
        onError: (err) => {
          if (isCancelled) return;
          window.clearTimeout(watchdogTimer);
          console.error('Shared ledger real-time sync error:', err);
          setIsSharedCloudReady(true);
          setSyncStatus('error');
          setSyncError(err.message || '공용 대장 실시간 연결 중 오류가 발생했습니다.');
          diagnoseConnectivity(err.message).then((diag) => {
            if (!isCancelled) {
              setConnectionDiagnostic(diag);
            }
          });
        },
      },
      { prioritySheetId: priorityId, deferBackgroundMs: 80 }
    );

    sharedSubRef.current = sub;

    return () => {
      isCancelled = true;
      window.clearTimeout(watchdogTimer);
      sub.unsubscribe();
      if (sharedSubRef.current === sub) {
        sharedSubRef.current = null;
      }
    };
  }, [listenerRetryTrigger]);

  // Lazy subscription for full slips list (attached ONLY when SlipArchive, AttachSlip, ReceiptScan, or CloudSync opens)
  useEffect(() => {
    const shouldAttach =
      showSlipArchiveModal ||
      Boolean(attachingTarget) ||
      showCloudSyncModal ||
      showReceiptScanModal ||
      slipsSubscribedRef.current;

    if (!shouldAttach) return;
    slipsSubscribedRef.current = true;

    const unsubSlips = subscribeSharedSlips({
      onData: (cloudSlips) => {
        knownSlipIdsRef.current = new Set(cloudSlips.map((s) => s.id));
        setHasFullSlipsLoaded(true);
        setSlips(cloudSlips);
      },
      onError: (err) => {
        console.error('Shared slips subscription error:', err);
      },
    });

    return () => {
      unsubSlips();
    };
  }, [showSlipArchiveModal, attachingTarget, showCloudSyncModal, showReceiptScanModal]);

  // Separated migration history & legacy recovery check (loaded ONLY when CloudSyncModal opens or ledger is uninitialized)
  useEffect(() => {
    const needsMigrationInspection =
      showCloudSyncModal ||
      (isSharedCloudReady && hasVerifiedServerData && !sharedData?.cloudExists);
    if (!needsMigrationInspection) return;

    let isMounted = true;

    const unsubMigrations = subscribeSharedMigrations({
      onData: (migs) => {
        if (isMounted) setMigrationsList(migs);
      },
      onError: (err) => {
        console.error('Failed to subscribe migrations:', err);
      },
    });

    getAllSlipsFromDB()
      .then((loaded) => {
        if (isMounted && Array.isArray(loaded) && loaded.length > 0) {
          setLocalBackupSlips(loaded);
        }
      })
      .catch((e) => console.error('Failed to inspect legacy IndexedDB slips:', e));

    const unsubAuth = onAuthStateChanged(auth, async (legacyUser) => {
      if (!legacyUser) {
        if (isMounted) setLegacyAccountData(null);
        return;
      }
      try {
        const fetched = await fetchLegacyAccountCloudData(legacyUser.uid);
        if (isMounted && fetched.exists) {
          setLegacyAccountData({
            uid: legacyUser.uid,
            email: legacyUser.email || '',
            siteName: fetched.siteName,
            sheets: fetched.sheets,
            slips: fetched.slips,
            favoritePinnedKeys: fetched.favoritePinnedKeys,
            favoriteMutedAutoKeys: fetched.favoriteMutedAutoKeys,
          });
        } else if (isMounted) {
          setLegacyAccountData(null);
        }
      } catch {
        if (isMounted) setLegacyAccountData(null);
      }
    });

    return () => {
      isMounted = false;
      unsubMigrations();
      unsubAuth();
    };
  }, [showCloudSyncModal, isSharedCloudReady, hasVerifiedServerData, sharedData?.cloudExists]);

  // Debounced per-item diff auto-sync to shared Cloud Firestore (STRICTLY blocked until real server data is verified so cache never overwrites server)
  useEffect(() => {
    if (
      !isSharedCloudReady ||
      !hasVerifiedServerData ||
      !hasVerifiedServerDataRef.current ||
      !sharedCloudExistsRef.current ||
      !lastSyncedSnapshotRef.current
    ) {
      return;
    }

    const nextSnap: SyncableSnapshot = {
      siteName,
      favoritePinnedKeys: favoritePrefs.pinnedKeys,
      favoriteMutedAutoKeys: favoritePrefs.mutedAutoKeys,
      sheets,
    };

    if (areSnapshotsEquivalent(nextSnap, lastSyncedSnapshotRef.current)) {
      return;
    }

    setSyncStatus('saving');
    setSyncError(null);

    if (cloudSyncTimerRef.current) {
      window.clearTimeout(cloudSyncTimerRef.current);
    }

    cloudSyncTimerRef.current = window.setTimeout(async () => {
      if (isSyncInFlightRef.current) {
        needsResyncAfterFlightRef.current = true;
        return;
      }
      const prevSnap = lastSyncedSnapshotRef.current;
      if (!prevSnap) return;

      isSyncInFlightRef.current = true;
      needsResyncAfterFlightRef.current = false;

      try {
        const res = await syncSharedChangesToFirestore({
          prev: prevSnap,
          next: nextSnap,
          knownSheetIds: knownSheetIdsRef.current,
          knownItemIds: knownItemIdsRef.current,
          hasWorkspaceDoc: hasWorkspaceDocRef.current,
        });
        knownSheetIdsRef.current = res.knownSheetIds;
        knownItemIdsRef.current = res.knownItemIds;
        hasWorkspaceDocRef.current = res.hasWorkspaceDoc;

        if (res.conflicts.length > 0) {
          setSyncConflicts((prev) => [...res.conflicts, ...prev].slice(0, 10));
          setSyncStatus('conflict');
          showToast(
            `동시 수정 충돌 감지: '${res.conflicts[0].itemName}' 등 ${res.conflicts.length}건이 먼저 저장된 최신 데이터로 유지되었습니다.`
          );
        } else {
          const revEntries = Object.entries(res.updatedRevisions || {});
          let finalSyncedSnap: SyncableSnapshot = nextSnap;
          if (revEntries.length > 0) {
            const revMap = new Map(revEntries);
            const updatedSnap: SyncableSnapshot = {
              ...nextSnap,
              sheets: nextSnap.sheets.map((sh) => ({
                ...sh,
                items: sh.items.map((it) => {
                  const safeId = sanitizeFirestoreId(it.id, 'mat');
                  const nextRev = revMap.get(safeId);
                  return nextRev !== undefined ? { ...it, revision: nextRev } : it;
                }),
              })),
            };
            finalSyncedSnap = updatedSnap;
            lastSyncedSnapshotRef.current = updatedSnap;
            setSheets((currSheets) =>
              currSheets.map((sh) => ({
                ...sh,
                items: sh.items.map((it) => {
                  const safeId = sanitizeFirestoreId(it.id, 'mat');
                  const nextRev = revMap.get(safeId);
                  return nextRev !== undefined && (it.revision ?? 1) < nextRev
                    ? { ...it, revision: nextRev }
                    : it;
                }),
              }))
            );
          } else {
            lastSyncedSnapshotRef.current = nextSnap;
          }
          writeSharedLedgerCache(finalSyncedSnap);
          setSyncStatus('saved');
          setSyncError(null);
          setConnectionDiagnostic(null);
          setLastSyncedAt(new Date());
        }
      } catch (err: any) {
        console.error('Shared ledger diff sync failed:', err);
        setSyncStatus('error');
        setSyncError(err?.message || '공용 대장 저장에 실패했습니다.');
        diagnoseConnectivity(err?.message).then((diag) => setConnectionDiagnostic(diag));
      } finally {
        isSyncInFlightRef.current = false;
        if (needsResyncAfterFlightRef.current) {
          needsResyncAfterFlightRef.current = false;
          setSyncRetryTrigger((t) => t + 1);
        }
      }
    }, 320);

    return () => {
      if (cloudSyncTimerRef.current) {
        window.clearTimeout(cloudSyncTimerRef.current);
      }
    };
  }, [sheets, siteName, favoritePrefs, isSharedCloudReady, hasVerifiedServerData, syncRetryTrigger]);

  // Helper to upload a receipt slip image to shared Firebase Storage + Firestore
  const persistSlipToSharedCloud = async (slip: StoredReceiptSlip, rawFile?: File) => {
    setSyncStatus('saving');
    setSyncError(null);
    try {
      const safeId = sanitizeFirestoreId(slip.id, 'slip');
      const isExisting = knownSlipIdsRef.current.has(safeId);
      const uploadedSlip = await saveSharedSlipToCloud(
        { ...slip, id: safeId },
        {
          isExisting,
          hasWorkspaceDoc: hasWorkspaceDocRef.current,
          rawFile,
        }
      );
      hasWorkspaceDocRef.current = true;
      sharedCloudExistsRef.current = true;
      knownSlipIdsRef.current.add(uploadedSlip.id);
      setSlips((prev) => [
        uploadedSlip,
        ...prev.filter((s) => s.id !== slip.id && s.id !== uploadedSlip.id),
      ]);
      setSyncStatus('saved');
      setLastSyncedAt(new Date());
    } catch (err: any) {
      console.error('Shared slip Firebase Storage upload failed:', err);
      setSyncStatus('error');
      setSyncError(err?.message || '전표 이미지 Storage 업로드 중 오류가 발생했습니다.');
      showToast('전표 이미지 공용 저장소에 업로드하지 못했습니다. 상단 동기화 상태를 확인해주세요.');
    }
  };

  // Read legacy LocalStorage + IndexedDB slips strictly read-only for admin backup/migration
  const readLegacyLocalPayload = () => {
    let localSheetsList: MaterialSheet[] = [];
    let localSite = '신규 발주 자재 반입 관리';
    let localFavs: FavoritePrefsState = { pinnedKeys: [], mutedAutoKeys: [] };
    let hasLegacyKeys = false;

    try {
      const rawSheets = localStorage.getItem(SHEETS_STORAGE_KEY);
      if (rawSheets) {
        const parsed = JSON.parse(rawSheets);
        if (Array.isArray(parsed) && parsed.length > 0) {
          localSheetsList = normalizeLoadedSheets(parsed);
          hasLegacyKeys = true;
        }
      } else {
        const rawV3 = localStorage.getItem(LEGACY_V3_STORAGE_KEY);
        if (rawV3) {
          const parsedV3 = JSON.parse(rawV3);
          if (Array.isArray(parsedV3) && parsedV3.length > 0) {
            localSheetsList = createDefaultSheets(parsedV3);
            hasLegacyKeys = true;
          }
        }
      }
    } catch {
      localSheetsList = [];
    }

    try {
      const sName = localStorage.getItem(SITE_NAME_KEY) || localStorage.getItem(LEGACY_SITE_NAME_KEY);
      if (sName) localSite = sName;
    } catch {
      // ignore
    }

    try {
      const rawFavs = localStorage.getItem(FAVORITE_PREFS_KEY);
      if (rawFavs) {
        const parsedFavs = JSON.parse(rawFavs);
        localFavs = {
          pinnedKeys: Array.isArray(parsedFavs?.pinnedKeys) ? parsedFavs.pinnedKeys : [],
          mutedAutoKeys: Array.isArray(parsedFavs?.mutedAutoKeys) ? parsedFavs.mutedAutoKeys : [],
        };
      }
    } catch {
      // ignore
    }

    if (localBackupSlips.length > 0) {
      hasLegacyKeys = true;
    }

    return {
      siteName: localSite,
      favoritePinnedKeys: localFavs.pinnedKeys,
      favoriteMutedAutoKeys: localFavs.mutedAutoKeys,
      sheets: localSheetsList,
      slips: localBackupSlips,
      hasLegacyLocalKeys: hasLegacyKeys,
    };
  };

  const handleRetrySharedSync = async () => {
    setSyncConflicts([]);
    setSyncError(null);
    setConnectionDiagnostic(null);
    if (!hasVerifiedServerDataRef.current) {
      setListenerRetryTrigger((t) => t + 1);
      const check = await testConnection();
      if (!check.ok) {
        const diag = await diagnoseConnectivity(check.error);
        setConnectionDiagnostic(diag);
        setSyncStatus('error');
        setSyncError(`${diag.summary}: ${diag.detail}`);
      }
    } else {
      setSyncRetryTrigger((t) => t + 1);
    }
  };

  const handleDownloadCurrentBackup = () => {
    sharedSubRef.current?.requestAllSheets();
    const legacy = readLegacyLocalPayload();
    const useShared = Boolean(sharedData?.cloudExists && sheets.length > 0);
    downloadLocalBackupJsonFile({
      source: useShared ? 'shared_ledger_snapshot' : 'local_storage_snapshot',
      siteName: useShared ? siteName : legacy.siteName,
      favoritePinnedKeys: useShared ? favoritePrefs.pinnedKeys : legacy.favoritePinnedKeys,
      favoriteMutedAutoKeys: useShared
        ? favoritePrefs.mutedAutoKeys
        : legacy.favoriteMutedAutoKeys,
      sheets: useShared ? sheets : legacy.sheets,
      slips: useShared ? slips : legacy.slips,
    });
    showToast('전체 대장 데이터 백업 파일(.json)이 다운로드되었습니다.');
  };

  const handleMigrateLocalStorage = async (downloadBackupFirst: boolean) => {
    const local = readLegacyLocalPayload();
    if (!local.hasLegacyLocalKeys) {
      throw new Error('이 브라우저에 이전할 기존 LocalStorage 자료가 없습니다.');
    }
    if (downloadBackupFirst) {
      downloadLocalBackupJsonFile({
        source: 'pre_migration_local_storage',
        siteName: local.siteName,
        favoritePinnedKeys: local.favoritePinnedKeys,
        favoriteMutedAutoKeys: local.favoriteMutedAutoKeys,
        sheets: local.sheets,
        slips: local.slips,
      });
    }
    setSyncStatus('saving');
    setSyncError(null);
    const res = await migrateToSharedLedger({
      migrationId: 'mig_local_primary_v1',
      sourceType: 'local_storage',
      sourceLabel: '기존 브라우저 LocalStorage 자료',
      sourceData: local,
      currentShared: sharedData,
    });
    setMigrationCheckTick((n) => n + 1);
    setSyncStatus('saved');
    setLastSyncedAt(new Date());
    showToast(
      `공용 대장 이전 완료! (시트 ${res.migratedSheetsCount}개 · 신규 자재 ${res.migratedItemsCount}건 · 전표 ${res.migratedSlipsCount}장)`
    );
    return res;
  };

  const handleMigrateLegacyAccount = async (downloadBackupFirst: boolean) => {
    if (!legacyAccountData) {
      throw new Error('감지된 기존 계정 클라우드 자료가 없습니다.');
    }
    if (downloadBackupFirst) {
      downloadLocalBackupJsonFile({
        source: `pre_migration_legacy_uid_${legacyAccountData.uid}`,
        siteName: legacyAccountData.siteName,
        favoritePinnedKeys: legacyAccountData.favoritePinnedKeys,
        favoriteMutedAutoKeys: legacyAccountData.favoriteMutedAutoKeys,
        sheets: legacyAccountData.sheets,
        slips: legacyAccountData.slips,
      });
    }
    setSyncStatus('saving');
    setSyncError(null);
    const res = await migrateToSharedLedger({
      migrationId: `mig_legacy_uid_${legacyAccountData.uid.slice(0, 60)}`,
      sourceType: 'legacy_uid',
      sourceLabel: `기존 계정(${legacyAccountData.email || legacyAccountData.uid}) 클라우드 자료`,
      sourceData: legacyAccountData,
      currentShared: sharedData,
    });
    setMigrationCheckTick((n) => n + 1);
    setSyncStatus('saved');
    setLastSyncedAt(new Date());
    showToast(
      `계정 자료 공용 대장 이전 완료! (시트 ${res.migratedSheetsCount}개 · 신규 자재 ${res.migratedItemsCount}건 · 전표 ${res.migratedSlipsCount}장)`
    );
    return res;
  };

  const handleMigrateJsonBackupFile = async (file: File) => {
    const text = await file.text();
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('올바른 .json 백업 파일 형식이 아닙니다.');
    }
    if (!parsed || !Array.isArray(parsed.sheets)) {
      throw new Error('백업 파일에 시트(sheets) 데이터가 포함되어 있지 않습니다.');
    }
    const fingerprint = sanitizeFirestoreId(
      `${parsed.backedUpAt || file.name}_${parsed.sheets.length}`,
      'json'
    ).slice(0, 72);
    const sourceData = {
      siteName: String(parsed.siteName || '신규 발주 자재 반입 관리'),
      favoritePinnedKeys: Array.isArray(parsed.favoritePinnedKeys)
        ? parsed.favoritePinnedKeys
        : [],
      favoriteMutedAutoKeys: Array.isArray(parsed.favoriteMutedAutoKeys)
        ? parsed.favoriteMutedAutoKeys
        : [],
      sheets: normalizeLoadedSheets(parsed.sheets),
      slips: Array.isArray(parsed.slips) ? parsed.slips : [],
    };
    setSyncStatus('saving');
    setSyncError(null);
    const res = await migrateToSharedLedger({
      migrationId: `mig_json_${fingerprint}`,
      sourceType: 'json_backup',
      sourceLabel: `백업 파일 (${file.name})`,
      sourceData,
      currentShared: sharedData,
    });
    setMigrationCheckTick((n) => n + 1);
    setSyncStatus('saved');
    setLastSyncedAt(new Date());
    showToast(
      `백업 파일 공용 이전 완료! (시트 ${res.migratedSheetsCount}개 · 신규 자재 ${res.migratedItemsCount}건 · 전표 ${res.migratedSlipsCount}장)`
    );
    return res;
  };

  const handleInitializeFreshSharedLedger = async () => {
    setSyncStatus('saving');
    setSyncError(null);
    await migrateToSharedLedger({
      migrationId: 'mig_fresh_seed_v1',
      sourceType: 'fresh_seed',
      sourceLabel: '기본 양식 공용 대장 시작',
      sourceData: {
        siteName: '신규 발주 자재 반입 관리',
        favoritePinnedKeys: [],
        favoriteMutedAutoKeys: [],
        sheets: createDefaultSheets([]),
        slips: DEFAULT_SEED_SLIPS,
      },
      currentShared: sharedData,
    });
    setMigrationCheckTick((n) => n + 1);
    setSyncStatus('saved');
    setLastSyncedAt(new Date());
    showToast('기본 양식으로 공용 클라우드 대장이 생성되었습니다!');
  };

  const handleClearLegacyLocalAfterMigration = async () => {
    if (migrationsList.length === 0 && (!sharedData || sharedData.migrations.length === 0)) {
      showToast('공용 대장 이전 완료가 확인된 후에만 기존 로컬 임시저장을 정리할 수 있습니다.');
      return;
    }
    try {
      localStorage.removeItem(SHEETS_STORAGE_KEY);
      localStorage.removeItem(LEGACY_V3_STORAGE_KEY);
      localStorage.removeItem(SITE_NAME_KEY);
      localStorage.removeItem(LEGACY_SITE_NAME_KEY);
      localStorage.removeItem(FAVORITE_PREFS_KEY);
      localStorage.removeItem('field_backup_slips_v1');
      localStorage.removeItem('field_backup_slips_cleared');
      await clearAllSlipsFromDB();
      setLocalBackupSlips([]);
      setMigrationCheckTick((n) => n + 1);
      showToast('기존 로컬 임시저장 데이터가 정리되었습니다. (이전 직전 백업 스냅샷은 유지됩니다)');
    } catch (err) {
      console.error('Failed to clear legacy local storage:', err);
      showToast('로컬 임시저장 정리 중 오류가 발생했습니다.');
    }
  };

  const integratedSheets = useMemo(
    () => sheets.filter((s) => !isOfficeSuppliesSheet(s)),
    [sheets]
  );

  const isIntegratedView =
    activeTabId === 'ALL' || activeTabId === FAVORITE_MATERIALS_TAB_ID;

  // All entries across all sheets (for cross-sheet favorites & lookup)
  const allSheetsEntries = useMemo<MaterialDeliveryEntry[]>(
    () =>
      sheets.flatMap((sheet) =>
        sheet.items.map((item) => ({
          item,
          sheetId: sheet.id,
          sheetName: sheet.name,
        }))
      ),
    [sheets]
  );

  const integratedEntries = useMemo<MaterialDeliveryEntry[]>(
    () =>
      integratedSheets.flatMap((sheet) =>
        sheet.items.map((item) => ({
          item,
          sheetId: sheet.id,
          sheetName: sheet.name,
        }))
      ),
    [integratedSheets]
  );

  const allIntegratedGroups = useMemo(
    () => aggregateMaterialItems(integratedEntries, 'name_and_spec'),
    [integratedEntries]
  );

  const allIntegratedGroupLookup = useMemo(() => {
    const map = new Map<string, AggregatedItemGroup>();
    allIntegratedGroups.forEach((g) => map.set(g.key, g));
    return map;
  }, [allIntegratedGroups]);

  // Unified set of favorited (name || spec) keys: manual ★ pins + active 2+ auto-favorites
  const favoriteKeySet = useMemo(() => {
    const set = new Set<string>(favoritePrefs.pinnedKeys);
    allIntegratedGroups.forEach((g) => {
      if (g.entryCount >= 2 && !favoritePrefs.mutedAutoKeys.includes(g.key)) {
        set.add(g.key);
      }
    });
    return set;
  }, [favoritePrefs, allIntegratedGroups]);

  // All entries routed into 통합보기 [자재]
  const favoriteMaterialEntries = useMemo<MaterialDeliveryEntry[]>(() => {
    return allSheetsEntries.filter(({ item, sheetId, sheetName }) => {
      const key = makeFavoriteLookupKey(item.name, item.spec);
      if (favoritePrefs.pinnedKeys.includes(key)) return true;
      const isOffice =
        sheetId === OFFICE_SUPPLIES_SHEET_ID || sheetName.trim() === '사무용품';
      if (isOffice) return false;
      return favoriteKeySet.has(key);
    });
  }, [allSheetsEntries, favoritePrefs.pinnedKeys, favoriteKeySet]);

  const favoriteMaterialGroups = useMemo(
    () => aggregateMaterialItems(favoriteMaterialEntries, 'name_and_spec'),
    [favoriteMaterialEntries]
  );

  useEffect(() => {
    if (
      activeTabId !== 'ALL' &&
      activeTabId !== FAVORITE_MATERIALS_TAB_ID &&
      !sheets.some((s) => s.id === activeTabId)
    ) {
      setActiveTabId(sheets[0]?.id || 'ALL');
    }
    const targetPool = integratedSheets.length > 0 ? integratedSheets : sheets;
    if (!targetPool.some((s) => s.id === targetSheetIdForAllView) && targetPool[0]) {
      setTargetSheetIdForAllView(targetPool[0].id);
    }
  }, [sheets, integratedSheets, activeTabId, targetSheetIdForAllView]);

  const activeSheet = useMemo(
    () =>
      isIntegratedView ? null : sheets.find((s) => s.id === activeTabId) || null,
    [sheets, activeTabId, isIntegratedView]
  );

  const viewItemsWithSheet = useMemo(() => {
    if (activeTabId === 'ALL') {
      return integratedEntries;
    }
    if (activeTabId === FAVORITE_MATERIALS_TAB_ID) {
      return favoriteMaterialEntries;
    }
    const target = sheets.find((s) => s.id === activeTabId);
    if (!target) return [];
    return target.items.map((item) => ({
      item,
      sheetId: target.id,
      sheetName: target.name,
    }));
  }, [sheets, integratedEntries, favoriteMaterialEntries, activeTabId]);

  const liveFormTotal = useMemo(() => {
    const q = parseFloat(quantity);
    const pq = parseFloat(packQty);
    if (!isNaN(q) && q > 0 && !isNaN(pq) && pq > 0) {
      return Math.round(q * pq * 1000) / 1000;
    }
    return null;
  }, [quantity, packQty]);

  const metrics = useMemo(
    () => ({
      total: viewItemsWithSheet.length,
    }),
    [viewItemsWithSheet]
  );

  // Item-by-Item Aggregated Summary (품목별 반입수량 · 토탈 수량 합계)
  const itemSummaryGroups = useMemo(
    () => aggregateMaterialItems(viewItemsWithSheet, 'name_and_spec'),
    [viewItemsWithSheet]
  );

  const repeatedItemGroupsCount = useMemo(
    () => itemSummaryGroups.filter((g) => g.entryCount > 1).length,
    [itemSummaryGroups]
  );

  const nonZeroSummaryCount = useMemo(
    () => itemSummaryGroups.filter((g) => g.totalSummaryText !== '-').length,
    [itemSummaryGroups]
  );

  const getGroupTotalMagnitude = (g: AggregatedItemGroup): number => {
    const vals = Object.values(g.totalUnitSums);
    if (vals.length === 0) return -1;
    return vals.reduce((acc, v) => acc + v, 0);
  };

  const visibleItemSummaryGroups = useMemo(() => {
    let list =
      nonZeroSummaryCount > 0
        ? itemSummaryGroups.filter((g) => g.totalSummaryText !== '-')
        : itemSummaryGroups;

    const q = summarySearch.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (g) =>
          g.name.toLowerCase().includes(q) ||
          g.suppliers.some((s) => s.toLowerCase().includes(q)) ||
          (g.spec !== '-' && g.spec.toLowerCase().includes(q))
      );
    }

    if (summarySortMode === 'qty_desc') {
      return [...list].sort((a, b) => {
        const diff = getGroupTotalMagnitude(b) - getGroupTotalMagnitude(a);
        return diff !== 0 ? diff : a.name.localeCompare(b.name, 'ko');
      });
    }

    if (summarySortMode === 'name') {
      return [...list].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    }

    return list;
  }, [itemSummaryGroups, nonZeroSummaryCount, summarySearch, summarySortMode]);

  // Lookup map so repeated rows in the ledger can also show their cumulative item total at a glance
  const itemGroupLookup = useMemo(() => {
    const map = new Map<string, (typeof itemSummaryGroups)[number]>();
    itemSummaryGroups.forEach((g) => map.set(g.key, g));
    return map;
  }, [itemSummaryGroups]);

  // Distinct supplier list across all sheets for instant autocomplete
  const existingSuppliers = useMemo(() => {
    const set = new Set<string>();
    sheets.forEach((s) =>
      s.items.forEach((it) => {
        const sup = (it.supplier || '').trim();
        if (
          sup &&
          sup !== '-' &&
          sup !== '용인공장 직발주 납품처' &&
          sup !== '현장 납품처'
        ) {
          set.add(sup);
        }
      })
    );
    return Array.from(set);
  }, [sheets]);

  // Automatic Favorites (반입 2회 이상 자동 등록) + Manual ★ Pinned Favorites
  const favoriteSourceGroups = useMemo(() => {
    const sourceEntries =
      activeTabId === FAVORITE_MATERIALS_TAB_ID
        ? favoriteMaterialEntries
        : activeTabId === 'ALL'
        ? integratedEntries
        : favoriteScope === 'all'
        ? allSheetsEntries
        : viewItemsWithSheet;
    return aggregateMaterialItems(sourceEntries, 'name_and_spec');
  }, [
    activeTabId,
    favoriteScope,
    allSheetsEntries,
    integratedEntries,
    favoriteMaterialEntries,
    viewItemsWithSheet,
  ]);

  const allCrossSheetFavoriteCount = useMemo(() => {
    return favoriteMaterialGroups.length;
  }, [favoriteMaterialGroups]);

  const favoriteItems = useMemo(() => {
    return favoriteSourceGroups
      .filter((g) => {
        const isPinned = favoritePrefs.pinnedKeys.includes(g.key);
        const isAuto = g.entryCount >= 2 && !favoritePrefs.mutedAutoKeys.includes(g.key);
        return isPinned || isAuto;
      })
      .sort((a, b) => {
        const aPinned = favoritePrefs.pinnedKeys.includes(a.key) ? 1 : 0;
        const bPinned = favoritePrefs.pinnedKeys.includes(b.key) ? 1 : 0;
        if (bPinned !== aPinned) return bPinned - aPinned;
        if (b.entryCount !== a.entryCount) return b.entryCount - a.entryCount;
        return b.latestCreatedAt - a.latestCreatedAt;
      });
  }, [favoriteSourceGroups, favoritePrefs]);

  const isItemFavorited = (itemName: string, itemSpec?: string): boolean => {
    const key = makeFavoriteLookupKey(itemName, itemSpec);
    if (favoriteKeySet.has(key)) return true;
    const grp = itemGroupLookup.get(key) || allIntegratedGroupLookup.get(key);
    if (grp && grp.entryCount >= 2 && !favoritePrefs.mutedAutoKeys.includes(key)) {
      return true;
    }
    return false;
  };

  const toggleFavoriteByKey = (
    key: string,
    labelName: string,
    entryCount: number
  ) => {
    const currentlyFavorited =
      favoriteKeySet.has(key) ||
      (entryCount >= 2 && !favoritePrefs.mutedAutoKeys.includes(key));

    if (currentlyFavorited) {
      setFavoritePrefs((prev) => ({
        pinnedKeys: prev.pinnedKeys.filter((k) => k !== key),
        mutedAutoKeys:
          entryCount >= 2 && !prev.mutedAutoKeys.includes(key)
            ? [...prev.mutedAutoKeys, key]
            : prev.mutedAutoKeys,
      }));
      showToast(`'${labelName}' 품목을 즐겨찾기 및 통합보기 [자재]에서 제외했습니다.`);
    } else {
      setFavoritePrefs((prev) => ({
        pinnedKeys: prev.pinnedKeys.includes(key)
          ? prev.pinnedKeys
          : [...prev.pinnedKeys, key],
        mutedAutoKeys: prev.mutedAutoKeys.filter((k) => k !== key),
      }));
      showToast(`'${labelName}' 품목이 즐겨찾기 [통합보기 [자재]]로 추가되었습니다.`);
    }
  };

  const applyFavoriteGroupToForm = (group: AggregatedItemGroup) => {
    setName(group.name);
    setSpec(group.spec === '-' ? '' : group.spec);
    if (group.latestSupplier) {
      setSupplier(group.latestSupplier);
    }
    if (group.latestUnit && group.latestUnit !== '-') {
      setUnit(group.latestUnit);
    }
    setPackQty(group.latestPackQty ? String(group.latestPackQty) : '');
    setSubUnit(group.latestSubUnit || 'EA');
    setIsFormCollapsed(false);
    setTimeout(() => {
      qtyInputRef.current?.focus();
    }, 60);
  };

  // Quick templates of existing items in active sheet (for datalist autocomplete)
  const quickRepeatTemplates = useMemo(() => {
    const seen = new Map<string, MaterialItem>();
    const source = activeSheet ? activeSheet.items : sheets.flatMap((s) => s.items);
    // Iterate latest first so most recent supplier/unit/packQty wins
    [...source].reverse().forEach((it) => {
      const k = it.name.trim().toLowerCase();
      if (k && !seen.has(k)) {
        seen.set(k, it);
      }
    });
    return Array.from(seen.values());
  }, [activeSheet, sheets]);

  const matchedExistingGroupForForm = useMemo(() => {
    const clean = name.trim().replace(/\s+/g, ' ').toLowerCase();
    if (!clean) return null;
    const allGroupsByName = aggregateMaterialItems(viewItemsWithSheet, 'name_only');
    return allGroupsByName.find((g) => g.key === clean) || null;
  }, [name, viewItemsWithSheet]);

  const compareItemsForSort = (
    a: MaterialItem,
    b: MaterialItem,
    mode: 'created' | 'date_asc' | 'newest' | 'name' | 'quantity'
  ): number => {
    if (mode === 'date_asc') {
      const cmp = (a.date || '').localeCompare(b.date || '');
      return cmp !== 0 ? cmp : 0;
    }
    if (mode === 'newest') return (b.createdAt ?? 0) - (a.createdAt ?? 0);
    if (mode === 'name') return a.name.localeCompare(b.name, 'ko');
    if (mode === 'quantity') {
      const aTotal = getTotalConvertedQty(a) ?? a.quantity;
      const bTotal = getTotalConvertedQty(b) ?? b.quantity;
      return bTotal - aTotal;
    }
    return 0; // 'created' = exact array order in sheet.items (반입 순서)
  };

  const filteredEntries = useMemo(() => {
    const q = searchTerm.toLowerCase().trim();
    const result = viewItemsWithSheet.filter(({ item, sheetName }) => {
      return (
        !q ||
        item.name.toLowerCase().includes(q) ||
        (item.supplier || '').toLowerCase().includes(q) ||
        item.spec.toLowerCase().includes(q) ||
        item.unit.toLowerCase().includes(q) ||
        item.remarks.toLowerCase().includes(q) ||
        sheetName.toLowerCase().includes(q)
      );
    });

    if (sortOrder === 'created') {
      return result;
    }

    return [...result].sort((a, b) => compareItemsForSort(a.item, b.item, sortOrder));
  }, [viewItemsWithSheet, searchTerm, sortOrder]);

  const totalPages = Math.max(1, Math.ceil(filteredEntries.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const paginatedEntries = useMemo(() => {
    if (pageSize >= filteredEntries.length) return filteredEntries;
    const startIdx = (safeCurrentPage - 1) * pageSize;
    return filteredEntries.slice(startIdx, startIdx + pageSize);
  }, [filteredEntries, safeCurrentPage, pageSize]);

  // Precomputed O(1) lookup tables eliminating O(N^2) scans during table/card row rendering
  const entryLookupMeta = useMemo(() => {
    const sheetMap = new Map<
      string,
      { itemCount: number; itemIndexMap: Map<string, number> }
    >();
    sheets.forEach((sh) => {
      const idxMap = new Map<string, number>();
      sh.items.forEach((it, idx) => idxMap.set(it.id, idx));
      sheetMap.set(sh.id, { itemCount: sh.items.length, itemIndexMap: idxMap });
    });

    const countBySheet = new Map<string, number>();
    filteredEntries.forEach((e) => {
      countBySheet.set(e.sheetId, (countBySheet.get(e.sheetId) || 0) + 1);
    });

    const runningIdxBySheet = new Map<string, number>();
    const visPosMap = new Map<string, { visIdx: number; visCount: number }>();
    filteredEntries.forEach((e) => {
      const idx = runningIdxBySheet.get(e.sheetId) || 0;
      runningIdxBySheet.set(e.sheetId, idx + 1);
      visPosMap.set(`${e.sheetId}::${e.item.id}`, {
        visIdx: idx,
        visCount: countBySheet.get(e.sheetId) || 1,
      });
    });

    return { sheetMap, visPosMap };
  }, [sheets, filteredEntries]);

  const formPlaceholders = useMemo(() => {
    const targetId = isIntegratedView ? targetSheetIdForAllView : activeTabId;
    const targetSheet = sheets.find((s) => s.id === targetId);
    const compactName = (targetSheet?.name || '').replace(/\s+/g, '');
    if (
      targetId === 'sheet-cheongju-yongin' ||
      compactName.includes('청주') ||
      compactName.includes('이전')
    ) {
      return {
        name: '예: 40A BASE, 전동 지게차[SBF-25A]',
        spec: '예: 2.5 Ton, SUS304 (없으면 생략)',
        remarks: '예: 5톤 윙바디 1호차 상차',
      };
    }
    if (
      targetId === 'sheet-yongin-direct' ||
      compactName.includes('고안리') ||
      compactName.includes('납품')
    ) {
      return {
        name: '예: STEEL PIPE, 150 우물정자 클램프, 핸드파레트',
        spec: '예: 40A*3.2T*520L, 4.5T*150*47 (없으면 생략)',
        remarks: '예: 3파렛트, 신규 발주분 입고',
      };
    }
    return {
      name: '예: 40A BASE, 조립 부속, 완제품',
      spec: '필요 시만 입력 (생략 시 - 표시)',
      remarks: '특이사항 있을 때만 입력',
    };
  }, [isIntegratedView, activeTabId, targetSheetIdForAllView, sheets]);

  // Add Item Handler (Appends in order 1, 2, 3... matching formal ledger numbering)
  const handleAddItem = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!name.trim()) {
      setFormError('자재 품목명을 입력해주세요.');
      return;
    }

    const qty = parseFloat(quantity);
    if (isNaN(qty) || qty <= 0) {
      setFormError('반입 수량은 0보다 큰 숫자로 입력해주세요.');
      return;
    }

    const destinationSheetId = isIntegratedView ? targetSheetIdForAllView : activeTabId;
    const destSheet = sheets.find((s) => s.id === destinationSheetId);
    if (!destSheet) return;

    const cleanUnit = normalizeUnitLabel(unit || 'EA');
    const cleanSupplier = supplier.trim() === '-' ? '' : supplier.trim();

    // Check previous count before adding so we can notify if it just became an Auto-Favorite!
    const favKey = makeFavoriteLookupKey(name, spec);
    const prevCountInSheet = destSheet.items.filter(
      (i) => makeFavoriteLookupKey(i.name, i.spec) === favKey
    ).length;

    const newItem: MaterialItem = {
      id: `mat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: name.trim(),
      supplier: cleanSupplier,
      spec: spec.trim() || '-',
      unit: cleanUnit,
      quantity: qty,
      isCompleted: false,
      location: '',
      remarks: remarks.trim(),
      date: date || new Date().toISOString().split('T')[0],
      createdAt: Date.now(),
    };

    setSheets((prev) =>
      prev.map((sheet) =>
        sheet.id === destinationSheetId ? { ...sheet, items: [...sheet.items, newItem] } : sheet
      )
    );

    const totalConverted = getTotalConvertedQty(newItem);
    const summaryText =
      totalConverted !== null
        ? `${newItem.quantity} ${newItem.unit} (총 ${totalConverted.toLocaleString()} ${newItem.subUnit})`
        : `${newItem.quantity} ${newItem.unit}`;

    if (prevCountInSheet === 1 && !favoritePrefs.mutedAutoKeys.includes(favKey)) {
      showToast(
        `[${destSheet.name}] '${newItem.name}' (${summaryText}) 등록 완료 · 2회 이상 반입되어 즐겨찾기 [통합보기 [자재]]에 자동 추가되었습니다!`
      );
    } else {
      showToast(`[${destSheet.name}] '${newItem.name}' — ${summaryText} 등록 완료`);
    }

    setName('');
    setSupplier('');
    setSpec('');
    setQuantity('');
    setPackQty('');
    setRemarks('');
    nameInputRef.current?.focus();
  };

  const handleDuplicateToForm = (item: MaterialItem, sheetId: string) => {
    setName(item.name);
    setSupplier(item.supplier || '');
    setSpec(item.spec === '-' ? '' : item.spec);
    setQuantity(String(item.quantity));
    setUnit(item.unit);
    setPackQty(item.packQty ? String(item.packQty) : '');
    setSubUnit(item.subUnit || 'EA');
    setDate(item.date || new Date().toISOString().split('T')[0]);
    setRemarks(item.remarks || '');
    setIsFormCollapsed(false);
    if (isIntegratedView) {
      setTargetSheetIdForAllView(sheetId);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => {
      qtyInputRef.current?.focus();
      qtyInputRef.current?.select();
    }, 150);
    showToast(`'${item.name}' 정보를 입력 폼에 불러왔습니다.`);
  };

  // ================= 반입 순서 변경 핸들러 (드래그 / 화살표 / 번호 직접 입력 / 정렬 확정) =================
  const moveItemRelative = (
    sheetId: string,
    sourceId: string,
    targetId: string,
    position: 'before' | 'after'
  ) => {
    if (sourceId === targetId) return;

    setSheets((prev) =>
      prev.map((sheet) => {
        if (sheet.id !== sheetId) return sheet;
        const baseItems =
          sortOrder === 'created'
            ? [...sheet.items]
            : [...sheet.items].sort((a, b) => compareItemsForSort(a, b, sortOrder));

        const srcIdx = baseItems.findIndex((i) => i.id === sourceId);
        if (srcIdx === -1) return sheet;
        const [movedItem] = baseItems.splice(srcIdx, 1);

        const dstIdx = baseItems.findIndex((i) => i.id === targetId);
        if (dstIdx === -1) return sheet;

        const insertIdx = position === 'before' ? dstIdx : dstIdx + 1;
        baseItems.splice(insertIdx, 0, movedItem);
        return { ...sheet, items: baseItems };
      })
    );

    if (sortOrder !== 'created') {
      setSortOrder('created');
    }
  };

  const moveItemStep = (sheetId: string, itemId: string, direction: 'up' | 'down') => {
    const sameSheetVisible = filteredEntries.filter((e) => e.sheetId === sheetId);
    const visIdx = sameSheetVisible.findIndex((e) => e.item.id === itemId);
    if (visIdx === -1) return;

    const neighborIdx = direction === 'up' ? visIdx - 1 : visIdx + 1;
    if (neighborIdx < 0 || neighborIdx >= sameSheetVisible.length) return;

    const neighbor = sameSheetVisible[neighborIdx];
    moveItemRelative(
      sheetId,
      itemId,
      neighbor.item.id,
      direction === 'up' ? 'before' : 'after'
    );
  };

  const commitDirectOrderChange = (
    sheetId: string,
    itemId: string,
    rawVal: string
  ) => {
    setEditingOrderTarget(null);
    const parsed = parseInt(rawVal.trim(), 10);
    if (isNaN(parsed)) return;

    const targetSheet = sheets.find((s) => s.id === sheetId);
    if (!targetSheet || targetSheet.items.length <= 1) return;

    const baseItems =
      sortOrder === 'created'
        ? [...targetSheet.items]
        : [...targetSheet.items].sort((a, b) => compareItemsForSort(a, b, sortOrder));

    const currentIdx = baseItems.findIndex((i) => i.id === itemId);
    if (currentIdx === -1) return;

    const nextIdx = Math.max(0, Math.min(baseItems.length - 1, parsed - 1));
    if (currentIdx === nextIdx && sortOrder === 'created') return;

    const [moved] = baseItems.splice(currentIdx, 1);
    baseItems.splice(nextIdx, 0, moved);

    setSheets((prev) =>
      prev.map((s) => (s.id === sheetId ? { ...s, items: baseItems } : s))
    );
    if (sortOrder !== 'created') {
      setSortOrder('created');
    }
    showToast(`'${moved.name}'의 반입 순서를 ${nextIdx + 1}번으로 변경했습니다.`);
  };

  const applyCurrentSortAsPermanentOrder = () => {
    if (sortOrder === 'created') return;
    setSheets((prev) =>
      prev.map((sheet) => {
        if (!isIntegratedView && sheet.id !== activeTabId) return sheet;
        return {
          ...sheet,
          items: [...sheet.items].sort((a, b) => compareItemsForSort(a, b, sortOrder)),
        };
      })
    );
    setSortOrder('created');
    showToast('현재 정렬 순서를 기본 반입 순서로 확정했습니다. (인쇄·엑셀 동일 반영)');
  };

  const moveSheetTab = (sheetId: string, direction: 'left' | 'right') => {
    setSheets((prev) => {
      const idx = prev.findIndex((s) => s.id === sheetId);
      if (idx === -1) return prev;
      const targetIdx = direction === 'left' ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= prev.length) return prev;
      const copy = [...prev];
      const [moved] = copy.splice(idx, 1);
      copy.splice(targetIdx, 0, moved);
      return copy;
    });
  };

  // ================= 즉시 삭제(1클릭) / 선택 일괄 작업 / 인라인 셀 편집 핸들러 =================
  const makeRowKey = (sheetId: string, itemId: string) => `${sheetId}::${itemId}`;

  const handleDeleteItem = (sheetId: string, itemId: string, itemName: string) => {
    pushUndoSnapshot(`'${itemName}' 삭제`, sheets);
    setSheets((prev) =>
      prev.map((sheet) =>
        sheet.id === sheetId
          ? { ...sheet, items: sheet.items.filter((i) => i.id !== itemId) }
          : sheet
      )
    );
    setSelectedRowKeys((prev) => {
      if (!prev.has(makeRowKey(sheetId, itemId))) return prev;
      const next = new Set(prev);
      next.delete(makeRowKey(sheetId, itemId));
      return next;
    });
    showToast(`'${itemName}' 항목이 삭제되었습니다.`, true);
  };

  const visibleRowKeys = useMemo(
    () => filteredEntries.map((e) => makeRowKey(e.sheetId, e.item.id)),
    [filteredEntries]
  );

  const selectedVisibleEntries = useMemo(
    () => filteredEntries.filter((e) => selectedRowKeys.has(makeRowKey(e.sheetId, e.item.id))),
    [filteredEntries, selectedRowKeys]
  );

  const isAllVisibleSelected =
    visibleRowKeys.length > 0 && visibleRowKeys.every((k) => selectedRowKeys.has(k));

  const toggleSelectRow = (sheetId: string, itemId: string) => {
    const key = makeRowKey(sheetId, itemId);
    setSelectedRowKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleSelectAllVisible = () => {
    setSelectedRowKeys((prev) => {
      const next = new Set(prev);
      if (isAllVisibleSelected) {
        visibleRowKeys.forEach((k) => next.delete(k));
      } else {
        visibleRowKeys.forEach((k) => next.add(k));
      }
      return next;
    });
  };

  const handleDeleteSelectedItems = () => {
    if (selectedVisibleEntries.length === 0) return;
    const count = selectedVisibleEntries.length;
    const keysToDelete = new Set(
      selectedVisibleEntries.map((e) => makeRowKey(e.sheetId, e.item.id))
    );
    pushUndoSnapshot(`선택 항목 ${count}건 일괄 삭제`, sheets);
    setSheets((prev) =>
      prev.map((sheet) => ({
        ...sheet,
        items: sheet.items.filter((i) => !keysToDelete.has(makeRowKey(sheet.id, i.id))),
      }))
    );
    setSelectedRowKeys(new Set());
    showToast(`선택한 자재 ${count}건을 한 번에 삭제했습니다.`, true);
  };

  const handleBatchApplyDate = () => {
    if (!batchDateValue || selectedVisibleEntries.length === 0) return;
    const targetKeys = new Set(
      selectedVisibleEntries.map((e) => makeRowKey(e.sheetId, e.item.id))
    );
    pushUndoSnapshot(`선택 ${selectedVisibleEntries.length}건 반입일자 변경`, sheets);
    setSheets((prev) =>
      prev.map((sheet) => ({
        ...sheet,
        items: sheet.items.map((i) =>
          targetKeys.has(makeRowKey(sheet.id, i.id)) ? { ...i, date: batchDateValue } : i
        ),
      }))
    );
    showToast(
      `선택한 ${selectedVisibleEntries.length}건의 반입일자를 ${batchDateValue}로 일괄 변경했습니다.`,
      true
    );
  };

  const handleBatchApplySupplier = () => {
    if (selectedVisibleEntries.length === 0) return;
    const cleanSup = batchSupplierValue.trim() === '-' ? '' : batchSupplierValue.trim();
    const targetKeys = new Set(
      selectedVisibleEntries.map((e) => makeRowKey(e.sheetId, e.item.id))
    );
    pushUndoSnapshot(`선택 ${selectedVisibleEntries.length}건 구매처 변경`, sheets);
    setSheets((prev) =>
      prev.map((sheet) => ({
        ...sheet,
        items: sheet.items.map((i) =>
          targetKeys.has(makeRowKey(sheet.id, i.id)) ? { ...i, supplier: cleanSup } : i
        ),
      }))
    );
    setBatchSupplierValue('');
    showToast(
      cleanSup
        ? `선택한 ${selectedVisibleEntries.length}건의 구매처를 '${cleanSup}'(으)로 일괄 변경했습니다.`
        : `선택한 ${selectedVisibleEntries.length}건의 구매처를 비웠습니다.`,
      true
    );
  };

  const handleBatchMoveToSheet = (destSheetId: string) => {
    if (!destSheetId || selectedVisibleEntries.length === 0) return;
    const destSheet = sheets.find((s) => s.id === destSheetId);
    if (!destSheet) return;

    const movableEntries = selectedVisibleEntries.filter((e) => e.sheetId !== destSheetId);
    if (movableEntries.length === 0) {
      showToast('선택된 항목들이 이미 해당 시트에 있습니다.');
      return;
    }

    const moveKeys = new Set(movableEntries.map((e) => makeRowKey(e.sheetId, e.item.id)));
    const itemsToAppend = movableEntries.map((e) => e.item);

    pushUndoSnapshot(`선택 ${movableEntries.length}건 '${destSheet.name}' 시트로 이동`, sheets);
    setSheets((prev) =>
      prev.map((sheet) => {
        const remaining = sheet.items.filter((i) => !moveKeys.has(makeRowKey(sheet.id, i.id)));
        if (sheet.id === destSheetId) {
          return { ...sheet, items: [...remaining, ...itemsToAppend] };
        }
        return { ...sheet, items: remaining };
      })
    );
    setSelectedRowKeys(new Set());
    setBatchTargetSheetId('');
    showToast(`선택한 ${movableEntries.length}건을 [${destSheet.name}] 시트로 이동했습니다.`, true);
  };

  const startInlineEdit = (
    sheetId: string,
    item: MaterialItem,
    field: 'date' | 'supplier' | 'name' | 'spec' | 'quantity' | 'unit' | 'packQty' | 'remarks'
  ) => {
    let val = '';
    if (field === 'date') val = item.date || '';
    else if (field === 'supplier') val = item.supplier && item.supplier !== '-' ? item.supplier : '';
    else if (field === 'name') val = item.name;
    else if (field === 'spec') val = item.spec === '-' ? '' : item.spec;
    else if (field === 'quantity') val = item.quantity > 0 ? String(item.quantity) : '';
    else if (field === 'unit') val = item.unit === '-' ? '' : item.unit;
    else if (field === 'packQty') val = item.packQty ? String(item.packQty) : '';
    else if (field === 'remarks') val = item.remarks || '';

    setInlineEditCell({
      sheetId,
      itemId: item.id,
      field,
      value: val,
      subUnitValue: item.subUnit || 'EA',
    });
  };

  const commitInlineEdit = () => {
    if (!inlineEditCell) return;
    const { sheetId, itemId, field, value, subUnitValue } = inlineEditCell;
    setInlineEditCell(null);

    setSheets((prev) =>
      prev.map((sheet) => {
        if (sheet.id !== sheetId) return sheet;
        return {
          ...sheet,
          items: sheet.items.map((item) => {
            if (item.id !== itemId) return item;
            const trimmed = value.trim();
            if (field === 'name') {
              return trimmed ? { ...item, name: trimmed } : item;
            }
            if (field === 'supplier') {
              return { ...item, supplier: trimmed === '-' ? '' : trimmed };
            }
            if (field === 'date') {
              return { ...item, date: trimmed || item.date };
            }
            if (field === 'spec') {
              return { ...item, spec: trimmed || '-' };
            }
            if (field === 'quantity') {
              const parsed = parseFloat(trimmed);
              const nextQty = !isNaN(parsed) && parsed >= 0 ? parsed : 0;
              const nextUnit =
                nextQty > 0 && (!item.unit || item.unit === '-') ? 'EA' : item.unit;
              return { ...item, quantity: nextQty, unit: nextUnit };
            }
            if (field === 'unit') {
              return {
                ...item,
                unit: trimmed ? normalizeUnitLabel(trimmed) : item.quantity > 0 ? 'EA' : '-',
              };
            }
            if (field === 'packQty') {
              const parsed = parseFloat(trimmed);
              if (!trimmed || isNaN(parsed) || parsed <= 0) {
                return { ...item, packQty: undefined, subUnit: undefined };
              }
              return {
                ...item,
                packQty: parsed,
                subUnit: normalizeUnitLabel(subUnitValue || item.subUnit || 'EA'),
              };
            }
            if (field === 'remarks') {
              return { ...item, remarks: trimmed };
            }
            return item;
          }),
        };
      })
    );
  };

  const openEditModal = (item: MaterialItem, sheetId: string) => {
    setEditingState({
      item: {
        ...item,
        supplier: item.supplier && item.supplier !== '-' ? item.supplier : '',
        spec: item.spec === '-' ? '' : item.spec,
        subUnit: item.subUnit || 'EA',
      },
      packQtyInput: item.packQty ? String(item.packQty) : '',
      sheetId,
      originalSheetId: sheetId,
    });
  };

  const handleSaveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingState) return;

    const { item, packQtyInput, sheetId, originalSheetId } = editingState;
    if (!item.name.trim() || item.quantity < 0) return;

    const parsedPack = packQtyInput.trim() ? parseFloat(packQtyInput) : undefined;
    const rawUnit = (item.unit || '').trim();
    const cleanedUnit =
      item.quantity > 0
        ? normalizeUnitLabel(!rawUnit || rawUnit === '-' ? 'EA' : rawUnit)
        : rawUnit || '-';
    const cleanedSupplier = (item.supplier || '').trim();

    const updatedItem: MaterialItem = {
      ...item,
      name: item.name.trim(),
      supplier: cleanedSupplier === '-' ? '' : cleanedSupplier,
      spec: item.spec.trim() || '-',
      unit: cleanedUnit,
      packQty: parsedPack && parsedPack > 0 ? parsedPack : undefined,
      subUnit: parsedPack && parsedPack > 0 ? normalizeUnitLabel(item.subUnit || 'EA') : undefined,
      remarks: item.remarks.trim(),
      slipId: item.slipId,
      slipIds: item.slipIds || (item.slipId ? [item.slipId] : []),
    };

    setSheets((prev) =>
      prev.map((sheet) => {
        if (originalSheetId === sheetId) {
          if (sheet.id !== sheetId) return sheet;
          return {
            ...sheet,
            items: sheet.items.map((i) => (i.id === updatedItem.id ? updatedItem : i)),
          };
        } else {
          if (sheet.id === originalSheetId) {
            return {
              ...sheet,
              items: sheet.items.filter((i) => i.id !== updatedItem.id),
            };
          }
          if (sheet.id === sheetId) {
            return {
              ...sheet,
              items: [...sheet.items, updatedItem],
            };
          }
          return sheet;
        }
      })
    );

    setEditingState(null);
    showToast('자재 정보가 저장되었습니다.');
  };

  const handleSaveSheetModal = (e: React.FormEvent) => {
    e.preventDefault();
    if (!sheetModal || !sheetModal.name.trim()) return;

    if (sheetModal.mode === 'create') {
      const newSheet: MaterialSheet = {
        id: `sheet-${Date.now()}`,
        name: sheetModal.name.trim(),
        subtitle: sheetModal.subtitle.trim() || '자재 반입·반출 관리 시트',
        items: [],
      };
      setSheets((prev) => [...prev, newSheet]);
      setActiveTabId(newSheet.id);
      showToast(`새 시트 '${newSheet.name}'이(가) 추가되었습니다.`);
    } else if (sheetModal.mode === 'edit' && sheetModal.sheetId) {
      setSheets((prev) =>
        prev.map((s) =>
          s.id === sheetModal.sheetId
            ? { ...s, name: sheetModal.name.trim(), subtitle: sheetModal.subtitle.trim() }
            : s
        )
      );
      showToast('시트 정보가 수정되었습니다.');
    }
    setSheetModal(null);
  };

  const handleDeleteSheet = (sheet: MaterialSheet) => {
    if (sheets.length <= 1) {
      showToast('최소 1개의 시트는 유지되어야 합니다.');
      return;
    }
    setConfirmDialog({
      title: '시트 삭제',
      message: `'${sheet.name}' 시트와 내부의 자재 ${sheet.items.length}건을 모두 삭제하시겠습니까?`,
      confirmLabel: '시트 삭제',
      isDestructive: true,
      onConfirm: () => {
        setSheets((prev) => prev.filter((s) => s.id !== sheet.id));
        setConfirmDialog(null);
        showToast(`'${sheet.name}' 시트가 삭제되었습니다.`);
      },
    });
  };

  const handleClearCurrentSheet = () => {
    if (activeTabId === 'ALL') {
      if (totalItemsAcrossAllSheets === 0) return;
      setConfirmDialog({
        title: '전체 시트 자재 모두 지우기',
        message: `모든 시트에 등록된 자재 총 ${totalItemsAcrossAllSheets}건을 한 번에 모두 지우시겠습니까? (지운 직후 '실행 취소'로 되돌릴 수 있습니다)`,
        confirmLabel: '전체 지우기',
        isDestructive: true,
        onConfirm: () => {
          pushUndoSnapshot(`전체 시트 자재 ${totalItemsAcrossAllSheets}건 모두 지우기`, sheets);
          setSheets((prev) => prev.map((s) => ({ ...s, items: [] })));
          setSelectedRowKeys(new Set());
          setConfirmDialog(null);
          showToast('모든 시트의 자재 목록을 비웠습니다.', true);
        },
      });
    } else if (activeSheet && activeSheet.items.length > 0) {
      const cnt = activeSheet.items.length;
      setConfirmDialog({
        title: `'${activeSheet.name}' 전체 지우기`,
        message: `'${activeSheet.name}' 시트에 등록된 자재 ${cnt}건을 모두 지우시겠습니까? (지운 직후 '실행 취소'로 되돌릴 수 있습니다)`,
        confirmLabel: `${cnt}건 전체 지우기`,
        isDestructive: true,
        onConfirm: () => {
          pushUndoSnapshot(`'${activeSheet.name}' 시트 ${cnt}건 전체 지우기`, sheets);
          setSheets((prev) =>
            prev.map((s) => (s.id === activeSheet.id ? { ...s, items: [] } : s))
          );
          setSelectedRowKeys(new Set());
          setConfirmDialog(null);
          showToast(`'${activeSheet.name}' 시트의 ${cnt}건을 모두 지웠습니다.`, true);
        },
      });
    }
  };

  const handleExportExcel = async () => {
    if (isExportingExcel) return;
    if (!isAllSheetsSynced && sharedSubRef.current) {
      sharedSubRef.current.requestAllSheets();
      showToast('모든 시트 데이터를 마저 불러온 뒤 엑셀 파일을 생성합니다...');
      return;
    }
    try {
      setIsExportingExcel(true);
      const { exportStyledExcelWorkbook } = await import('./utils/exportExcel');
      await exportStyledExcelWorkbook({
        sheets,
        activeTabId,
        siteName,
        yonginAddress: YONGIN_ADDRESS,
        favoritePinnedKeys: favoritePrefs.pinnedKeys,
        favoriteMutedAutoKeys: favoritePrefs.mutedAutoKeys,
      });
      showToast('요청하신 대장 표 양식(.xlsx)으로 엑셀 파일이 다운로드되었습니다.');
    } catch (error) {
      console.error('Failed to export Excel workbook:', error);
      showToast('엑셀 파일 생성 중 오류가 발생했습니다.');
    } finally {
      setIsExportingExcel(false);
    }
  };

  const handleImportSingle = (payload: SingleSheetImportPayload) => {
    const now = Date.now();
    const createdItems: MaterialItem[] = payload.items.map((raw, idx) => ({
      ...raw,
      id: `imp-${now}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
      createdAt: now + idx,
    }));

    if (payload.destinationMode === 'new') {
      const sheetName = (payload.newSheetName || '새 가져온 시트').trim();
      const newSheet: MaterialSheet = {
        id: `sheet-${now}`,
        name: sheetName,
        subtitle: payload.newSheetSubtitle || '엑셀 표에서 가져온 자재 목록',
        items: createdItems,
      };
      setSheets((prev) => [...prev, newSheet]);
      setActiveTabId(newSheet.id);
      showToast(`새 시트 '${sheetName}'을(를) 생성하고 자재 ${createdItems.length}건을 등록했습니다.`);
    } else {
      const destId = payload.targetSheetId || sheets[0]?.id;
      const destSheet = sheets.find((s) => s.id === destId);
      if (destSheet) {
        setSheets((prev) =>
          prev.map((s) =>
            s.id === destId ? { ...s, items: [...s.items, ...createdItems] } : s
          )
        );
        setActiveTabId(destId);
        showToast(`[${destSheet.name}] 시트에 엑셀 자재 ${createdItems.length}건을 등록했습니다.`);
      }
    }

    setShowExcelImportModal(false);
    setDroppedExcelFile(null);
  };

  const handleImportSlipItems = (payload: {
    targetSheetId: string;
    items: Omit<MaterialItem, 'id' | 'createdAt'>[];
    sourceLabel: string;
    slipRecord?: StoredReceiptSlip;
  }) => {
    const now = Date.now();
    const createdItems: MaterialItem[] = payload.items.map((raw, idx) => ({
      ...raw,
      id: `slip-${now}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
      createdAt: now + idx,
      slipId: payload.slipRecord ? payload.slipRecord.id : raw.slipId,
      slipIds: payload.slipRecord ? [payload.slipRecord.id] : (raw.slipIds || (raw.slipId ? [raw.slipId] : [])),
    }));

    if (payload.slipRecord) {
      const updatedSlip: StoredReceiptSlip = {
        ...payload.slipRecord,
        itemIds: createdItems.map((i) => i.id),
      };
      setSlips((prev) => [updatedSlip, ...prev.filter((s) => s.id !== updatedSlip.id)]);
      void persistSlipToSharedCloud(updatedSlip);
    }

    pushUndoSnapshot(`'${payload.sourceLabel}' 자재 ${createdItems.length}건 등록`, sheets);

    setSheets((prev) =>
      prev.map((s) =>
        s.id === payload.targetSheetId
          ? { ...s, items: [...s.items, ...createdItems] }
          : s
      )
    );

    setActiveTabId(payload.targetSheetId);
    const targetSheet = sheets.find((s) => s.id === payload.targetSheetId);
    showToast(
      `[${targetSheet?.name || '시트'}] 전표에서 자재 ${createdItems.length}건 및 원본 사진이 보관함에 저장되었습니다!`,
      true
    );
  };

  const handleDeleteSlip = async (slipId: string) => {
    const targetSlip = slips.find((s) => s.id === slipId);
    await deleteSlipFromDB(slipId);
    try {
      await deleteSharedSlipFromCloud(slipId, targetSlip?.storagePath);
    } catch (err: any) {
      console.error('Failed to delete shared slip from cloud:', err);
      setSyncStatus('error');
      setSyncError(err?.message || '공용 전표 삭제 실패');
    }
    setSlips((prev) => prev.filter((s) => s.id !== slipId));
    if (activeViewingSlipId === slipId) {
      setActiveViewingSlipId(null);
    }
    // Also clear this slipId from any items that were linked to it
    setSheets((prev) =>
      prev.map((s) => ({
        ...s,
        items: s.items.map((i) => {
          const currentIds = getItemSlipIds(i);
          if (!currentIds.includes(slipId)) return i;
          const nextIds = currentIds.filter((id) => id !== slipId);
          return {
            ...i,
            slipIds: nextIds,
            slipId: nextIds[0] || undefined,
          };
        }),
      }))
    );
    showToast('전표 사진이 보관함에서 삭제되었습니다.');
  };

  const handleClearAllSlips = async () => {
    const snapshotSlips = [...slips];
    await clearAllSlipsFromDB();
    if (snapshotSlips.length > 0) {
      try {
        await Promise.all(
          snapshotSlips.map((s) => deleteSharedSlipFromCloud(s.id, s.storagePath))
        );
      } catch (err: any) {
        console.error('Failed to clear shared cloud slips:', err);
        setSyncStatus('error');
        setSyncError(err?.message || '공용 전표 일괄 삭제 실패');
      }
    }
    setSlips([]);
    if (activeViewingSlipId) {
      setActiveViewingSlipId(null);
    }
    setSheets((prev) =>
      prev.map((s) => ({
        ...s,
        items: s.items.map((i) => ({ ...i, slipId: undefined, slipIds: [] })),
      }))
    );
    showToast('보관함의 모든 전표가 삭제되었으며, 품목의 전표 연결이 초기화되었습니다.');
  };

  const handleRemoveSlipFromItem = (sheetId: string, itemId: string, targetSlipId?: string) => {
    pushUndoSnapshot('품목 전표 연결 해제', sheets);
    setSheets((prev) =>
      prev.map((s) =>
        s.id === sheetId
          ? {
              ...s,
              items: s.items.map((i) => {
                if (i.id !== itemId) return i;
                const currentIds = getItemSlipIds(i);
                const nextIds = targetSlipId
                  ? currentIds.filter((id) => id !== targetSlipId)
                  : [];
                return {
                  ...i,
                  slipIds: nextIds,
                  slipId: nextIds[0] || undefined,
                };
              }),
            }
          : s
      )
    );
    showToast(
      targetSlipId
        ? '해당 전표 사진 연결이 삭제되었습니다.'
        : '품목의 모든 전표 사진 연결이 삭제되었습니다.',
      true
    );
  };

  const handleAttachSlipToItem = (sheetId: string, itemId: string, slipId: string) => {
    setSheets((prev) =>
      prev.map((s) =>
        s.id === sheetId
          ? {
              ...s,
              items: s.items.map((i) => {
                if (i.id !== itemId) return i;
                const currentIds = getItemSlipIds(i);
                const nextIds = currentIds.includes(slipId)
                  ? currentIds
                  : [...currentIds, slipId];
                return {
                  ...i,
                  slipIds: nextIds,
                  slipId: nextIds[0] || slipId,
                };
              }),
            }
          : s
      )
    );
    showToast('품목에 전표 사진이 추가 연결되었습니다.');
  };

  const handleDirectDropSlipOnItem = async (
    sheetId: string,
    targetItem: MaterialItem,
    file: File
  ) => {
    lastDirectDropTimeRef.current = Date.now();
    setDroppedSlipIntentFile(null);
    setIsWindowDragging(false);
    setFileDropTargetItem(null);
    try {
      if (!isImageFile(file)) {
        showToast('전표 사진(JPG, PNG 등 이미지 파일)만 등록할 수 있습니다.');
        return;
      }
      showToast(`'${targetItem.name}' 전표 사진을 저장 중입니다...`);
      const compressedDataUrl = await compressReceiptImage(file, 1920, 0.85);
      if (!compressedDataUrl) {
        showToast('이미지 파일을 읽을 수 없습니다.');
        return;
      }
      const now = Date.now();
      const existingIds = getItemSlipIds(targetItem);
      const orderNumber = existingIds.length + 1;
      const newSlipId = `slip-drop-${now}-${Math.random().toString(36).slice(2, 6)}`;
      const cleanFileName = file.name || `전표_${targetItem.name}_${orderNumber}.jpg`;

      const targetSheet = sheets.find((s) => s.id === sheetId);

      const newSlip: StoredReceiptSlip = {
        id: newSlipId,
        title: `${targetItem.name} 전표 (${orderNumber}차)`,
        documentType: '납품/반입 전표',
        supplierName: targetItem.supplier && targetItem.supplier !== '-' ? targetItem.supplier : '',
        documentDate: targetItem.date || new Date().toISOString().split('T')[0],
        sheetId: sheetId,
        sheetName: targetSheet?.name || '기존 자재 시트',
        itemIds: [targetItem.id],
        itemNames: [targetItem.name],
        imageUrl: compressedDataUrl,
        fileName: cleanFileName,
        fileSize: Math.round(compressedDataUrl.length * 0.75),
        createdAt: now,
      };

      await saveSlipToDB(newSlip);
      setSlips((prev) => [newSlip, ...prev.filter((s) => s.id !== newSlip.id)]);
      void persistSlipToSharedCloud(newSlip);
      setSheets((prev) =>
        prev.map((s) =>
          s.id === sheetId
            ? {
                ...s,
                items: s.items.map((i) => {
                  if (i.id !== targetItem.id) return i;
                  const currentIds = getItemSlipIds(i);
                  const nextIds = currentIds.includes(newSlipId)
                    ? currentIds
                    : [...currentIds, newSlipId];
                  return {
                    ...i,
                    slipIds: nextIds,
                    slipId: nextIds[0] || newSlipId,
                  };
                }),
              }
            : s
        )
      );
      showToast(`'${targetItem.name}' 품목에 전표 사진이 바로 등록되었습니다! (새 품목 생성 방지됨)`, true);
    } catch (err) {
      console.error('Failed to attach dropped slip directly:', err);
      showToast('전표 사진 저장 중 오류가 발생했습니다.');
    }
  };

  const openSlipViewer = (slipId: string, scopedIds?: string[]) => {
    setActiveViewingSlipId(slipId);
    setViewerScopedSlipIds(scopedIds && scopedIds.length > 0 ? scopedIds : null);

    const idsToEnsure = Array.from(
      new Set([slipId, ...(scopedIds && scopedIds.length > 0 ? scopedIds : [])].filter(Boolean))
    );
    const missingIds = idsToEnsure.filter((id) => !slips.some((s) => s.id === id));
    if (missingIds.length > 0) {
      setSlipViewerLoading(true);
      Promise.all(missingIds.map((id) => fetchSingleSharedSlip(id).catch(() => null)))
        .then((fetched) => {
          const valid = fetched.filter((s): s is StoredReceiptSlip => Boolean(s));
          if (valid.length > 0) {
            setSlips((prev) => {
              const map = new Map<string, StoredReceiptSlip>();
              valid.forEach((s) => map.set(s.id, s));
              prev.forEach((s) => {
                if (!map.has(s.id)) map.set(s.id, s);
              });
              return Array.from(map.values()).sort((a, b) => b.createdAt - a.createdAt);
            });
          }
        })
        .finally(() => {
          setSlipViewerLoading(false);
        });
    }
  };

  const activeViewingSlip = useMemo(() => {
    if (!activeViewingSlipId) return null;
    return slips.find((s) => s.id === activeViewingSlipId) || null;
  }, [activeViewingSlipId, slips]);

  const headerSlipCount = useMemo(() => {
    if (hasFullSlipsLoaded) return slips.length;
    const linkedIds = new Set<string>();
    sheets.forEach((sh) =>
      sh.items.forEach((it) => {
        getItemSlipIds(it).forEach((id) => linkedIds.add(id));
      })
    );
    slips.forEach((s) => linkedIds.add(s.id));
    return linkedIds.size;
  }, [slips, hasFullSlipsLoaded, sheets]);

  const associatedItemsForActiveSlip = useMemo(() => {
    if (!activeViewingSlipId) return [];
    return sheets.flatMap((s) => s.items).filter((i) => getItemSlipIds(i).includes(activeViewingSlipId));
  }, [activeViewingSlipId, sheets]);

  const currentAttachingItem = useMemo(() => {
    if (!attachingTarget) return null;
    const targetSheet = sheets.find((s) => s.id === attachingTarget.sheetId);
    return targetSheet?.items.find((i) => i.id === attachingTarget.item.id) || attachingTarget.item;
  }, [attachingTarget, sheets]);

  const viewerSlipsList = useMemo(() => {
    if (viewerScopedSlipIds && viewerScopedSlipIds.length > 0) {
      return viewerScopedSlipIds
        .map((id) => slips.find((s) => s.id === id))
        .filter((s): s is StoredReceiptSlip => Boolean(s));
    }
    return slips;
  }, [viewerScopedSlipIds, slips]);

  const handleImportMultipleSheets = (payload: MultiSheetImportPayload) => {
    const now = Date.now();
    const newSheets: MaterialSheet[] = payload.sheetsToCreate.map((s, sIdx) => ({
      id: `sheet-${now}-${sIdx}`,
      name: s.name.trim() || `가져온 시트 ${sIdx + 1}`,
      subtitle: s.subtitle,
      items: s.items.map((raw, idx) => ({
        ...raw,
        id: `imp-${now}-${sIdx}-${idx}-${Math.random().toString(36).slice(2, 5)}`,
        createdAt: now + sIdx * 1000 + idx,
      })),
    }));

    if (newSheets.length === 0) return;

    setSheets((prev) => [...prev, ...newSheets]);
    setActiveTabId(newSheets[0].id);
    const totalImported = newSheets.reduce((sum, s) => sum + s.items.length, 0);
    showToast(
      `엑셀에서 ${newSheets.length}개 시트(총 ${totalImported}건)를 일괄 등록했습니다.`
    );
    setShowExcelImportModal(false);
    setDroppedExcelFile(null);
  };

  const totalItemsAcrossAllSheets = useMemo(
    () => sheets.reduce((acc, s) => acc + s.items.length, 0),
    [sheets]
  );

  const totalItemsForIntegratedView = useMemo(
    () => integratedSheets.reduce((acc, s) => acc + s.items.length, 0),
    [integratedSheets]
  );

  // Standalone Single-File HTML Generator (only computed when HTML Export Modal is open)
  const standaloneHtmlCode = useMemo(() => {
    if (!showHtmlExportModal) return '';
    const serializedSheets = JSON.stringify(sheets, null, 2);
    const escapedSiteName = siteName.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0">
  <title>(주)다인_용인사업부 _반입 반출 대장 - ${escapedSiteName}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Noto Sans KR', sans-serif; }
    .tabular-nums { font-variant-numeric: tabular-nums; }
    @media print {
      .no-print { display: none !important; }
      body { background: white !important; }
    }
  </style>
</head>
<body class="bg-slate-50 text-slate-900 min-h-screen pb-12">
  <div class="max-w-7xl mx-auto px-4 py-6 md:py-8">
    <header class="flex flex-col md:flex-row md:items-start justify-between pb-5 border-b border-slate-200 gap-4">
      <div>
        <h1 class="text-xl md:text-2xl font-bold tracking-tight text-slate-900">(주)다인_용인사업부 _반입 반출 대장</h1>
        <p class="text-xs text-slate-500 mt-1" id="active-sheet-subtitle">${escapedSiteName}</p>
        <div class="mt-2.5 inline-flex flex-wrap items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-700">
          <span class="font-semibold text-blue-700">용인사업부 주소 :</span>
          <span class="font-medium text-slate-900">${YONGIN_ADDRESS}</span>
          <button type="button" onclick="navigator.clipboard.writeText('${YONGIN_ADDRESS}'); this.innerText='복사됨'; setTimeout(()=>this.innerText='복사',1500);" class="no-print px-2 py-0.5 text-[11px] font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded transition-colors">복사</button>
        </div>
      </div>
      <div class="flex flex-wrap items-center gap-2 no-print">
        <input type="file" id="standalone-excel-file" accept=".xlsx,.xls,.csv" class="hidden" onchange="importExcelFile(event)">
        <button onclick="document.getElementById('standalone-excel-file').click()" class="px-3.5 py-1.5 text-xs font-semibold text-blue-800 bg-blue-50 border border-blue-200 rounded-lg shadow-sm hover:bg-blue-100">엑셀 표 가져오기</button>
        <button onclick="exportExcel()" class="px-3.5 py-1.5 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg shadow-sm hover:bg-emerald-100">엑셀 다운로드 (.xlsx)</button>
        <button onclick="window.print()" class="px-3 py-1.5 text-xs font-medium bg-white border border-slate-300 rounded-lg shadow-sm hover:bg-slate-50">인쇄 / PDF</button>
        <button onclick="clearCurrentSheet()" class="px-3 py-1.5 text-xs font-medium text-rose-600 bg-white border border-rose-200 rounded-lg shadow-sm hover:bg-rose-50">현재 시트 비우기</button>
      </div>
    </header>

    <div class="flex items-center gap-1.5 overflow-x-auto py-4 border-b border-slate-200 mb-6 no-print" id="sheet-tabs"></div>

    <section class="bg-white p-5 rounded-xl border border-slate-200 mb-6 no-print">
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-sm font-bold text-slate-800" id="form-title">새 자재 등록</h2>
        <span class="text-xs font-mono font-semibold text-blue-600" id="live-calc-preview"></span>
      </div>
      <form id="material-form" onsubmit="handleFormSubmit(event)" class="grid grid-cols-1 md:grid-cols-12 gap-3">
        <div class="md:col-span-2">
          <label class="block text-xs font-semibold text-slate-700 mb-1">반입일자</label>
          <input type="date" id="input-date" class="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg">
        </div>
        <div class="md:col-span-2">
          <label class="block text-xs font-semibold text-slate-700 mb-1">구매처</label>
          <input type="text" id="input-supplier" placeholder="예: 대원강업" class="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg">
        </div>
        <div class="md:col-span-3">
          <label class="block text-xs font-semibold text-slate-700 mb-1">자재 품목명 *</label>
          <input type="text" id="input-name" required placeholder="예: 40A BASE" class="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg">
        </div>
        <div class="md:col-span-2">
          <label class="block text-xs font-semibold text-slate-700 mb-1">규격 / 사양</label>
          <input type="text" id="input-spec" placeholder="예: 2.5 Ton" class="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg">
        </div>
        <div class="md:col-span-3">
          <label class="block text-xs font-semibold text-slate-700 mb-1">반입 수량 / 단위 *</label>
          <div class="flex gap-1">
            <input type="number" id="input-qty" step="any" required min="0.001" oninput="updatePreview()" placeholder="5" class="w-full px-2.5 py-2 text-sm font-mono border border-slate-300 rounded-lg">
            <input type="text" id="input-unit" value="파레트" oninput="updatePreview()" class="w-20 px-2 py-2 text-xs text-center border border-slate-300 rounded-lg">
          </div>
        </div>
        <div class="md:col-span-4">
          <label class="block text-xs font-semibold text-slate-700 mb-1">단위당 입수량 (선택)</label>
          <div class="flex gap-1">
            <input type="number" id="input-pack-qty" step="any" min="0.001" oninput="updatePreview()" placeholder="630" class="w-full px-2.5 py-2 text-sm font-mono border border-slate-300 rounded-lg">
            <input type="text" id="input-sub-unit" value="EA" oninput="updatePreview()" class="w-16 px-2 py-2 text-xs font-mono text-center border border-slate-300 rounded-lg">
          </div>
        </div>
        <div class="md:col-span-6">
          <label class="block text-xs font-semibold text-slate-700 mb-1">비고</label>
          <input type="text" id="input-remarks" placeholder="비고 메모" class="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg">
        </div>
        <div class="md:col-span-2 flex items-end">
          <button type="submit" class="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm rounded-lg transition-colors">+ 자재 추가</button>
        </div>
      </form>
    </section>

    <div id="item-summary-box" class="bg-white rounded-xl border border-slate-300 p-4 sm:p-5 mb-6 hidden">
      <div class="flex items-center justify-between mb-3 pb-2.5 border-b border-slate-200">
        <span class="text-base font-bold text-slate-900" id="item-summary-title">품목별 토탈 수량</span>
        <span class="text-xs text-slate-500">동일 품목 반복 반입 시 토탈 수량 자동 합산</span>
      </div>
      <div id="item-summary-grid"></div>
    </div>

    <div class="bg-white rounded-xl border border-slate-300 overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-center border-collapse text-sm">
          <thead>
            <tr class="bg-[#1e293b] text-white text-xs font-bold" id="table-head-row"></tr>
          </thead>
          <tbody id="material-tbody" class="divide-y divide-slate-200"></tbody>
        </table>
      </div>
      <div id="empty-state" class="py-12 text-center text-slate-400 hidden text-sm">
        등록된 자재가 없습니다. 상단 폼에서 새 자재를 추가해 주세요.
      </div>
    </div>
  </div>

  <script>
    const STORAGE_KEY = 'field_material_sheets_v1';
    const DEFAULT_SHEETS = ${serializedSheets};
    let sheets = [];
    let activeTabId = DEFAULT_SHEETS[0]?.id || 'ALL';

    document.getElementById('input-date').value = new Date().toISOString().split('T')[0];

    function buildNumFmt(val, unitLabel) {
      const base = Number.isInteger(val) ? '#,##0' : '#,##0.###';
      if (!unitLabel) return base;
      return base + '" ' + unitLabel.replace(/"/g, '').trim() + '"';
    }

    function updatePreview() {
      const q = parseFloat(document.getElementById('input-qty').value);
      const u = document.getElementById('input-unit').value.trim() || '파레트';
      const pq = parseFloat(document.getElementById('input-pack-qty').value);
      const su = document.getElementById('input-sub-unit').value.trim() || 'EA';
      const el = document.getElementById('live-calc-preview');
      if (q > 0 && pq > 0) {
        el.innerText = q + ' ' + u + ' × ' + pq.toLocaleString() + ' ' + su + ' = 총 ' + (q * pq).toLocaleString() + ' ' + su;
      } else {
        el.innerText = '';
      }
    }

    function loadData() {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) {
            sheets = parsed;
            activeTabId = sheets[0].id;
          } else {
            sheets = DEFAULT_SHEETS;
          }
        } else {
          sheets = DEFAULT_SHEETS;
          saveData();
        }
      } catch (e) {
        sheets = DEFAULT_SHEETS;
      }
      render();
    }

    function saveData() {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sheets));
    }

    function selectSheet(id) {
      activeTabId = id;
      render();
    }

    function handleFormSubmit(e) {
      e.preventDefault();
      const name = document.getElementById('input-name').value.trim();
      const supplier = document.getElementById('input-supplier').value.trim();
      const spec = document.getElementById('input-spec').value.trim() || '-';
      const unit = document.getElementById('input-unit').value.trim() || 'EA';
      const qty = parseFloat(document.getElementById('input-qty').value) || 0;
      const packQtyRaw = parseFloat(document.getElementById('input-pack-qty').value);
      const packQty = packQtyRaw > 0 ? packQtyRaw : undefined;
      const subUnit = packQty ? (document.getElementById('input-sub-unit').value.trim() || 'EA') : undefined;
      const dateVal = document.getElementById('input-date').value || new Date().toISOString().split('T')[0];
      const remarks = document.getElementById('input-remarks').value.trim();

      if (!name || qty <= 0) return;

      const targetId = activeTabId === 'ALL' ? sheets[0].id : activeTabId;
      const newItem = {
        id: 'mat-' + Date.now(),
        name,
        supplier,
        spec,
        unit,
        quantity: qty,
        packQty,
        subUnit,
        isCompleted: false,
        location: '',
        remarks,
        date: dateVal,
        createdAt: Date.now()
      };

      sheets = sheets.map(s => s.id === targetId ? { ...s, items: [...s.items, newItem] } : s);
      saveData();
      document.getElementById('input-name').value = '';
      document.getElementById('input-supplier').value = '';
      document.getElementById('input-spec').value = '';
      document.getElementById('input-qty').value = '';
      document.getElementById('input-pack-qty').value = '';
      document.getElementById('input-remarks').value = '';
      updatePreview();
      render();
    }

    function toggleCheck(sheetId, itemId) {
      sheets = sheets.map(s => s.id !== sheetId ? s : { ...s, items: s.items.map(i => i.id === itemId ? { ...i, isCompleted: !i.isCompleted } : i) });
      saveData();
      render();
    }

    function deleteItem(sheetId, itemId) {
      sheets = sheets.map(s => s.id !== sheetId ? s : { ...s, items: s.items.filter(i => i.id !== itemId) });
      saveData();
      render();
    }

    function moveItem(sheetId, itemId, delta) {
      sheets = sheets.map(s => {
        if (s.id !== sheetId) return s;
        const arr = [...s.items];
        const idx = arr.findIndex(i => i.id === itemId);
        const nextIdx = idx + delta;
        if (idx === -1 || nextIdx < 0 || nextIdx >= arr.length) return s;
        const [moved] = arr.splice(idx, 1);
        arr.splice(nextIdx, 0, moved);
        return { ...s, items: arr };
      });
      saveData();
      render();
    }

    function clearCurrentSheet() {
      if (!confirm('현재 시트의 자재 목록을 모두 비우시겠습니까?')) return;
      sheets = activeTabId === 'ALL' ? sheets.map(s => ({ ...s, items: [] })) : sheets.map(s => s.id === activeTabId ? { ...s, items: [] } : s);
      saveData();
      render();
    }

    function isOfficeSheet(s) {
      return s.id === '${OFFICE_SUPPLIES_SHEET_ID}' || (s.name && s.name.trim() === '사무용품');
    }

    function getActiveEntries() {
      if (activeTabId === 'ALL') return sheets.filter(s => !isOfficeSheet(s)).flatMap(s => s.items.map(item => ({ item, sheetId: s.id, sheetName: s.name })));
      const found = sheets.find(s => s.id === activeTabId);
      return found ? found.items.map(item => ({ item, sheetId: found.id, sheetName: found.name })) : [];
    }

    async function importExcelFile(e) {
      const file = e.target.files && e.target.files[0];
      if (!file || typeof XLSX === 'undefined') return;
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', raw: false });
      const ws = wb.Sheets[wb.SheetNames[0]];
      if (!ws) return;
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false, blankrows: false });
      let headerIdx = -1;
      for (let r = 0; r < Math.min(rows.length, 12); r++) {
        const joined = rows[r].join(' ');
        if (joined.includes('품명') || joined.includes('품목')) { headerIdx = r; break; }
      }
      const hdr = headerIdx >= 0 ? rows[headerIdx].map(c => String(c).replace(/\\s+/g, '')) : [];
      const findCol = (kws, fallback) => {
        const idx = hdr.findIndex(h => kws.some(k => h.includes(k)));
        return idx >= 0 ? idx : fallback;
      };
      const supCol = findCol(['구매처', '발주처', '거래처', '납품처', '공급처', '업체'], -1);
      const nameCol = findCol(['품명', '품목'], 1);
      const specCol = findCol(['규격', '사양'], -1);
      const qtyCol = hdr.findIndex(h => (h.includes('수량') || h.includes('물량')) && !h.includes('입수량') && !h.includes('총수량'));
      const unitCol = findCol(['단위'], -1);
      const usageCol = findCol(['용도'], -1);
      const remCol = findCol(['비고', '특이사항'], -1);
      const today = new Date().toISOString().split('T')[0];
      const targetId = activeTabId === 'ALL' ? sheets[0].id : activeTabId;
      const added = [];
      for (let r = headerIdx + 1; r < rows.length; r++) {
        const row = rows[r];
        const nm = String(row[nameCol] || '').trim();
        if (!nm || nm.includes('합계') || nm.includes('등록된 자재')) continue;
        const sup = supCol >= 0 ? String(row[supCol] || '').trim() : '';
        const q = qtyCol >= 0 ? (parseFloat(String(row[qtyCol]).replace(/,/g, '')) || 0) : 0;
        const u = unitCol >= 0 && String(row[unitCol]).trim() ? String(row[unitCol]).trim() : (q > 0 ? 'EA' : '-');
        const usg = usageCol >= 0 ? String(row[usageCol] || '').replace(/\\s*\\n\\s*/g, ' / ').trim() : '';
        const rem = remCol >= 0 ? String(row[remCol] || '').replace(/\\s*\\n\\s*/g, ' / ').trim() : '';
        added.push({
          id: 'imp-' + Date.now() + '-' + r,
          name: nm,
          supplier: sup && sup !== '-' ? sup : '',
          spec: (specCol >= 0 ? String(row[specCol] || '').trim() : '') || '-',
          unit: u,
          quantity: q,
          isCompleted: false,
          location: '',
          remarks: usg && rem ? (usg + ' · ' + rem) : (rem || usg),
          date: today,
          createdAt: Date.now() + r
        });
      }
      if (added.length > 0) {
        sheets = sheets.map(s => s.id === targetId ? { ...s, items: [...s.items, ...added] } : s);
        saveData();
        render();
      }
      e.target.value = '';
    }

    async function exportExcel() {
      if (typeof ExcelJS === 'undefined') return alert('인터넷 연결을 확인해주세요.');
      const wb = new ExcelJS.Workbook();
      const today = new Date().toISOString().split('T')[0];
      const used = new Set();

      function buildSheet(ws, titleLabel, entries, includeSheet) {
        const totalCols = includeSheet ? 11 : 10;
        const lastCol = includeSheet ? 'K' : 'J';
        ws.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
        ws.mergeCells('A1:' + lastCol + '1');
        ws.getRow(1).height = 38;
        const t = ws.getCell('A1');
        t.value = '(주)다인_용인사업부 _반입 반출 대장  [' + titleLabel + ']';
        t.font = { name: '맑은 고딕', size: 15, bold: true, color: { argb: 'FF0F172A' } };
        t.alignment = { horizontal: 'center', vertical: 'middle' };
        t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };

        const leftEnd = includeSheet ? 'F' : 'E';
        const rightStart = includeSheet ? 'G' : 'F';
        ws.mergeCells('A2:' + leftEnd + '2');
        ws.mergeCells(rightStart + '2:' + lastCol + '2');
        ws.getRow(2).height = 24;
        ws.getCell('A2').value = '용인사업부 주소 : ${YONGIN_ADDRESS}';
        ws.getCell('A2').font = { name: '맑은 고딕', size: 10, bold: true, color: { argb: 'FF1E3A8A' } };
        ws.getCell('A2').alignment = { horizontal: 'center', vertical: 'middle' };
        ws.getCell(rightStart + '2').value = titleLabel.includes('이전') ? '' : ('신규 발주 자재 반입 관리  |  출력일: ' + today);
        ws.getCell(rightStart + '2').font = { name: '맑은 고딕', size: 10, color: { argb: 'FF475569' } };
        ws.getCell(rightStart + '2').alignment = { horizontal: 'center', vertical: 'middle' };
        ws.getRow(3).height = 6;

        const headers = includeSheet
          ? ['No.', '시트 구분', '반입일자', '구매처', '자재 품목명', '규격 / 사양', '반입 수량', '단위', '비고']
          : ['No.', '반입일자', '구매처', '자재 품목명', '규격 / 사양', '반입 수량', '단위', '비고'];
        const hr = ws.getRow(4);
        hr.values = headers;
        hr.height = 28;
        hr.eachCell(c => {
          c.font = { name: '맑은 고딕', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
          c.alignment = { horizontal: 'center', vertical: 'middle' };
          c.border = { top: { style: 'medium' }, bottom: { style: 'medium' }, left: { style: 'thin' }, right: { style: 'thin' } };
        });

        entries.forEach(({ item, sheetName }, idx) => {
          const r = ws.getRow(5 + idx);
          r.height = 25;
          const isLast = idx === entries.length - 1;
          const isEven = idx % 2 === 1;
          const supText = (item.supplier && item.supplier !== '-') ? item.supplier : '-';
          const vals = includeSheet
            ? [idx + 1, sheetName, item.date || '', supText, item.name, item.spec || '-', item.quantity, item.unit, item.remarks || '-']
            : [idx + 1, item.date || '', supText, item.name, item.spec || '-', item.quantity, item.unit, item.remarks || '-'];
          r.values = vals;
          const nameCol = includeSheet ? 5 : 4;
          const qtyCol = includeSheet ? 7 : 6;
          r.eachCell((c, colNum) => {
            c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: isEven ? 'FFF8FAFC' : 'FFFFFFFF' } };
            c.font = { name: '맑은 고딕', size: 10, bold: colNum === nameCol || colNum === qtyCol, color: { argb: 'FF0F172A' } };
            c.alignment = { vertical: 'middle', horizontal: colNum === nameCol ? 'left' : 'center', indent: 0 };
            if (colNum === qtyCol) c.numFmt = buildNumFmt(item.quantity);
            c.border = {
              top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
              bottom: { style: isLast ? 'medium' : 'thin', color: { argb: isLast ? 'FF1E293B' : 'FFCBD5E1' } },
              left: { style: colNum === 1 ? 'medium' : 'thin', color: { argb: colNum === 1 ? 'FF1E293B' : 'FFE2E8F0' } },
              right: { style: colNum === totalCols ? 'medium' : 'thin', color: { argb: colNum === totalCols ? 'FF1E293B' : 'FFE2E8F0' } }
            };
          });
        });

        if (entries.length > 0) {
          ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + entries.length, column: totalCols } };
        }

        const widths = includeSheet ? [8, 20, 14, 18, 34, 18, 16, 10, 20] : [8, 14, 18, 34, 18, 16, 10, 20];
        widths.forEach((w, i) => ws.getColumn(i + 1).width = w);
      }

      sheets.forEach((s, i) => {
        let nm = s.name.replace(/[\\\\/?*[\\]:]/g, ' ').slice(0, 28).trim() || ('시트' + (i + 1));
        while (used.has(nm)) nm = nm.slice(0, 25) + '_' + i;
        used.add(nm);
        buildSheet(wb.addWorksheet(nm), s.name, s.items.map(item => ({ item, sheetName: s.name })), false);
      });
      buildSheet(wb.addWorksheet('전체 통합 현황'), '전체 통합 현황', sheets.filter(s => !isOfficeSheet(s)).flatMap(s => s.items.map(item => ({ item, sheetName: s.name }))), true);

      const buf = await wb.xlsx.writeBuffer();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      a.download = '(주)다인_용인사업부_반입반출대장_' + today + '.xlsx';
      a.click();
    }

    function render() {
      const tabsEl = document.getElementById('sheet-tabs');
      const totalAllCount = sheets.filter(s => !isOfficeSheet(s)).reduce((sum, s) => sum + s.items.length, 0);
      tabsEl.innerHTML = sheets.map(s => {
        const isActive = s.id === activeTabId;
        return \`<button onclick="selectSheet('\${s.id}')" class="px-4 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors \${isActive ? 'bg-blue-600 text-white shadow-sm' : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'}">\${s.name} (\${s.items.length})</button>\`;
      }).join('') +
      \`<button onclick="selectSheet('ALL')" class="px-3.5 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors \${activeTabId === 'ALL' ? 'bg-slate-900 text-white shadow-sm' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'}">전체 통합 보기 (\${totalAllCount})</button>\`;

      const entries = getActiveEntries();
      document.getElementById('table-head-row').innerHTML = \`
        <th class="py-3 px-3 w-16 no-print">삭제</th>
        <th class="py-3 px-3 w-14">No.</th>
        \${activeTabId === 'ALL' ? '<th class="py-3 px-3 min-w-[130px]">시트 구분</th>' : ''}
        <th class="py-3 px-3 w-32">반입일자</th>
        <th class="py-3 px-3 min-w-[115px]">구매처</th>
        <th class="py-3 px-4 text-left min-w-[230px]">자재 품목명</th>
        <th class="py-3 px-3 min-w-[130px]">규격 / 사양</th>
        <th class="py-3 px-3 w-32">반입 수량</th>
        <th class="py-3 px-3 w-24">단위</th>
        <th class="py-3 px-3 min-w-[90px]">비고</th>
      \`;

      const tbody = document.getElementById('material-tbody');
      const emptyState = document.getElementById('empty-state');
      const sumBox = document.getElementById('item-summary-box');
      const sumGrid = document.getElementById('item-summary-grid');

      if (entries.length === 0) {
        tbody.innerHTML = '';
        sumBox.classList.add('hidden');
        emptyState.classList.remove('hidden');
        return;
      }
      emptyState.classList.add('hidden');
      sumBox.classList.remove('hidden');

      const gMap = new Map();
      entries.forEach(({ item }) => {
        const nm = (item.name || '').trim();
        const sp = (item.spec && item.spec !== '-') ? item.spec.trim() : '-';
        const sup = (item.supplier && item.supplier !== '-') ? item.supplier.trim() : '';
        const key = nm.toLowerCase() + '||' + sp.toLowerCase();
        if (!gMap.has(key)) gMap.set(key, { name: nm, spec: sp, sups: new Set(), count: 0, inSums: {}, totSums: {}, hasPack: false });
        const g = gMap.get(key);
        g.count += 1;
        if (sup) g.sups.add(sup);
        if (item.quantity > 0) {
          const u = item.unit || 'EA';
          g.inSums[u] = (g.inSums[u] || 0) + item.quantity;
          if (item.packQty > 0) {
            const su = item.subUnit || 'EA';
            g.hasPack = true;
            g.totSums[su] = (g.totSums[su] || 0) + (item.quantity * item.packQty);
          } else {
            g.totSums[u] = (g.totSums[u] || 0) + item.quantity;
          }
        }
      });

      const allGroups = Array.from(gMap.values());
      const nonZeroGroups = allGroups.filter(g => Object.keys(g.totSums).length > 0);
      const groups = nonZeroGroups.length > 0 ? nonZeroGroups : allGroups;
      document.getElementById('item-summary-title').innerText = '품목별 토탈 수량 (' + groups.length + '종)';

      const rowsHtml = groups.map((g, i) => {
        const supStr = g.sups.size > 0 ? Array.from(g.sups).join(', ') : '-';
        const inStr = Object.entries(g.inSums).map(([k, v]) => v.toLocaleString() + ' ' + k).join(', ') || '-';
        const totEntries = Object.entries(g.totSums);
        const totHtml = totEntries.length === 1
          ? \`<span class="text-base font-extrabold">\${totEntries[0][1].toLocaleString()}</span> <span class="text-xs font-bold">\${totEntries[0][0]}</span>\`
          : (totEntries.map(([k, v]) => v.toLocaleString() + ' ' + k).join(', ') || '-');
        return \`
          <tr class="\${i % 2 === 1 ? 'bg-slate-50/60' : 'bg-white'} divide-x divide-slate-200">
            <td class="py-2 px-2.5 text-center font-mono text-xs text-slate-500 w-12">\${i + 1}</td>
            <td class="py-2 px-3 text-center text-xs \${supStr !== '-' ? 'font-medium text-slate-800' : 'text-slate-400'} w-36">\${supStr}</td>
            <td class="py-2 px-3.5 text-left">
              <span class="font-bold text-sm text-slate-900">\${g.name}</span>
              \${g.count > 1 ? '<span class="text-xs font-semibold text-blue-700 ml-1.5">· ' + g.count + '회 합산</span>' : ''}
            </td>
            <td class="py-2 px-3 text-center text-xs text-slate-600 w-36">\${g.spec}</td>
            <td class="py-2 px-3 text-right font-mono text-xs font-semibold text-slate-700 whitespace-nowrap w-32">\${inStr}</td>
            <td class="py-2 px-4 text-right font-mono whitespace-nowrap bg-blue-50/55 \${g.hasPack || g.count > 1 ? 'text-blue-700' : 'text-slate-900'} w-44">\${totHtml}</td>
          </tr>
        \`;
      }).join('');

      sumGrid.innerHTML = \`
        <div class="rounded-lg border border-slate-300 overflow-hidden">
          <div class="overflow-auto max-h-[320px]">
            <table class="w-full border-collapse text-sm">
              <thead class="sticky top-0 z-10">
                <tr class="bg-slate-800 text-white text-xs font-bold divide-x divide-slate-600">
                  <th class="py-2.5 px-2.5 text-center w-12">No.</th>
                  <th class="py-2.5 px-3 text-center w-36">구매처</th>
                  <th class="py-2.5 px-3.5 text-left">자재 품목명</th>
                  <th class="py-2.5 px-3 text-center w-36">규격 / 사양</th>
                  <th class="py-2.5 px-3 text-right w-32">반입 수량</th>
                  <th class="py-2.5 px-4 text-right bg-blue-700 text-white w-44">토탈 수량</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-200">\${rowsHtml}</tbody>
            </table>
          </div>
        </div>
      \`;

      tbody.innerHTML = entries.map(({ item, sheetId, sheetName }, idx) => {
        const hasQty = item.quantity > 0;
        const hasPack = hasQty && item.packQty > 0;
        const conv = hasPack ? item.quantity * item.packQty : item.quantity;
        const finalUnit = hasPack ? (item.subUnit || 'EA') : item.unit;
        const supDisp = (item.supplier && item.supplier !== '-') ? item.supplier : '-';
        return \`
          <tr class="hover:bg-slate-50 \${idx % 2 === 1 ? 'bg-slate-50/60' : 'bg-white'} divide-x divide-slate-200">
            <td class="py-3 px-2 no-print">
              <button onclick="deleteItem('\${sheetId}', '\${item.id}')" class="px-2 py-1 rounded bg-rose-50 hover:bg-rose-600 text-rose-600 hover:text-white border border-rose-200 text-xs font-bold transition-colors">삭제</button>
            </td>
            <td class="py-2.5 px-2 font-mono text-xs text-slate-700 whitespace-nowrap">
              <div class="inline-flex items-center gap-1">
                <span>\${idx + 1}</span>
                \${activeTabId !== 'ALL' ? \`<span class="no-print inline-flex flex-col leading-none ml-1"><button onclick="moveItem('\${sheetId}', '\${item.id}', -1)" class="text-[10px] text-slate-400 hover:text-blue-600 px-0.5">▲</button><button onclick="moveItem('\${sheetId}', '\${item.id}', 1)" class="text-[10px] text-slate-400 hover:text-blue-600 px-0.5">▼</button></span>\` : ''}
              </div>
            </td>
            \${activeTabId === 'ALL' ? \`<td class="py-3 px-3 text-xs font-semibold text-slate-700">\${sheetName}</td>\` : ''}
            <td class="py-3 px-3 font-mono text-xs text-slate-700">\${item.date || ''}</td>
            <td class="py-3 px-3 text-xs \${supDisp !== '-' ? 'font-medium text-slate-800' : 'text-slate-400'}">\${supDisp}</td>
            <td class="py-3 px-4 text-left font-bold text-slate-900">\${item.name}</td>
            <td class="py-3 px-3 text-xs text-slate-700">\${item.spec || '-'}</td>
            <td class="py-3 px-3 font-mono \${hasQty ? 'font-bold text-slate-900' : 'text-slate-400'}">\${hasQty ? item.quantity.toLocaleString() : '-'}</td>
            <td class="py-3 px-3 text-xs \${hasQty ? 'text-slate-700' : 'text-slate-400'}">\${item.unit || '-'}</td>
            <td class="py-3 px-4 text-xs \${item.remarks ? 'text-left text-slate-600' : 'text-slate-400'}">\${item.remarks || '-'}</td>
          </tr>
        \`;
      }).join('');
    }

    loadData();
  </script>
</body>
</html>`;
  }, [sheets, siteName, showHtmlExportModal]);

  const handleDownloadHtmlFile = () => {
    const blob = new Blob([standaloneHtmlCode], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `(주)다인_용인사업부_반입반출대장_${new Date().toISOString().split('T')[0]}.html`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('대장 양식이 반영된 HTML 파일이 다운로드되었습니다.');
  };

  const handleCopyHtmlCode = () => {
    navigator.clipboard.writeText(standaloneHtmlCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2500);
    showToast('전체 HTML 코드가 클립보드에 복사되었습니다.');
  };

  const getSheetIcon = (sheet: MaterialSheet) => {
    const compact = sheet.name.replace(/\s+/g, '');
    if (
      sheet.id === 'sheet-cheongju-yongin' ||
      compact.includes('청주') ||
      compact.includes('이전')
    ) {
      return <ArrowRightLeft className="w-3.5 h-3.5 shrink-0" />;
    }
    if (
      sheet.id === 'sheet-yongin-direct' ||
      compact.includes('고안리') ||
      compact.includes('납품')
    ) {
      return <Truck className="w-3.5 h-3.5 shrink-0" />;
    }
    return <Boxes className="w-3.5 h-3.5 shrink-0" />;
  };

  const editModalPreviewTotal = useMemo(() => {
    if (!editingState) return null;
    const pq = parseFloat(editingState.packQtyInput);
    if (editingState.item.quantity > 0 && !isNaN(pq) && pq > 0) {
      return Math.round(editingState.item.quantity * pq * 1000) / 1000;
    }
    return null;
  }, [editingState]);

  return (
    <div
      className="min-h-screen bg-slate-50 text-slate-900 pb-16 relative"
      onDragOver={(e) => {
        if (showExcelImportModal || showReceiptScanModal) return;
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setIsWindowDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setIsWindowDragging(false);
      }}
      onDrop={(e) => {
        if (
          Date.now() - lastDirectDropTimeRef.current < 2000 ||
          fileDropTargetItem ||
          (e.target as HTMLElement)?.closest('tr') ||
          (e.target as HTMLElement)?.closest('table')
        ) {
          e.preventDefault();
          e.stopPropagation();
          setIsWindowDragging(false);
          setFileDropTargetItem(null);
          setDroppedSlipIntentFile(null);
          return;
        }

        if (showExcelImportModal || showReceiptScanModal || droppedSlipIntentFile) return;
        const file = e.dataTransfer.files?.[0];
        if (file) {
          e.preventDefault();
          setIsWindowDragging(false);
          setFileDropTargetItem(null);
          if (isImageFile(file)) {
            // Open intent modal so user can choose to attach to existing item or do new item AI scan
            setDroppedSlipIntentFile(file);
          } else if (/\.(xlsx|xls|csv)$/i.test(file.name) || file.type.includes('spreadsheet') || file.type.includes('excel')) {
            setDroppedExcelFile(file);
            setShowExcelImportModal(true);
          } else {
            showToast('전표 사진(JPG, PNG 등 이미지) 또는 엑셀 파일을 올려주세요.');
          }
        }
      }}
    >
      {/* Full-Window File Drop Overlay */}
      {isWindowDragging && !showExcelImportModal && !showReceiptScanModal && !droppedSlipIntentFile && (
        <div className="fixed inset-0 z-50 bg-blue-950/70 backdrop-blur-xs flex items-center justify-center p-6 pointer-events-none animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl border-2 border-dashed border-blue-500 px-8 py-9 text-center shadow-2xl max-w-xl">
            <div className="flex items-center justify-center gap-3 mb-3">
              <div className="w-12 h-12 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center">
                <Receipt className="w-6 h-6" />
              </div>
              <div className="w-12 h-12 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center">
                <FileSpreadsheet className="w-6 h-6" />
              </div>
            </div>
            <h3 className="text-lg font-bold text-slate-900">
              전표 사진 또는 엑셀 파일을 놓아주세요
            </h3>
            <p className="text-xs text-slate-500 mt-1 mb-4">
              기존 자재에 첨부할지, 신규 자재로 등록할지 간편하게 선택할 수 있습니다.
            </p>
            <div className="grid grid-cols-2 gap-3 text-left">
              <div className="p-3 bg-amber-50/90 rounded-xl border border-amber-300">
                <div className="font-bold text-xs text-amber-900 flex items-center gap-1.5 mb-1">
                  <span>📌 기존 자재에 전표 첨부</span>
                </div>
                <p className="text-[11px] text-amber-800 leading-relaxed">
                  표의 <strong>해당 품목 줄</strong>에 직접 놓으시면 새 품목 등록 없이 바로 연결됩니다.
                </p>
              </div>
              <div className="p-3 bg-blue-50/90 rounded-xl border border-blue-300">
                <div className="font-bold text-xs text-blue-900 flex items-center gap-1.5 mb-1">
                  <span>➕ 새 품목으로 자동 등록</span>
                </div>
                <p className="text-[11px] text-blue-800 leading-relaxed">
                  화면 빈 곳이나 여기에 놓으시면 기존 자재 선택창 또는 신규 스캔 창이 뜹니다.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification with Instant Undo */}
      {toastState && (
        <div className="fixed bottom-20 right-5 z-50 bg-slate-900 text-white px-4 py-3 rounded-xl shadow-xl border border-slate-700 flex items-center gap-3 text-xs max-w-md no-print animate-in fade-in slide-in-from-bottom-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span className="leading-snug">{toastState.message}</span>
          {toastState.canUndo && undoHistory.length > 0 && (
            <button
              type="button"
              onClick={handleUndoLastAction}
              className="ml-1 px-2.5 py-1 rounded-md bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold whitespace-nowrap transition-colors flex items-center gap-1 shrink-0"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>되돌리기</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setToastState(null)}
            className="text-slate-400 hover:text-white shrink-0"
            title="알림 닫기"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Clean Top Bar */}
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200 px-4 sm:px-6 py-3 no-print">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-3 sm:gap-6">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white shrink-0">
              <Boxes className="w-4 h-4" />
            </div>
            <span className="text-sm sm:text-lg font-bold tracking-tight text-slate-900 truncate">
              (주)다인_용인사업부 _반입 반출 대장
            </span>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 overflow-x-auto max-w-full">
            {/* Real-Time Shared Sync Status & Admin Backup/Migration Trigger (No Login UI) */}
            <div className="inline-flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() =>
                  syncStatus === 'error' || syncStatus === 'conflict'
                    ? void handleRetrySharedSync()
                    : setShowCloudSyncModal(true)
                }
                className={`inline-flex items-center gap-1.5 px-2.5 py-2 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                  syncStatus === 'cached_checking'
                    ? 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100'
                    : syncStatus === 'saving' || syncStatus === 'connecting'
                    ? 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100'
                    : syncStatus === 'saved'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                    : syncStatus === 'conflict'
                    ? 'bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100'
                    : 'bg-rose-50 text-rose-700 border-rose-300 hover:bg-rose-100'
                }`}
                title={
                  syncStatus === 'cached_checking'
                    ? '저장된 공용 대장 캐시를 먼저 표시하고 서버의 최신 데이터를 확인하는 중입니다'
                    : syncStatus === 'error'
                    ? `연결/저장 오류 (${syncError || ''}) · 클릭하여 다시 연결/재시도`
                    : syncStatus === 'conflict'
                    ? '동시 수정 충돌 감지 · 클릭하여 다시 시도 또는 백업/관리 창 열기'
                    : lastSyncedAt
                    ? `공용 대장 실시간 동기화됨 (${lastSyncedAt.toLocaleTimeString('ko-KR')})`
                    : '공용 대장 연결 중'
                }
              >
                {syncStatus === 'cached_checking' ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span className="hidden sm:inline">저장 자료 · 최신 확인 중</span>
                    <span className="sm:hidden">확인 중</span>
                  </>
                ) : syncStatus === 'saving' || syncStatus === 'connecting' ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>{syncStatus === 'connecting' ? '연결 중' : '저장 중'}</span>
                  </>
                ) : syncStatus === 'saved' ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>저장 완료</span>
                  </>
                ) : syncStatus === 'conflict' ? (
                  <>
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>충돌 감지</span>
                    <RefreshCw className="w-3 h-3 ml-0.5" />
                  </>
                ) : (
                  <>
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>{hasVerifiedServerData ? '저장 실패' : '연결 실패'}</span>
                    <RefreshCw className="w-3 h-3 ml-0.5" />
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => setShowCloudSyncModal(true)}
                className="inline-flex items-center gap-1.5 px-2.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
                title="공용 대장 백업(.json) 및 관리자 1회 이전 관리"
              >
                <HardDrive className="w-3.5 h-3.5 text-blue-600" />
                <span className="hidden lg:inline">백업 · 이전</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => setShowChatbotModal(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-white bg-linear-to-r from-blue-600 via-indigo-600 to-blue-700 hover:from-blue-700 hover:to-indigo-800 rounded-lg transition-all whitespace-nowrap shrink-0 shadow-xs border border-blue-400/30"
              title="Gemini AI 자재 상담 비서 열기 (자재 검수 기준, KS 규격, 안전 적재, 대장 자문)"
            >
              <Bot className="w-3.5 h-3.5 text-blue-200" />
              <span>AI 자재 상담</span>
              <span className="hidden md:inline-flex px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-emerald-500/20 text-emerald-200 border border-emerald-400/30">
                초고속 Lite
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setDroppedReceiptFile(null);
                setShowReceiptScanModal(true);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap shrink-0 shadow-xs"
              title="납품증·거래명세서·세금계산서 사진이나 텍스트를 AI로 분석하여 대장에 자동 등록"
            >
              <Receipt className="w-3.5 h-3.5 text-amber-300" />
              <span>전표 자동 등록</span>
            </button>

            <button
              type="button"
              onClick={() => setShowSlipArchiveModal(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-amber-900 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg transition-colors whitespace-nowrap shrink-0 shadow-xs"
              title="소장 중인 모든 전표(납품증/거래명세서) 원본 사진 보관함 보기"
            >
              <Receipt className="w-3.5 h-3.5 text-amber-600" />
              <span>전표 보관함</span>
              {headerSlipCount > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-amber-200 text-amber-900 font-mono font-bold text-[10px]">
                  {headerSlipCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                setDroppedExcelFile(null);
                setShowExcelImportModal(true);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
              title="직접 만든 엑셀 파일(.xlsx/.csv) 업로드 또는 셀 복사·붙여넣기로 자동 등록"
            >
              <Upload className="w-3.5 h-3.5 text-blue-600" />
              <span>엑셀 표 가져오기</span>
            </button>

            <button
              onClick={handleExportExcel}
              disabled={isExportingExcel}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-60"
              title="표 서식·테두리·시트 탭이 적용된 정식 엑셀(.xlsx) 다운로드"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
              <span className="hidden sm:inline">
                {isExportingExcel ? '생성 중...' : '엑셀 다운로드 (.xlsx)'}
              </span>
              <span className="sm:hidden">엑셀 저장</span>
            </button>

            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg transition-colors whitespace-nowrap shrink-0"
              title="인쇄 및 PDF 출력"
            >
              <Printer className="w-3.5 h-3.5" />
              <span className="hidden md:inline">인쇄</span>
            </button>

            <button
              onClick={() => setShowHtmlExportModal(true)}
              className="hidden sm:inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
              title="단일 HTML 파일 다운로드 및 코드 복사"
            >
              <Code className="w-3.5 h-3.5" />
              <span className="hidden lg:inline">싱글 HTML 내보내기</span>
              <span className="lg:hidden">HTML</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Workspace */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 pt-6">
        {/* Connection Error / Timeout Diagnostic Banner (Never hides failures as infinite loading) */}
        {syncStatus === 'error' && (
          <div className="mb-4 px-4 py-3.5 rounded-xl bg-rose-50 border border-rose-300 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-rose-950 no-print">
            <div className="flex items-start gap-2.5 min-w-0">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <div className="font-bold text-rose-900">
                  {connectionDiagnostic?.summary || '공용 데이터베이스 연결 또는 저장 오류'}
                </div>
                <p className="text-rose-800 mt-0.5 break-words">
                  {connectionDiagnostic?.detail || syncError || '네트워크 또는 서버 응답이 지연되고 있습니다.'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void handleRetrySharedSync()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold whitespace-nowrap shrink-0 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>다시 연결 / 재시도</span>
            </button>
          </div>
        )}

        {/* Non-blocking Cached Data Indicator while background server check completes */}
        {syncStatus === 'cached_checking' && isSharedCloudReady && (
          <div className="mb-4 px-4 py-2.5 rounded-xl bg-amber-50 border border-amber-200 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-900 no-print">
            <div className="flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-600 shrink-0" />
              <span className="font-semibold">
                저장된 자료 표시 중·최신 데이터 확인 중
              </span>
              {initialCache?.cachedAt && (
                <span className="text-amber-700 font-mono text-[11px]">
                  (캐시 시각: {new Date(initialCache.cachedAt).toLocaleTimeString('ko-KR')})
                </span>
              )}
            </div>
            <span className="text-[11px] text-amber-800">
              화면을 바로 조회하실 수 있으며 최신 서버 내용으로 자동 갱신됩니다.
            </span>
          </div>
        )}

        {/* Initial Shared Ledger Connection / Uninitialized Setup Banner */}
        {!isSharedCloudReady && syncStatus !== 'error' ? (
          <div className="mb-5 px-4 py-4 rounded-xl bg-blue-50 border border-blue-200 flex items-center gap-2.5 text-xs text-blue-900 no-print">
            <Loader2 className="w-4 h-4 animate-spin text-blue-600 shrink-0" />
            <span className="font-semibold">
              공용 클라우드 대장에 실시간 연결 중입니다...
            </span>
          </div>
        ) : hasVerifiedServerData && !sharedData?.cloudExists ? (
          <div className="mb-5 px-4 py-4 rounded-xl bg-amber-50 border border-amber-300 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-amber-950 no-print">
            <div className="flex items-start gap-2.5">
              <Cloud className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold">
                  아직 공용 클라우드 대장이 초기화되지 않았습니다.
                </div>
                <p className="text-amber-800 mt-0.5">
                  새 접속자의 로컬 자료가 자동으로 합쳐지지 않도록 보호되고 있습니다. 관리자가 기존 자료를 백업·이전하거나 기본 양식으로 시작해주세요.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setShowCloudSyncModal(true)}
                className="px-3.5 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-bold whitespace-nowrap transition-colors"
              >
                백업 및 공용 대장 이전
              </button>
              <button
                type="button"
                onClick={() => void handleInitializeFreshSharedLedger()}
                className="px-3.5 py-2 rounded-lg bg-white hover:bg-amber-100 text-amber-900 border border-amber-300 font-bold whitespace-nowrap transition-colors"
              >
                기본 양식으로 시작
              </button>
            </div>
          </div>
        ) : null}

        {/* Conflict Warning Banner when concurrent item edit conflict occurred */}
        {syncConflicts.length > 0 && (
          <div className="mb-4 px-4 py-3 rounded-xl bg-amber-50 border border-amber-300 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-amber-950 no-print">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>
                <strong>동시 수정 충돌 감지:</strong>{' '}
                {syncConflicts[0].itemName} ({syncConflicts[0].reason}) — 먼저 저장된 최신 내용으로 보존되었습니다.
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setShowCloudSyncModal(true)}
                className="px-2.5 py-1 rounded-md bg-amber-600 text-white font-bold"
              >
                상세 보기
              </button>
              <button
                type="button"
                onClick={() => {
                  setSyncConflicts([]);
                  setSyncStatus('saved');
                }}
                className="px-2.5 py-1 rounded-md bg-white border border-amber-300 text-amber-900 font-semibold"
              >
                닫기
              </button>
            </div>
          </div>
        )}
        {/* Site Context Header & Yongin Division Address */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 mb-5 no-print">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <input
              type="text"
              value={siteName}
              onChange={(e) => setSiteName(e.target.value)}
              placeholder="현장명 또는 프로젝트명을 입력하세요"
              className="text-sm sm:text-base font-bold text-slate-900 bg-transparent hover:bg-slate-200/60 focus:bg-white px-2 py-1 -ml-2 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[260px] sm:min-w-[340px]"
              title="클릭하여 관리 제목 수정"
            />
            <span aria-hidden="true">·</span>
            <span>
              {new Date().toLocaleDateString('ko-KR', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                weekday: 'short',
              })}
            </span>
          </div>

          <div className="inline-flex flex-wrap items-center gap-2 bg-white border border-slate-200 rounded-xl px-3.5 py-2 text-xs sm:text-sm text-slate-700 self-start lg:self-auto">
            <MapPin className="w-4 h-4 text-blue-600 shrink-0" />
            <span className="font-semibold text-slate-900 whitespace-nowrap">용인사업부 주소 :</span>
            <span className="font-medium text-slate-800">{YONGIN_ADDRESS}</span>
            <button
              type="button"
              onClick={handleCopyAddress}
              className="ml-0.5 inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md transition-colors whitespace-nowrap shrink-0"
              title="용인사업부 주소 복사"
            >
              {copiedAddress ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>복사됨</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>복사</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Print Only Formal Ledger Banner (Matches Excel Header Box) */}
        <div className="hidden print:block mb-5 border-2 border-slate-800">
          <div className="bg-slate-100 py-3 px-4 text-center border-b border-slate-300">
            <h1 className="text-lg font-bold text-slate-900">
              (주)다인_용인사업부 _반입 반출 대장 [
              {activeSheet
                ? activeSheet.name
                : activeTabId === FAVORITE_MATERIALS_TAB_ID
                ? '통합보기 [자재]'
                : '전체 통합 현황'}
              ]
            </h1>
          </div>
          <div className="grid grid-cols-2 divide-x divide-slate-300 text-xs py-2 px-3 bg-white">
            <div className="text-center font-bold text-blue-900">
              용인사업부 주소 : {YONGIN_ADDRESS}
            </div>
            <div className="text-center text-slate-600">
              {activeSheet?.name.includes('이전')
                ? ''
                : `${
                    siteName && siteName !== '용인공장 이전 및 신규 발주 자재 반입 관리'
                      ? siteName
                      : '신규 발주 자재 반입 관리'
                  } | 출력일: ${new Date().toISOString().split('T')[0]}`}
            </div>
          </div>
        </div>

        {/* Multi-Sheet Tab Bar */}
        <section className="mb-6 no-print" aria-label="시트 선택 탭">
          <div className="bg-white rounded-xl border border-slate-200 p-2">
            <div className="flex items-center justify-between gap-2 overflow-x-auto pb-1 sm:pb-0">
              <div className="flex items-center gap-1.5">
                {sheets.map((sheet) => {
                  const isActive = activeTabId === sheet.id;
                  return (
                    <button
                      key={sheet.id}
                      type="button"
                      onClick={() => setActiveTabId(sheet.id)}
                      className={`min-h-[42px] px-3.5 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-colors flex items-center gap-2 whitespace-nowrap shrink-0 ${
                        isActive
                          ? 'bg-blue-600 text-white shadow-xs'
                          : 'text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      {getSheetIcon(sheet)}
                      <span>{sheet.name}</span>
                      <span
                        className={`font-mono tabular-nums text-xs ${
                          isActive ? 'text-blue-100' : 'text-slate-400'
                        }`}
                      >
                        {sheet.items.length}
                      </span>
                    </button>
                  );
                })}

                <div className="w-px h-6 bg-slate-200 mx-1 shrink-0" />

                <button
                  type="button"
                  onClick={() => setActiveTabId('ALL')}
                  className={`min-h-[42px] px-3.5 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-colors flex items-center gap-2 whitespace-nowrap shrink-0 ${
                    activeTabId === 'ALL'
                      ? 'bg-slate-900 text-white shadow-xs'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5 shrink-0" />
                  <span>전체 통합 보기</span>
                  <span
                    className={`font-mono tabular-nums text-xs ${
                      activeTabId === 'ALL' ? 'text-slate-300' : 'text-slate-400'
                    }`}
                  >
                    {totalItemsForIntegratedView}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTabId(FAVORITE_MATERIALS_TAB_ID)}
                  className={`min-h-[42px] px-3.5 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-colors flex items-center gap-2 whitespace-nowrap shrink-0 ${
                    activeTabId === FAVORITE_MATERIALS_TAB_ID
                      ? 'bg-amber-500 text-slate-950 shadow-xs'
                      : 'text-amber-900 bg-amber-50/80 border border-amber-200 hover:bg-amber-100'
                  }`}
                  title="즐겨찾기(★) 등록한 품목을 모아서 보고 자재를 누르면 총 반입 수량을 즉시 확인합니다"
                >
                  <Star
                    className={`w-3.5 h-3.5 shrink-0 ${
                      activeTabId === FAVORITE_MATERIALS_TAB_ID
                        ? 'fill-slate-950 text-slate-950'
                        : 'fill-amber-400 text-amber-500'
                    }`}
                  />
                  <span>통합보기 [자재]</span>
                  <span
                    className={`font-mono tabular-nums text-xs ${
                      activeTabId === FAVORITE_MATERIALS_TAB_ID
                        ? 'text-slate-900 font-bold'
                        : 'text-amber-700'
                    }`}
                  >
                    {favoriteMaterialGroups.length}종
                  </span>
                </button>
              </div>

              <button
                type="button"
                onClick={() =>
                  setSheetModal({
                    mode: 'create',
                    name: '',
                    subtitle: '',
                  })
                }
                className="min-h-[40px] px-3 py-1.5 rounded-lg text-xs font-semibold text-blue-700 hover:bg-blue-50 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
                title="새 시트 탭 추가"
              >
                <FolderPlus className="w-4 h-4" />
                <span>새 시트 추가</span>
              </button>
            </div>

            <div className="mt-2 pt-2.5 px-2 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-slate-600">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-900">
                  {activeSheet
                    ? activeSheet.name
                    : activeTabId === FAVORITE_MATERIALS_TAB_ID
                    ? '통합보기 [자재] · 즐겨찾기 전용 시트'
                    : '전체 시트 통합 보기'}
                </span>
                <span aria-hidden="true" className="text-slate-300">
                  ·
                </span>
                <span className="text-slate-500">
                  {activeSheet
                    ? activeSheet.subtitle
                    : activeTabId === FAVORITE_MATERIALS_TAB_ID
                    ? '별표(☆)로 즐겨찾기한 품목이 이곳으로 자동 모입니다. 자재를 누르면 총 반입 수량이 딱 표시됩니다.'
                    : `총 ${integratedSheets.length}개 시트(${integratedSheets.map((s) => s.name).join(', ')})의 자재를 통합 조회합니다. 자재를 누르면 총 반입 수량을 바로 확인할 수 있습니다. (사무용품 시트 제외)`}
                </span>
              </div>

              {activeSheet && (
                <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                  {sheets.length > 1 && (
                    <div className="inline-flex items-center gap-0.5 bg-slate-100 rounded-md p-0.5">
                      <button
                        type="button"
                        disabled={sheets.findIndex((s) => s.id === activeSheet.id) === 0}
                        onClick={() => moveSheetTab(activeSheet.id, 'left')}
                        className="p-1 rounded text-slate-500 hover:text-slate-900 hover:bg-white disabled:opacity-30 transition-colors"
                        title="시트 탭 순서 앞으로 이동"
                      >
                        <ChevronLeft className="w-3.5 h-3.5" />
                      </button>
                      <span className="text-[11px] font-medium text-slate-500 px-1">탭 순서</span>
                      <button
                        type="button"
                        disabled={
                          sheets.findIndex((s) => s.id === activeSheet.id) === sheets.length - 1
                        }
                        onClick={() => moveSheetTab(activeSheet.id, 'right')}
                        className="p-1 rounded text-slate-500 hover:text-slate-900 hover:bg-white disabled:opacity-30 transition-colors"
                        title="시트 탭 순서 뒤로 이동"
                      >
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() =>
                      setSheetModal({
                        mode: 'edit',
                        sheetId: activeSheet.id,
                        name: activeSheet.name,
                        subtitle: activeSheet.subtitle,
                      })
                    }
                    className="text-slate-500 hover:text-blue-600 font-medium flex items-center gap-1 transition-colors whitespace-nowrap"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>시트 이름 수정</span>
                  </button>
                  {sheets.length > 1 && (
                    <>
                      <span aria-hidden="true" className="text-slate-300">
                        ·
                      </span>
                      <button
                        type="button"
                        onClick={() => handleDeleteSheet(activeSheet)}
                        className="text-slate-400 hover:text-rose-600 font-medium flex items-center gap-1 transition-colors whitespace-nowrap"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>시트 삭제</span>
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* 품목별 토탈 수량 요약 (불필요한 보기 전환 제거 · 깔끔한 단일 요약 대장표) */}
        {itemSummaryGroups.length > 0 && (
          <section className="bg-white rounded-xl border border-slate-300 p-4 sm:p-5 mb-5 shadow-xs">
            <div
              className={`flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 ${
                isItemSummaryOpen ? 'pb-3 mb-3 border-b border-slate-200' : ''
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsItemSummaryOpen((prev) => !prev)}
                  className="inline-flex items-center gap-2 text-base sm:text-lg font-extrabold text-slate-900 hover:text-blue-700 transition-colors"
                >
                  <Package className="w-5 h-5 text-blue-600 shrink-0" />
                  <span>품목별 토탈 수량</span>
                  {isItemSummaryOpen ? (
                    <ChevronUp className="w-4 h-4 text-slate-500 no-print" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-slate-500 no-print" />
                  )}
                </button>
                <span className="text-xs text-slate-500">
                  총 <strong className="font-semibold text-slate-800">{visibleItemSummaryGroups.length}</strong>종
                  {repeatedItemGroupsCount > 0 && (
                    <span className="text-blue-700 font-semibold">
                      {' '}· 중복 반입 {repeatedItemGroupsCount}종 자동 합산
                    </span>
                  )}
                  <span className="hidden lg:inline no-print">
                    {isIntegratedView
                      ? ' · 자재를 클릭하면 총 몇 개 들어왔는지 합계 수량이 바로 나옵니다'
                      : ' · 품목 행 클릭 시 아래 대장에서 해당 품목만 모아봅니다'}
                  </span>
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs no-print">
                {searchTerm && (
                  <button
                    type="button"
                    onClick={() => setSearchTerm('')}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-50 text-blue-700 border border-blue-200 font-semibold hover:bg-blue-100 transition-colors"
                  >
                    <span>&lsquo;{searchTerm}&rsquo; 필터 해제</span>
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}

                {isItemSummaryOpen && itemSummaryGroups.length > 5 && (
                  <>
                    <div className="relative w-44 sm:w-52">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="text"
                        value={summarySearch}
                        onChange={(e) => setSummarySearch(e.target.value)}
                        placeholder="품목·구매처 빠른 찾기..."
                        className="w-full pl-8 pr-7 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:border-blue-500 outline-none transition-colors"
                      />
                      {summarySearch && (
                        <button
                          type="button"
                          onClick={() => setSummarySearch('')}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                          title="검색어 지우기"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    <select
                      value={summarySortMode}
                      onChange={(e) =>
                        setSummarySortMode(e.target.value as 'ledger' | 'qty_desc' | 'name')
                      }
                      className="px-2.5 py-1.5 text-xs bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-slate-700 font-medium outline-none focus:border-blue-500"
                      title="토탈 수량 정렬 기준"
                    >
                      <option value="ledger">대장 순서</option>
                      <option value="qty_desc">토탈 수량 많은순</option>
                      <option value="name">품목명 가나다순</option>
                    </select>
                  </>
                )}

                <button
                  type="button"
                  onClick={() => setIsItemSummaryOpen((prev) => !prev)}
                  className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold whitespace-nowrap transition-colors"
                >
                  {isItemSummaryOpen ? '접기' : '펼치기'}
                </button>
              </div>
            </div>

            {isItemSummaryOpen && (
              <div>
                {visibleItemSummaryGroups.length === 0 ? (
                  <div className="py-6 text-center text-xs text-slate-500 bg-slate-50 rounded-lg border border-slate-200">
                    검색 조건에 해당하는 품목이 없습니다.
                  </div>
                ) : (
                  <div className="rounded-lg border border-slate-300 overflow-hidden bg-white">
                    <div className="overflow-auto max-h-[340px] print:max-h-none print:overflow-visible">
                      <table className="w-full border-collapse text-sm">
                        <thead className="sticky top-0 z-10 print:static">
                          <tr className="bg-slate-800 text-white text-xs font-bold divide-x divide-slate-600">
                            <th className="py-2.5 px-2.5 text-center w-12">No.</th>
                            <th className="py-2.5 px-3 text-center w-32 sm:w-40 whitespace-nowrap">
                              구매처
                            </th>
                            <th className="py-2.5 px-3.5 text-left min-w-[180px]">자재 품목명</th>
                            <th className="py-2.5 px-3 text-center w-32 sm:w-40 whitespace-nowrap">
                              규격 / 사양
                            </th>
                            <th className="py-2.5 px-3 text-right w-32 sm:w-36 whitespace-nowrap">
                              반입 수량
                            </th>
                            <th className="py-2.5 px-4 text-right w-36 sm:w-44 whitespace-nowrap bg-blue-700 text-white">
                              토탈 수량
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                          {visibleItemSummaryGroups.map((group, idx) => {
                            const isFilteredToThis =
                              searchTerm.trim().toLowerCase() === group.name.toLowerCase();
                            const supplierDisplay =
                              group.suppliers.length > 0 ? group.suppliers.join(', ') : '-';
                            const specDisplay =
                              group.spec && group.spec !== '-' ? group.spec : '-';
                            const isZeroQty = group.totalSummaryText === '-';
                            const isHighlightedTotal =
                              !isZeroQty && (group.hasPackConversion || group.entryCount > 1);

                            return (
                              <tr
                                key={group.key}
                                onClick={() => {
                                  if (isIntegratedView) {
                                    setInspectedMaterialTarget({
                                      name: group.name,
                                      spec: specDisplay,
                                    });
                                  } else {
                                    setSearchTerm((prev) =>
                                      prev.trim().toLowerCase() === group.name.toLowerCase()
                                        ? ''
                                        : group.name
                                    );
                                  }
                                }}
                                className={`divide-x divide-slate-200 cursor-pointer transition-colors ${
                                  isFilteredToThis
                                    ? 'bg-blue-100/75 hover:bg-blue-100'
                                    : group.entryCount > 1
                                    ? 'bg-blue-50/35 hover:bg-blue-50/70'
                                    : idx % 2 === 1
                                    ? 'bg-slate-50/60 hover:bg-slate-100/80'
                                    : 'bg-white hover:bg-slate-50'
                                }`}
                                title={
                                  isIntegratedView
                                    ? '클릭하면 이 자재가 총 몇 개 들어왔는지 합계 수량이 바로 표시됩니다'
                                    : '클릭하면 아래 대장에서 이 품목만 필터링합니다 (다시 클릭 시 해제)'
                                }
                              >
                                <td className="py-2 px-2.5 text-center font-mono tabular-nums text-xs text-slate-500">
                                  {idx + 1}
                                </td>

                                <td
                                  className={`py-2 px-3 text-center text-xs ${
                                    supplierDisplay !== '-'
                                      ? 'font-medium text-slate-800'
                                      : 'text-slate-400'
                                  }`}
                                >
                                  {supplierDisplay}
                                </td>

                                <td className="py-2 px-3.5 text-left">
                                  <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                                    <span className="font-bold text-sm text-slate-900 break-words">
                                      {group.name}
                                    </span>
                                    {group.entryCount > 1 && (
                                      <span className="text-xs font-mono tabular-nums font-bold text-blue-700">
                                        · {group.entryCount}회 합산
                                      </span>
                                    )}
                                    {isFilteredToThis && (
                                      <span className="text-[11px] font-bold text-blue-700 underline underline-offset-2 no-print">
                                        · 필터 적용중
                                      </span>
                                    )}
                                  </div>
                                </td>

                                <td className="py-2 px-3 text-center text-xs text-slate-600">
                                  {specDisplay}
                                </td>

                                <td className="py-2 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                                  <span
                                    className={
                                      group.inboundSummaryWithUnit === '-'
                                        ? 'text-xs text-slate-400'
                                        : 'text-xs sm:text-sm font-semibold text-slate-700'
                                    }
                                  >
                                    {group.inboundSummaryWithUnit}
                                  </span>
                                  {group.hasPackConversion && group.packDisplay !== '-' && (
                                    <span className="text-[11px] text-slate-500 ml-1">
                                      (×{group.packDisplay})
                                    </span>
                                  )}
                                </td>

                                <td
                                  className={`py-2 px-4 text-right font-mono tabular-nums whitespace-nowrap ${
                                    isFilteredToThis ? 'bg-blue-100/90' : 'bg-blue-50/55'
                                  }`}
                                >
                                  {isZeroQty ? (
                                    <span className="text-xs text-slate-400">-</span>
                                  ) : group.singleTotalQty !== null &&
                                    group.singleTotalUnit !== null ? (
                                    <span
                                      className={`inline-flex items-baseline justify-end gap-1 ${
                                        isHighlightedTotal ? 'text-blue-700' : 'text-slate-900'
                                      }`}
                                    >
                                      <span className="text-base sm:text-[17px] font-extrabold tracking-tight">
                                        {group.singleTotalQty.toLocaleString()}
                                      </span>
                                      <span className="text-xs font-bold opacity-85">
                                        {group.singleTotalUnit}
                                      </span>
                                    </span>
                                  ) : (
                                    <span
                                      className={`text-sm sm:text-base font-extrabold ${
                                        isHighlightedTotal ? 'text-blue-700' : 'text-slate-900'
                                      }`}
                                    >
                                      {group.totalSummaryText}
                                    </span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {/* Global Autocomplete Datalists (Available across Form, Inline Table Edit, Batch Bar & Modal) */}
        <datalist id="existing-material-datalist">
          {quickRepeatTemplates.map((tpl) => (
            <option key={tpl.id} value={tpl.name} />
          ))}
        </datalist>
        <datalist id="existing-supplier-datalist">
          {existingSuppliers.map((sup) => (
            <option key={sup} value={sup} />
          ))}
        </datalist>

        {/* Add Material Form (Collapsible + Auto-Favorites for Repeated Inbound Materials) */}
        <section className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 mb-5 no-print">
          <div
            className={`flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${
              isFormCollapsed ? 'mb-3' : 'mb-3.5 pb-3 border-b border-slate-100'
            }`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setIsFormCollapsed((prev) => !prev)}
                className="inline-flex items-center gap-1.5 text-sm sm:text-base font-bold text-slate-900 hover:text-blue-700 transition-colors"
                title={isFormCollapsed ? '새 자재 등록 입력창 펼치기' : '표를 넓게 보도록 입력창 접기'}
              >
                <span>새 자재 등록</span>
                {isFormCollapsed ? (
                  <ChevronDown className="w-4 h-4 text-slate-500" />
                ) : (
                  <ChevronUp className="w-4 h-4 text-slate-500" />
                )}
              </button>
              <span aria-hidden="true" className="text-slate-300">
                ·
              </span>
              {activeSheet ? (
                <span className="text-xs font-semibold text-blue-700">
                  [{activeSheet.name}] 시트에 추가됩니다
                </span>
              ) : (
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="text-slate-500">저장할 시트 선택:</span>
                  <select
                    value={targetSheetIdForAllView}
                    onChange={(e) => setTargetSheetIdForAllView(e.target.value)}
                    className="px-2 py-1 text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded-md outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {(integratedSheets.length > 0 ? integratedSheets : sheets).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {!isFormCollapsed && matchedExistingGroupForForm && (
                <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-md">
                  기존 반입 {matchedExistingGroupForForm.entryCount}회 누적:{' '}
                  {matchedExistingGroupForForm.inboundSummaryWithUnit} (총{' '}
                  {matchedExistingGroupForForm.totalSummaryText})
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {!isFormCollapsed && liveFormTotal !== null ? (
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-blue-50 border border-blue-200 text-xs font-mono tabular-nums font-bold text-blue-700">
                  <span>
                    총 수량 자동 계산: {parseFloat(quantity).toLocaleString()} {unit || '파레트'} ×{' '}
                    {parseFloat(packQty).toLocaleString()} {subUnit || 'EA'} ={' '}
                    {liveFormTotal.toLocaleString()} {subUnit || 'EA'}
                  </span>
                </div>
              ) : !isFormCollapsed ? (
                <span className="text-xs text-slate-500 hidden xl:inline">
                  * 2회 이상 반입된 자재는 상단 즐겨찾기에 자동 등록됩니다
                </span>
              ) : null}

              <button
                type="button"
                onClick={() => {
                  setDroppedReceiptFile(null);
                  setShowReceiptScanModal(true);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors whitespace-nowrap shadow-xs"
                title="납품증·거래명세서 사진이나 텍스트를 AI로 분석하여 대장에 자동 등록"
              >
                <Receipt className="w-3.5 h-3.5 text-blue-600" />
                <span>전표(납품증/거래명세서) AI 등록</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setDroppedExcelFile(null);
                  setShowExcelImportModal(true);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                <span>엑셀 파일 / 복사·붙여넣기로 일괄 등록</span>
              </button>

              <button
                type="button"
                onClick={() => setIsFormCollapsed((prev) => !prev)}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-600 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors whitespace-nowrap"
              >
                {isFormCollapsed ? (
                  <>
                    <Maximize2 className="w-3.5 h-3.5" />
                    <span>입력창 펼치기</span>
                  </>
                ) : (
                  <>
                    <Minimize2 className="w-3.5 h-3.5" />
                    <span>입력창 접기 (표 넓게 보기)</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* ★ 반복 반입 자재 자동 즐겨찾기 바 (2회 이상 반입 시 자동 노출 + ☆ 수동 고정 지원) */}
          {favoriteItems.length > 0 ? (
            <div
              className={`rounded-lg border border-amber-200 bg-amber-50/55 px-3.5 py-2.5 ${
                isFormCollapsed ? '' : 'mb-4'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-400 shrink-0" />
                  <span className="font-bold text-slate-900">
                    즐겨찾기 · 반복 반입 자재 빠른 선택 ({favoriteItems.length})
                  </span>
                  <span className="text-slate-400 hidden sm:inline">·</span>
                  <span className="text-[11px] text-slate-600 hidden sm:inline">
                    클릭 시 품목명·구매처·규격·단위·입수량이 자동 입력되고 수량 칸으로 이동합니다
                  </span>
                </div>

                {!isIntegratedView && sheets.length > 1 && (
                  <div className="inline-flex items-center bg-white border border-amber-200 rounded-md p-0.5 text-[11px]">
                    <button
                      type="button"
                      onClick={() => setFavoriteScope('sheet')}
                      className={`px-2 py-0.5 rounded transition-colors ${
                        favoriteScope === 'sheet'
                          ? 'bg-amber-500 text-white font-semibold'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      현재 시트
                    </button>
                    <button
                      type="button"
                      onClick={() => setFavoriteScope('all')}
                      className={`px-2 py-0.5 rounded transition-colors ${
                        favoriteScope === 'all'
                          ? 'bg-amber-500 text-white font-semibold'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      전체 시트 ({allCrossSheetFavoriteCount})
                    </button>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {favoriteItems.map((group) => {
                  const isSelectedInForm =
                    name.trim().toLowerCase() === group.name.toLowerCase() &&
                    (spec.trim() || '-') === group.spec;
                  return (
                    <div
                      key={group.key}
                      className={`inline-flex items-center rounded-md border transition-colors ${
                        isSelectedInForm
                          ? 'bg-blue-600 text-white border-blue-600 shadow-2xs'
                          : 'bg-white hover:bg-amber-50 text-slate-800 border-amber-300/90'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => applyFavoriteGroupToForm(group)}
                        className="px-2.5 py-1.5 text-xs flex items-center gap-1.5 text-left whitespace-nowrap"
                        title={`클릭 시 '${group.name}' 자동 채움 (누적 ${group.entryCount}회 · 토탈 ${group.totalSummaryText})`}
                      >
                        <Star
                          className={`w-3 h-3 shrink-0 ${
                            isSelectedInForm
                              ? 'text-amber-300 fill-amber-300'
                              : 'text-amber-500 fill-amber-400'
                          }`}
                        />
                        <span className="font-bold">{group.name}</span>
                        {group.spec !== '-' && (
                          <span
                            className={`text-[11px] ${
                              isSelectedInForm ? 'text-blue-100' : 'text-slate-500'
                            }`}
                          >
                            ({group.spec})
                          </span>
                        )}
                        {group.latestSupplier && (
                          <span
                            className={`text-[11px] ${
                              isSelectedInForm ? 'text-blue-100' : 'text-slate-500'
                            }`}
                          >
                            · {group.latestSupplier}
                          </span>
                        )}
                        <span
                          className={`font-mono tabular-nums text-[11px] font-bold ${
                            isSelectedInForm ? 'text-amber-200' : 'text-blue-700'
                          }`}
                        >
                          · {group.entryCount}회
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          toggleFavoriteByKey(group.key, group.name, group.entryCount)
                        }
                        className={`px-1.5 py-1.5 border-l text-[11px] transition-colors ${
                          isSelectedInForm
                            ? 'border-blue-500 text-blue-200 hover:text-white hover:bg-blue-700'
                            : 'border-amber-200 text-slate-400 hover:text-rose-600 hover:bg-rose-50'
                        }`}
                        title="즐겨찾기 바에서 숨기기"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div
              className={`rounded-lg border border-slate-200 bg-slate-50/80 px-3.5 py-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 ${
                isFormCollapsed ? '' : 'mb-4'
              }`}
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <Star className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                <span className="font-semibold text-slate-700">반복 반입 즐겨찾기:</span>
                <span>
                  동일 자재가 <strong className="font-semibold text-slate-900">2회 이상 반입</strong>되면 이곳에 자동으로 즐겨찾기 버튼이 생성됩니다.
                </span>
                <span className="text-slate-400 hidden md:inline">
                  (아래 대장 품목명 옆 ☆ 아이콘으로 1회 반입 자재도 미리 고정 가능)
                </span>
              </div>
              {!isIntegratedView && favoriteScope === 'sheet' && allCrossSheetFavoriteCount > 0 && (
                <button
                  type="button"
                  onClick={() => setFavoriteScope('all')}
                  className="px-2.5 py-1 rounded-md bg-white hover:bg-amber-50 border border-amber-300 text-amber-800 font-semibold whitespace-nowrap transition-colors"
                >
                  다른 시트 포함 즐겨찾기 보기 ({allCrossSheetFavoriteCount}건)
                </button>
              )}
            </div>
          )}

          {!isFormCollapsed && (
            <>
              {formError && (
                <div className="mb-4 px-3 py-2 rounded-lg bg-rose-50 border border-rose-200 text-xs font-medium text-rose-700 flex items-center justify-between">
                  <span>{formError}</span>
                  <button
                    type="button"
                    onClick={() => setFormError(null)}
                    className="text-rose-500 hover:text-rose-700"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              <form onSubmit={handleAddItem} className="space-y-3.5">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3">
                  {/* 반입일자 */}
                  <div className="lg:col-span-2">
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      반입일자
                    </label>
                    <input
                      type="date"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                      className="w-full px-3 py-2.5 text-sm font-mono tabular-nums bg-slate-50 hover:bg-white focus:bg-white border border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 rounded-lg outline-none transition-colors"
                    />
                  </div>

                  {/* 구매처 */}
                  <div className="lg:col-span-2">
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      구매처 <span className="text-slate-400 font-normal">(선택)</span>
                    </label>
                    <input
                      type="text"
                      lang="ko"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      style={{ imeMode: 'active' }}
                      value={supplier}
                      onChange={(e) => setSupplier(e.target.value)}
                      placeholder="예: 대원강업 / 자체이전"
                      className="w-full px-3 py-2.5 text-sm bg-slate-50 hover:bg-white focus:bg-white border border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 rounded-lg outline-none transition-colors"
                    />
                  </div>

                  {/* 자재 품목명 */}
                  <div className="lg:col-span-3">
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      자재 품목명 <span className="text-rose-500">*</span>
                    </label>
                    <div className="relative">
                      <input
                        ref={nameInputRef}
                        type="text"
                        required
                        lang="ko"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        style={{ imeMode: 'active' }}
                        value={name}
                        onChange={(e) => {
                          const nextName = e.target.value;
                          setName(nextName);
                          const exactMatch = quickRepeatTemplates.find(
                            (t) => t.name.toLowerCase() === nextName.trim().toLowerCase()
                          );
                          if (exactMatch && !packQty && !spec) {
                            if (
                              exactMatch.supplier &&
                              exactMatch.supplier !== '-' &&
                              exactMatch.supplier !== '용인공장 직발주 납품처' &&
                              exactMatch.supplier !== '현장 납품처' &&
                              !supplier
                            ) {
                              setSupplier(exactMatch.supplier);
                            }
                            if (exactMatch.spec && exactMatch.spec !== '-') {
                              setSpec(exactMatch.spec);
                            }
                            if (exactMatch.unit && exactMatch.unit !== '-') {
                              setUnit(exactMatch.unit);
                            }
                            if (exactMatch.packQty) {
                              setPackQty(String(exactMatch.packQty));
                              setSubUnit(exactMatch.subUnit || 'EA');
                            }
                          }
                        }}
                        placeholder={formPlaceholders.name}
                        className="w-full px-3 py-2.5 text-sm bg-slate-50 hover:bg-white focus:bg-white border border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 rounded-lg outline-none transition-colors"
                      />
                    </div>
                  </div>



                  {/* 규격 / 사양 */}
                  <div className="lg:col-span-2">
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      규격 / 사양 <span className="text-slate-400 font-normal">(선택)</span>
                    </label>
                    <input
                      type="text"
                      value={spec}
                      onChange={(e) => setSpec(e.target.value)}
                      placeholder={formPlaceholders.spec}
                      className="w-full px-3 py-2.5 text-sm bg-slate-50 hover:bg-white focus:bg-white border border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 rounded-lg outline-none transition-colors"
                    />
                  </div>

                  {/* 반입 수량 + 단위 */}
                  <div className="lg:col-span-3">
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      반입 수량 / 단위 <span className="text-rose-500">*</span>
                    </label>
                    <div className="flex gap-1.5">
                      <input
                        ref={qtyInputRef}
                        type="number"
                        step="any"
                        min="0.001"
                        required
                        value={quantity}
                        onChange={(e) => setQuantity(e.target.value)}
                        placeholder="예: 5"
                        className="w-full px-2.5 py-2.5 text-sm font-mono tabular-nums font-semibold bg-slate-50 hover:bg-white focus:bg-white border border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 rounded-lg outline-none transition-colors"
                      />
                      <input
                        type="text"
                        value={unit}
                        onChange={(e) => setUnit(e.target.value)}
                        placeholder="파레트"
                        className="w-20 shrink-0 px-2 py-2.5 text-xs font-semibold text-center bg-slate-50 hover:bg-white focus:bg-white border border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 rounded-lg outline-none transition-colors"
                      />
                    </div>
                  </div>
                </div>

                {/* Quick Unit Selector Buttons */}
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                  <span className="text-[11px] text-slate-400 mr-1">단위 빠른 선택:</span>
                  {COMMON_UNITS.map((u) => (
                    <button
                      key={u}
                      type="button"
                      onClick={() => setUnit(u)}
                      className={`px-2.5 py-1 rounded-md text-xs transition-colors whitespace-nowrap ${
                        unit === u
                          ? 'bg-blue-600 text-white font-semibold'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {u}
                    </button>
                  ))}
                </div>

                {/* Row 2: 비고 + 자재 추가 버튼 */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3 pt-0.5">
                  <div className="lg:col-span-10">
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      비고 <span className="text-slate-400 font-normal">(선택)</span>
                    </label>
                    <input
                      type="text"
                      value={remarks}
                      onChange={(e) => setRemarks(e.target.value)}
                      placeholder={formPlaceholders.remarks}
                      className="w-full px-3 py-2.5 text-sm bg-slate-50 hover:bg-white focus:bg-white border border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 rounded-lg outline-none transition-colors"
                    />
                  </div>

                  <div className="sm:col-span-2 lg:col-span-2 flex items-end">
                    <button
                      type="submit"
                      className="w-full min-h-[42px] py-2.5 px-4 bg-blue-600 hover:bg-blue-700 active:scale-[0.98] text-white font-semibold text-sm rounded-lg transition-all flex items-center justify-center gap-1.5 whitespace-nowrap"
                    >
                      <Plus className="w-4 h-4" />
                      <span>자재 추가</span>
                    </button>
                  </div>
                </div>
              </form>
            </>
          )}
        </section>

        {/* Table Control & Quick Delete / Batch Management Toolbar */}
        <div className="bg-white rounded-xl border border-slate-200 p-3 sm:p-3.5 mb-3 space-y-2.5 no-print">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-bold text-slate-900">
                반입 상세 대장 ({filteredEntries.length}건)
              </span>
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 font-semibold hover:bg-blue-100"
                >
                  <span>&lsquo;{searchTerm}&rsquo; 필터 해제</span>
                  <X className="w-3 h-3" />
                </button>
              )}
              <span className="text-[11px] text-slate-500 hidden md:inline">
                · 셀 클릭 시 즉시 수정 · 드래그/▲▼/번호클릭 순서 변경 · 1클릭 즉시 삭제
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 sm:flex-initial sm:w-64">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="품목명, 구매처, 규격, 단위, 비고 검색..."
                  className="w-full pl-9 pr-7 py-2 text-xs bg-slate-50 focus:bg-white border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition-colors"
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

              <select
                value={sortOrder}
                onChange={(e) =>
                  setSortOrder(
                    e.target.value as 'created' | 'date_asc' | 'newest' | 'name' | 'quantity'
                  )
                }
                className="px-2.5 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-700 outline-none focus:ring-2 focus:ring-blue-100"
                title="정렬 기준 선택"
              >
                <option value="created">반입 순서 (직접 변경)</option>
                <option value="date_asc">반입일자 빠른순</option>
                <option value="name">품목명 가나다순</option>
                <option value="quantity">반입 수량 많은순</option>
                <option value="newest">최근 등록순</option>
              </select>

              {sortOrder !== 'created' && (
                <button
                  type="button"
                  onClick={applyCurrentSortAsPermanentOrder}
                  className="px-3 py-2 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors flex items-center gap-1 whitespace-nowrap shrink-0"
                  title="현재 화면에 정렬된 순서를 실제 반입 순서(No. 1~)로 저장합니다"
                >
                  <ArrowUpDown className="w-3.5 h-3.5" />
                  <span>현재 정렬로 순서 확정</span>
                </button>
              )}

              {viewMode === 'table' && (
                <button
                  type="button"
                  onClick={() =>
                    setTableDensity((prev) =>
                      prev === 'comfortable' ? 'compact' : 'comfortable'
                    )
                  }
                  className="px-2.5 py-2 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap"
                  title="표 줄 간격 조절 (넓게 / 촘촘히 한눈에 보기)"
                >
                  {tableDensity === 'comfortable' ? '좁게 한눈에 보기' : '기본 간격 보기'}
                </button>
              )}

              <div className="flex items-center bg-slate-100 p-0.5 rounded-lg shrink-0">
                <button
                  type="button"
                  onClick={() => setViewMode('table')}
                  className={`p-1.5 rounded-md transition-colors ${
                    viewMode === 'table'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                  title="대장 표 뷰"
                >
                  <TableIcon className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('card')}
                  className={`p-1.5 rounded-md transition-colors ${
                    viewMode === 'card'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                  title="카드 뷰"
                >
                  <LayoutGrid className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Multi-Select Batch Action Bar */}
        {selectedVisibleEntries.length > 0 && (
          <div className="mb-3 bg-slate-900 text-white rounded-xl px-4 py-3 shadow-md flex flex-col lg:flex-row lg:items-center justify-between gap-3 no-print">
            <div className="flex flex-wrap items-center gap-2.5 text-xs">
              <span className="inline-flex items-center gap-1.5 font-bold text-blue-300 text-sm">
                <CheckSquare className="w-4 h-4" />
                <span>{selectedVisibleEntries.length}건 선택됨</span>
              </span>
              <button
                type="button"
                onClick={toggleSelectAllVisible}
                className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
              >
                {isAllVisibleSelected ? '선택 전체 해제' : `현재 목록 전체 선택 (${filteredEntries.length}건)`}
              </button>
              {!isAllVisibleSelected && (
                <button
                  type="button"
                  onClick={() => setSelectedRowKeys(new Set())}
                  className="px-2 py-1 rounded text-slate-400 hover:text-white transition-colors"
                >
                  취소
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              {/* 일괄 반입일자 변경 */}
              <div className="inline-flex items-center gap-1 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1">
                <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <input
                  type="date"
                  value={batchDateValue}
                  onChange={(e) => setBatchDateValue(e.target.value)}
                  className="bg-transparent text-xs font-mono text-white outline-none"
                />
                <button
                  type="button"
                  disabled={!batchDateValue}
                  onClick={handleBatchApplyDate}
                  className="px-2 py-0.5 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-40 font-semibold text-white whitespace-nowrap"
                >
                  날짜 일괄적용
                </button>
              </div>

              {/* 일괄 구매처 변경 */}
              <div className="inline-flex items-center gap-1 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1">
                <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <input
                  type="text"
                  list="existing-supplier-datalist"
                  value={batchSupplierValue}
                  onChange={(e) => setBatchSupplierValue(e.target.value)}
                  placeholder="구매처 입력 (비움 가능)"
                  className="w-32 bg-transparent text-xs text-white placeholder:text-slate-400 outline-none"
                />
                <button
                  type="button"
                  onClick={handleBatchApplySupplier}
                  className="px-2 py-0.5 rounded bg-blue-600 hover:bg-blue-500 font-semibold text-white whitespace-nowrap"
                >
                  구매처 일괄적용
                </button>
              </div>

              {/* 다른 시트로 일괄 이동 */}
              {sheets.length > 1 && (
                <div className="inline-flex items-center gap-1 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1">
                  <FolderInput className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <select
                    value={batchTargetSheetId}
                    onChange={(e) => {
                      const val = e.target.value;
                      setBatchTargetSheetId(val);
                      if (val) handleBatchMoveToSheet(val);
                    }}
                    className="bg-transparent text-xs text-white outline-none"
                  >
                    <option value="" className="text-slate-900">
                      다른 시트로 이동...
                    </option>
                    {sheets.map((s) => (
                      <option key={s.id} value={s.id} className="text-slate-900">
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* 선택 항목 한 번에 지우기 */}
              <button
                type="button"
                onClick={handleDeleteSelectedItems}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 font-bold text-white transition-colors whitespace-nowrap"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>선택 항목 삭제 ({selectedVisibleEntries.length}건)</span>
              </button>
            </div>
          </div>
        )}

        {/* Material Items List — Exact Formal Ledger Table Matching User Specification */}
        {filteredEntries.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-8 sm:p-12 text-center">
            <Boxes className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <h3 className="text-base font-bold text-slate-800">
              {searchTerm
                ? '검색 조건에 맞는 자재가 없습니다'
                : activeTabId === FAVORITE_MATERIALS_TAB_ID
                ? '아직 통합보기 [자재]에 등록된 즐겨찾기 품목이 없습니다'
                : activeSheet
                ? `'${activeSheet.name}' 시트에 등록된 자재가 없습니다`
                : '등록된 자재가 없습니다'}
            </h3>
            <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
              {searchTerm
                ? '검색어를 지우면 전체 반입 목록이 다시 표시됩니다.'
                : activeTabId === FAVORITE_MATERIALS_TAB_ID
                ? '각 시트 표의 자재 품목명 옆 별표(☆)를 누르면 해당 품목이 이곳 통합보기 [자재]로 자동 모여 총 반입 수량을 바로 확인할 수 있습니다.'
                : '상단 폼에서 직접 입력하거나, 만들어 두신 엑셀 표(.xlsx / 복사·붙여넣기)를 한 번에 가져올 수 있습니다.'}
            </p>

            {searchTerm ? (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="mt-4 px-3.5 py-2 text-xs font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
              >
                검색 초기화
              </button>
            ) : activeTabId === FAVORITE_MATERIALS_TAB_ID ? (
              <button
                type="button"
                onClick={() => setActiveTabId(integratedSheets[0]?.id || 'ALL')}
                className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-lg transition-colors"
              >
                <Star className="w-3.5 h-3.5 fill-slate-950" />
                <span>시트로 가서 즐겨찾기(☆) 선택하기</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setDroppedExcelFile(null);
                  setShowExcelImportModal(true);
                }}
                className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>엑셀 표 바로 가져오기</span>
              </button>
            )}
          </div>
        ) : viewMode === 'table' ? (
          <div className="bg-white rounded-xl border-2 border-slate-800 overflow-hidden shadow-xs">
            <div className="overflow-auto max-h-[74vh] print:max-h-none print:overflow-visible">
              <table className="w-full text-center border-collapse text-sm">
                <thead className="sticky top-0 z-10 print:static">
                  <tr className="bg-[#1e293b] text-white text-xs font-bold divide-x divide-slate-600 border-b-2 border-slate-900">
                    {/* 맨 좌측: 수정 / 삭제 */}
                    <th className="py-3 px-2.5 w-36 no-print whitespace-nowrap">수정 / 삭제</th>
                    {/* 일괄 선택 체크박스 */}
                    <th className="py-3 px-2 w-10 no-print">
                      <button
                        type="button"
                        onClick={toggleSelectAllVisible}
                        className="inline-flex items-center justify-center w-6 h-6 rounded hover:bg-slate-700 transition-colors"
                        title={isAllVisibleSelected ? '전체 선택 해제' : '전체 항목 선택'}
                      >
                        {isAllVisibleSelected ? (
                          <CheckSquare className="w-4 h-4 text-blue-400" />
                        ) : (
                          <Square className="w-4 h-4 text-slate-400" />
                        )}
                      </button>
                    </th>
                    <th className="py-3 px-2 w-28 print:w-14">
                      <span>No.</span>
                      <span className="no-print text-[11px] font-normal text-slate-300 ml-1">
                        (순서)
                      </span>
                    </th>
                    {isIntegratedView && (
                      <th className="py-3 px-3 min-w-[140px]">시트 구분</th>
                    )}
                    <th className="py-3 px-3 w-32">반입일자</th>
                    <th className="py-3 px-3 min-w-[120px]">구매처</th>
                    <th className="py-3 px-4 min-w-[240px]">자재 품목명</th>
                    <th className="py-3 px-3 min-w-[125px] bg-slate-800 text-amber-300 font-bold whitespace-nowrap">
                      전표 원본
                    </th>
                    <th className="py-3 px-3 min-w-[130px]">규격 / 사양</th>
                    <th className="py-3 px-3 w-32">반입 수량</th>
                    <th className="py-3 px-3 w-24">단위</th>
                    <th className="py-3 px-3 min-w-[90px]">비고</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 border-b-2 border-slate-800">
                  {paginatedEntries.map(({ item, sheetId, sheetName }, index) => {
                    const displayRowNumber = (safeCurrentPage - 1) * pageSize + index + 1;
                    const hasQty = item.quantity > 0;
                    const totalConv = hasQty ? getTotalConvertedQty(item) : null;
                    const hasPack = totalConv !== null;
                    const displaySpec = item.spec && item.spec !== '-' ? item.spec : '-';
                    const finalQtyNum = hasPack ? totalConv : item.quantity;
                    const finalUnitLabel = hasPack ? item.subUnit || 'EA' : item.unit;

                    const rowKey = makeRowKey(sheetId, item.id);
                    const isRowSelected = selectedRowKeys.has(rowKey);
                    const cellPy = tableDensity === 'compact' ? 'py-1.5' : 'py-2.5';

                    const sheetMeta = entryLookupMeta.sheetMap.get(sheetId);
                    const sheetItemIdx =
                      sheetMeta?.itemIndexMap.get(item.id) ?? displayRowNumber - 1;
                    const sheetItemCount = sheetMeta?.itemCount ?? 1;

                    const visMeta = entryLookupMeta.visPosMap.get(rowKey);
                    const sameSheetVisIdx = visMeta?.visIdx ?? -1;
                    const sameSheetVisCount = visMeta?.visCount ?? 1;
                    const canMoveUp = sameSheetVisIdx > 0;
                    const canMoveDown =
                      sameSheetVisIdx >= 0 && sameSheetVisIdx < sameSheetVisCount - 1;

                    const isBeingDragged =
                      draggedEntry?.sheetId === sheetId && draggedEntry?.itemId === item.id;
                    const isDragTargetBefore =
                      dragOverTarget?.sheetId === sheetId &&
                      dragOverTarget?.itemId === item.id &&
                      dragOverTarget?.position === 'before';
                    const isDragTargetAfter =
                      dragOverTarget?.sheetId === sheetId &&
                      dragOverTarget?.itemId === item.id &&
                      dragOverTarget?.position === 'after';

                    const isEditingThisOrder =
                      editingOrderTarget?.sheetId === sheetId &&
                      editingOrderTarget?.itemId === item.id;

                    const isInlineEditing = (
                      field:
                        | 'date'
                        | 'supplier'
                        | 'name'
                        | 'spec'
                        | 'quantity'
                        | 'unit'
                        | 'packQty'
                        | 'remarks'
                    ) =>
                      inlineEditCell?.sheetId === sheetId &&
                      inlineEditCell?.itemId === item.id &&
                      inlineEditCell?.field === field;

                    const isFileDropTarget =
                      fileDropTargetItem?.sheetId === sheetId &&
                      fileDropTargetItem?.itemId === item.id;

                    return (
                      <tr
                        key={`${sheetId}-${item.id}`}
                        draggable={!editingOrderTarget && !inlineEditCell && sheetItemCount > 1}
                        onDragStart={(e) => {
                          setDraggedEntry({ sheetId, itemId: item.id });
                          e.dataTransfer.effectAllowed = 'move';
                        }}
                        onDragOver={(e) => {
                          if (e.dataTransfer.types.includes('Files')) {
                            e.preventDefault();
                            e.stopPropagation();
                            e.dataTransfer.dropEffect = 'copy';
                            if (
                              fileDropTargetItem?.sheetId !== sheetId ||
                              fileDropTargetItem?.itemId !== item.id
                            ) {
                              setFileDropTargetItem({ sheetId, itemId: item.id });
                            }
                            return;
                          }

                          if (!draggedEntry || draggedEntry.sheetId !== sheetId) return;
                          if (draggedEntry.itemId === item.id) return;
                          e.preventDefault();
                          e.dataTransfer.dropEffect = 'move';
                          const rect = e.currentTarget.getBoundingClientRect();
                          const pos =
                            e.clientY - rect.top < rect.height / 2 ? 'before' : 'after';
                          if (
                            dragOverTarget?.itemId !== item.id ||
                            dragOverTarget?.position !== pos
                          ) {
                            setDragOverTarget({ sheetId, itemId: item.id, position: pos });
                          }
                        }}
                        onDragLeave={(e) => {
                          if (
                            fileDropTargetItem?.sheetId === sheetId &&
                            fileDropTargetItem?.itemId === item.id
                          ) {
                            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                              setFileDropTargetItem(null);
                            }
                          }
                        }}
                        onDrop={(e) => {
                          if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                            e.preventDefault();
                            e.stopPropagation();
                            lastDirectDropTimeRef.current = Date.now();
                            setFileDropTargetItem(null);
                            setIsWindowDragging(false);
                            setDroppedSlipIntentFile(null);
                            const file = e.dataTransfer.files[0];
                            if (isImageFile(file)) {
                              handleDirectDropSlipOnItem(sheetId, item, file);
                            } else if (/\.(xlsx|xls|csv)$/i.test(file.name) || file.type.includes('spreadsheet') || file.type.includes('excel')) {
                              setDroppedExcelFile(file);
                              setShowExcelImportModal(true);
                            } else {
                              showToast('전표 사진(JPG, PNG 등 이미지) 또는 엑셀 파일을 올려주세요.');
                            }
                            return;
                          }

                          e.preventDefault();
                          if (
                            draggedEntry &&
                            dragOverTarget &&
                            draggedEntry.sheetId === sheetId
                          ) {
                            moveItemRelative(
                              sheetId,
                              draggedEntry.itemId,
                              dragOverTarget.itemId,
                              dragOverTarget.position
                            );
                          }
                          setDraggedEntry(null);
                          setDragOverTarget(null);
                        }}
                        onDragEnd={() => {
                          setDraggedEntry(null);
                          setDragOverTarget(null);
                          setFileDropTargetItem(null);
                        }}
                        className={`group divide-x divide-slate-200 transition-colors ${
                          isFileDropTarget
                            ? 'bg-amber-100/90 ring-2 ring-amber-500 ring-inset shadow-md font-semibold'
                            : 'hover:bg-blue-50/40'
                        } ${
                          isBeingDragged ? 'opacity-40' : ''
                        } ${
                          isDragTargetBefore ? 'shadow-[inset_0_2px_0_0_#2563eb]' : ''
                        } ${
                          isDragTargetAfter ? 'shadow-[inset_0_-2px_0_0_#2563eb]' : ''
                        } ${
                          isRowSelected
                            ? 'bg-blue-50/80'
                            : index % 2 === 1
                            ? 'bg-slate-50/50'
                            : 'bg-white'
                        }`}
                      >
                        {/* 맨 좌측: 삭제 / 수정 / 복제 버튼 (전표는 우측 전표 원본 열에서 일원화 관리) */}
                        <td className={`${cellPy} px-2 text-center no-print whitespace-nowrap`}>
                          <div className="inline-flex items-center justify-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleDeleteItem(sheetId, item.id, item.name)}
                              className="px-2.5 py-1 text-xs font-bold text-rose-600 hover:text-white bg-rose-50 hover:bg-rose-600 border border-rose-200 hover:border-rose-600 rounded-md transition-colors inline-flex items-center gap-1"
                              title="확인창 없이 즉시 지우기 (되돌리기 가능)"
                            >
                              <Trash2 className="w-3 h-3" />
                              <span>삭제</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => openEditModal(item, sheetId)}
                              className="px-2 py-1 text-xs font-medium text-slate-600 hover:text-blue-700 bg-slate-100 hover:bg-blue-50 rounded-md transition-colors"
                              title="상세 수정 및 시트 이동"
                            >
                              수정
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDuplicateToForm(item, sheetId)}
                              className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                              title="상단 입력창에 복제"
                            >
                              <CopyPlus className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>

                        {/* 다중 선택 체크박스 (화면 전용) */}
                        <td className={`${cellPy} px-2 text-center no-print`}>
                          <input
                            type="checkbox"
                            checked={isRowSelected}
                            onChange={() => toggleSelectRow(sheetId, item.id)}
                            className="w-4 h-4 rounded accent-blue-600 cursor-pointer"
                            title="선택하여 일괄 삭제·일괄 변경"
                          />
                        </td>

                        {/* No. & 반입 순서 컨트롤 */}
                        <td className={`${cellPy} px-2 text-xs font-mono tabular-nums text-slate-700 whitespace-nowrap`}>
                          {/* 인쇄용 순번 */}
                          <span className="hidden print:inline">{displayRowNumber}</span>

                          {/* 화면용 드래그·순번 클릭·화살표 컨트롤 */}
                          <div className="no-print flex items-center justify-center gap-1">
                            {sheetItemCount > 1 && (
                              <span
                                className="text-slate-300 group-hover:text-slate-500 cursor-grab active:cursor-grabbing"
                                title="드래그하여 반입 순서 이동"
                              >
                                <GripVertical className="w-3.5 h-3.5" />
                              </span>
                            )}

                            {isEditingThisOrder ? (
                              <input
                                type="number"
                                min={1}
                                max={sheetItemCount}
                                autoFocus
                                value={editingOrderTarget.value}
                                onChange={(e) =>
                                  setEditingOrderTarget({
                                    ...editingOrderTarget,
                                    value: e.target.value,
                                  })
                                }
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    commitDirectOrderChange(
                                      sheetId,
                                      item.id,
                                      editingOrderTarget.value
                                    );
                                  } else if (e.key === 'Escape') {
                                    setEditingOrderTarget(null);
                                  }
                                }}
                                onBlur={() =>
                                  commitDirectOrderChange(
                                    sheetId,
                                    item.id,
                                    editingOrderTarget.value
                                  )
                                }
                                className="w-11 px-1 py-0.5 text-center text-xs font-mono font-bold bg-white border border-blue-500 rounded outline-none"
                              />
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  if (sheetItemCount <= 1) return;
                                  setEditingOrderTarget({
                                    sheetId,
                                    itemId: item.id,
                                    value: String(sheetItemIdx + 1),
                                  });
                                }}
                                className={`min-w-[24px] px-1.5 py-0.5 rounded font-bold transition-colors ${
                                  sheetItemCount > 1
                                    ? 'text-slate-800 hover:bg-blue-100 hover:text-blue-700 cursor-pointer'
                                    : 'text-slate-700 cursor-default'
                                }`}
                                title={
                                  sheetItemCount > 1
                                    ? `클릭하여 원하는 번호(1~${sheetItemCount})로 바로 이동`
                                    : undefined
                                }
                              >
                                {displayRowNumber}
                              </button>
                            )}

                            {sheetItemCount > 1 && (
                              <div className="flex flex-col -space-y-0.5">
                                <button
                                  type="button"
                                  disabled={!canMoveUp}
                                  onClick={() => moveItemStep(sheetId, item.id, 'up')}
                                  className="p-0.5 rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50 disabled:opacity-25 disabled:pointer-events-none transition-colors"
                                  title="순서 한 칸 위로"
                                >
                                  <ChevronUp className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  disabled={!canMoveDown}
                                  onClick={() => moveItemStep(sheetId, item.id, 'down')}
                                  className="p-0.5 rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50 disabled:opacity-25 disabled:pointer-events-none transition-colors"
                                  title="순서 한 칸 아래로"
                                >
                                  <ChevronDown className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            )}
                          </div>
                        </td>

                        {/* 시트 구분 (통합 보기 전용) */}
                        {isIntegratedView && (
                          <td className={`${cellPy} px-3 text-xs font-semibold text-slate-700 whitespace-nowrap`}>
                            {sheetName}
                          </td>
                        )}

                        {/* 반입일자 (클릭 즉시 수정) */}
                        <td
                          onClick={() => !isInlineEditing('date') && startInlineEdit(sheetId, item, 'date')}
                          className={`${cellPy} px-2 text-xs font-mono tabular-nums text-slate-700 whitespace-nowrap cursor-pointer hover:bg-blue-50/70`}
                          title="클릭하여 반입일자 바로 수정"
                        >
                          {isInlineEditing('date') ? (
                            <input
                              type="date"
                              autoFocus
                              value={inlineEditCell?.value || ''}
                              onChange={(e) =>
                                inlineEditCell &&
                                setInlineEditCell({ ...inlineEditCell, value: e.target.value })
                              }
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') commitInlineEdit();
                                if (e.key === 'Escape') setInlineEditCell(null);
                              }}
                              onBlur={commitInlineEdit}
                              className="w-full px-1.5 py-1 text-xs font-mono bg-white border border-blue-500 rounded outline-none"
                            />
                          ) : (
                            item.date
                          )}
                        </td>

                        {/* 구매처 (클릭 즉시 수정) */}
                        <td
                          onClick={() =>
                            !isInlineEditing('supplier') &&
                            startInlineEdit(sheetId, item, 'supplier')
                          }
                          className={`${cellPy} px-2.5 text-xs whitespace-nowrap cursor-pointer hover:bg-blue-50/70 ${
                            item.supplier && item.supplier !== '-'
                              ? 'font-medium text-slate-800'
                              : 'text-slate-400'
                          }`}
                          title="클릭하여 구매처 바로 입력/수정"
                        >
                          {isInlineEditing('supplier') ? (
                            <input
                              type="text"
                              list="existing-supplier-datalist"
                              autoFocus
                              placeholder="구매처 입력"
                              value={inlineEditCell?.value || ''}
                              onChange={(e) =>
                                inlineEditCell &&
                                setInlineEditCell({ ...inlineEditCell, value: e.target.value })
                              }
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') commitInlineEdit();
                                if (e.key === 'Escape') setInlineEditCell(null);
                              }}
                              onBlur={commitInlineEdit}
                              className="w-full px-2 py-1 text-xs text-center bg-white border border-blue-500 rounded outline-none"
                            />
                          ) : item.supplier && item.supplier !== '-' ? (
                            item.supplier
                          ) : (
                            '-'
                          )}
                        </td>

                        {/* 자재 품목명 (통합보기에서는 총 수량 즉시 조회 · 일반 시트에서는 클릭 즉시 수정 + 즐겨찾기 ☆/★ 토글) */}
                        <td
                          onClick={() => {
                            if (isIntegratedView) {
                              setInspectedMaterialTarget({
                                name: item.name,
                                spec: displaySpec,
                              });
                            } else if (!isInlineEditing('name')) {
                              startInlineEdit(sheetId, item, 'name');
                            }
                          }}
                          className={`${cellPy} px-3 text-left cursor-pointer hover:bg-blue-50/70`}
                          title={
                            isIntegratedView
                              ? '클릭하면 이 자재가 총 몇 개 들어왔는지 합계 수량이 바로 표시됩니다'
                              : '클릭하여 품목명 바로 수정'
                          }
                        >
                          {!isIntegratedView && isInlineEditing('name') ? (
                            <input
                              type="text"
                              autoFocus
                              value={inlineEditCell?.value || ''}
                              onChange={(e) =>
                                inlineEditCell &&
                                setInlineEditCell({ ...inlineEditCell, value: e.target.value })
                              }
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') commitInlineEdit();
                                if (e.key === 'Escape') setInlineEditCell(null);
                              }}
                              onBlur={commitInlineEdit}
                              className="w-full px-2 py-1 text-sm font-bold bg-white border border-blue-500 rounded outline-none"
                            />
                          ) : (
                            <div className="flex flex-wrap items-center justify-between gap-1.5">
                              <div className="inline-flex items-center gap-1.5 min-w-0">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const fk = makeFavoriteLookupKey(item.name, displaySpec);
                                    const grp =
                                      itemGroupLookup.get(fk) ||
                                      allIntegratedGroupLookup.get(fk);
                                    toggleFavoriteByKey(fk, item.name, grp?.entryCount || 1);
                                  }}
                                  className={`no-print p-0.5 rounded transition-colors shrink-0 ${
                                    isItemFavorited(item.name, displaySpec)
                                      ? 'text-amber-500 hover:text-amber-600'
                                      : 'text-slate-300 hover:text-amber-500'
                                  }`}
                                  title={
                                    isItemFavorited(item.name, displaySpec)
                                      ? '즐겨찾기(통합보기 [자재])에서 해제'
                                      : '즐겨찾기하여 [통합보기 [자재]]로 보내기'
                                  }
                                >
                                  <Star
                                    className={`w-3.5 h-3.5 ${
                                      isItemFavorited(item.name, displaySpec)
                                        ? 'fill-amber-400'
                                        : ''
                                    }`}
                                  />
                                </button>
                                <span
                                  className={`font-bold text-sm text-slate-900 ${
                                    isIntegratedView
                                      ? 'group-hover:text-blue-700 group-hover:underline underline-offset-2'
                                      : ''
                                  }`}
                                >
                                  {item.name}
                                </span>
                              </div>
                              <div className="inline-flex items-center gap-1.5 shrink-0 no-print">
                                {(() => {
                                  const lookupKey = makeFavoriteLookupKey(item.name, displaySpec);
                                  const grp = itemGroupLookup.get(lookupKey);
                                  if (grp && grp.entryCount > 1) {
                                    return (
                                      <span
                                        className="text-xs font-mono tabular-nums font-bold text-blue-700"
                                        title={`동일 품목 ${grp.entryCount}회 누적 합계: 반입 ${grp.inboundSummaryWithUnit} / 토탈 ${grp.totalSummaryText}`}
                                      >
                                        · {grp.entryCount}회 반입
                                      </span>
                                    );
                                  }
                                  return null;
                                })()}
                                {isIntegratedView && (
                                  <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 text-[10px] font-bold">
                                    총 수량 보기
                                  </span>
                                )}
                              </div>
                            </div>
                          )}
                        </td>

                        {/* 전표 원본 (사진 보기 / 등록 / 추가 / 삭제) */}
                        <td
                          onDragOver={(e) => {
                            if (e.dataTransfer.types.includes('Files')) {
                              e.preventDefault();
                              e.stopPropagation();
                              e.dataTransfer.dropEffect = 'copy';
                              if (fileDropTargetItem?.sheetId !== sheetId || fileDropTargetItem?.itemId !== item.id) {
                                setFileDropTargetItem({ sheetId, itemId: item.id });
                              }
                            }
                          }}
                          onDrop={(e) => {
                            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                              e.preventDefault();
                              e.stopPropagation();
                              lastDirectDropTimeRef.current = Date.now();
                              setFileDropTargetItem(null);
                              setIsWindowDragging(false);
                              setDroppedSlipIntentFile(null);
                              const file = e.dataTransfer.files[0];
                              if (isImageFile(file)) {
                                handleDirectDropSlipOnItem(sheetId, item, file);
                              } else if (/\.(xlsx|xls|csv)$/i.test(file.name) || file.type.includes('spreadsheet') || file.type.includes('excel')) {
                                setDroppedExcelFile(file);
                                setShowExcelImportModal(true);
                              } else {
                                showToast('전표 사진(JPG, PNG 등 이미지) 또는 엑셀 파일을 올려주세요.');
                              }
                            }
                          }}
                          className={`${cellPy} px-2.5 text-center whitespace-nowrap transition-all ${
                            isFileDropTarget ? 'bg-amber-200/90 ring-2 ring-amber-500 ring-inset shadow-inner' : ''
                          }`}
                        >
                          {isFileDropTarget ? (
                            <div className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-amber-600 text-white rounded-lg text-xs font-bold shadow-md animate-pulse">
                              <Upload className="w-4 h-4" />
                              <span>여기에 놓으면 [{item.name}] 전표 등록</span>
                            </div>
                          ) : (() => {
                            const rowSlipIds = getItemSlipIds(item);
                            if (rowSlipIds.length === 0) {
                              return (
                                <div className="inline-flex items-center justify-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setAttachingTarget({ sheetId, item });
                                    }}
                                    className="no-print inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 active:scale-95 rounded-lg transition-all shadow-xs hover:shadow hover:scale-105"
                                    title="이 품목에 전표 사진 등록 (클릭하거나 사진 끌어다놓기)"
                                  >
                                    <Plus className="w-4 h-4 stroke-[3]" />
                                    <span>전표 추가</span>
                                  </button>
                                  <span className="print:inline hidden text-slate-400 text-xs">-</span>
                                </div>
                              );
                            }

                            if (rowSlipIds.length === 1) {
                              return (
                                <div className="inline-flex items-center justify-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openSlipViewer(rowSlipIds[0], rowSlipIds);
                                    }}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-amber-900 bg-amber-100 hover:bg-amber-200 border border-amber-300 rounded-lg transition-all shadow-2xs hover:scale-105"
                                    title="소장된 전표 원본 사진 크게 보기 (확대/회전/다운로드)"
                                  >
                                    <Receipt className="w-4 h-4 text-amber-700 shrink-0" />
                                    <span>전표 보기</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setAttachingTarget({ sheetId, item });
                                    }}
                                    className="no-print inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 active:scale-95 rounded-lg shadow-xs hover:shadow hover:scale-105 transition-all"
                                    title="전표 사진 1장 더 추가 등록"
                                  >
                                    <Plus className="w-4 h-4 stroke-[3]" />
                                    <span>추가</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleRemoveSlipFromItem(sheetId, item.id);
                                    }}
                                    className="no-print p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                                    title="이 품목에서 전표 연결 삭제 / 해제"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              );
                            }

                            return (
                              <div className="inline-flex items-center justify-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openSlipViewer(rowSlipIds[0], rowSlipIds);
                                  }}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-blue-900 bg-gradient-to-r from-blue-100 to-indigo-100 hover:from-blue-200 hover:to-indigo-200 border border-blue-300 rounded-lg transition-all shadow-2xs hover:scale-105"
                                  title={`총 ${rowSlipIds.length}장의 전표가 등록되어 있습니다 (클릭하여 탐색)`}
                                >
                                  <Layers className="w-4 h-4 text-blue-700 shrink-0" />
                                  <span>전표 {rowSlipIds.length}장 보기</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setAttachingTarget({ sheetId, item });
                                  }}
                                  className="no-print inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 active:scale-95 rounded-lg shadow-xs hover:shadow hover:scale-105 transition-all"
                                  title="전표 사진 1장 더 추가 등록"
                                >
                                  <Plus className="w-4 h-4 stroke-[3]" />
                                  <span>추가</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleRemoveSlipFromItem(sheetId, item.id);
                                  }}
                                  className="no-print p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                                  title="이 품목의 모든 전표 연결 해제"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            );
                          })()}
                        </td>

                        {/* 규격 / 사양 (클릭 즉시 수정) */}
                        <td
                          onClick={() => !isInlineEditing('spec') && startInlineEdit(sheetId, item, 'spec')}
                          className={`${cellPy} px-2.5 text-xs text-slate-700 whitespace-nowrap cursor-pointer hover:bg-blue-50/70`}
                          title="클릭하여 규격/사양 바로 수정"
                        >
                          {isInlineEditing('spec') ? (
                            <input
                              type="text"
                              autoFocus
                              placeholder="-"
                              value={inlineEditCell?.value || ''}
                              onChange={(e) =>
                                inlineEditCell &&
                                setInlineEditCell({ ...inlineEditCell, value: e.target.value })
                              }
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') commitInlineEdit();
                                if (e.key === 'Escape') setInlineEditCell(null);
                              }}
                              onBlur={commitInlineEdit}
                              className="w-full px-2 py-1 text-xs text-center bg-white border border-blue-500 rounded outline-none"
                            />
                          ) : (
                            displaySpec
                          )}
                        </td>

                        {/* 반입 수량 (클릭 즉시 수정) */}
                        <td
                          onClick={() =>
                            !isInlineEditing('quantity') && startInlineEdit(sheetId, item, 'quantity')
                          }
                          className={`${cellPy} px-2.5 font-mono tabular-nums text-sm whitespace-nowrap cursor-pointer hover:bg-blue-50/70 ${
                            hasQty ? 'font-bold text-slate-900' : 'text-slate-400'
                          }`}
                          title="클릭하여 반입 수량 바로 입력/수정"
                        >
                          {isInlineEditing('quantity') ? (
                            <input
                              type="number"
                              step="any"
                              min="0"
                              autoFocus
                              placeholder="0"
                              value={inlineEditCell?.value || ''}
                              onChange={(e) =>
                                inlineEditCell &&
                                setInlineEditCell({ ...inlineEditCell, value: e.target.value })
                              }
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') commitInlineEdit();
                                if (e.key === 'Escape') setInlineEditCell(null);
                              }}
                              onBlur={commitInlineEdit}
                              className="w-20 px-1.5 py-1 text-sm font-mono font-bold text-center bg-white border border-blue-500 rounded outline-none"
                            />
                          ) : hasQty ? (
                            item.quantity.toLocaleString()
                          ) : (
                            '-'
                          )}
                        </td>

                        {/* 단위 (클릭 즉시 수정) */}
                        <td
                          onClick={() => !isInlineEditing('unit') && startInlineEdit(sheetId, item, 'unit')}
                          className={`${cellPy} px-2 text-xs whitespace-nowrap cursor-pointer hover:bg-blue-50/70 ${
                            hasQty ? 'text-slate-700' : 'text-slate-400'
                          }`}
                          title="클릭하여 단위 바로 수정"
                        >
                          {isInlineEditing('unit') ? (
                            <input
                              type="text"
                              autoFocus
                              placeholder="EA"
                              value={inlineEditCell?.value || ''}
                              onChange={(e) =>
                                inlineEditCell &&
                                setInlineEditCell({ ...inlineEditCell, value: e.target.value })
                              }
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') commitInlineEdit();
                                if (e.key === 'Escape') setInlineEditCell(null);
                              }}
                              onBlur={commitInlineEdit}
                              className="w-16 px-1.5 py-1 text-xs text-center bg-white border border-blue-500 rounded outline-none"
                            />
                          ) : (
                            item.unit || '-'
                          )}
                        </td>

                        {/* 비고 (맨 우측 열 — 클릭 즉시 수정) */}
                        <td
                          onClick={() =>
                            !isInlineEditing('remarks') && startInlineEdit(sheetId, item, 'remarks')
                          }
                          className={`${cellPy} px-3 text-xs text-slate-600 cursor-pointer hover:bg-blue-50/70 ${
                            item.remarks ? 'text-left' : 'text-center'
                          }`}
                          title="클릭하여 비고 바로 수정"
                        >
                          {isInlineEditing('remarks') ? (
                            <input
                              type="text"
                              autoFocus
                              placeholder="비고 입력"
                              value={inlineEditCell?.value || ''}
                              onChange={(e) =>
                                inlineEditCell &&
                                setInlineEditCell({ ...inlineEditCell, value: e.target.value })
                              }
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') commitInlineEdit();
                                if (e.key === 'Escape') setInlineEditCell(null);
                              }}
                              onBlur={commitInlineEdit}
                              className="w-full px-2 py-1 text-xs bg-white border border-blue-500 rounded outline-none"
                            />
                          ) : (
                            item.remarks || '-'
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          /* Touch-Friendly Card View */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
            {paginatedEntries.map(({ item, sheetId, sheetName }, index) => {
              const displayRowNumber = (safeCurrentPage - 1) * pageSize + index + 1;
              const hasQty = item.quantity > 0;
              const totalConv = hasQty ? getTotalConvertedQty(item) : null;
              const hasPack = totalConv !== null;
              const hasSpec = item.spec && item.spec !== '-';
              const finalQtyNum = hasPack ? totalConv : item.quantity;
              const finalUnitLabel = hasPack ? item.subUnit || 'EA' : item.unit;

              const visMeta = entryLookupMeta.visPosMap.get(makeRowKey(sheetId, item.id));
              const sameSheetVisIdx = visMeta?.visIdx ?? -1;
              const sameSheetVisCount = visMeta?.visCount ?? 1;
              const canMoveUp = sameSheetVisIdx > 0;
              const canMoveDown =
                sameSheetVisIdx >= 0 && sameSheetVisIdx < sameSheetVisCount - 1;

              return (
                <div
                  key={`${sheetId}-${item.id}`}
                  className="bg-white rounded-xl border border-slate-200 p-4 transition-colors flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-1.5 text-[11px] font-mono text-slate-400">
                          <span className="font-bold text-slate-600">No.{displayRowNumber}</span>
                          {sameSheetVisCount > 1 && (
                            <span className="inline-flex items-center gap-0.5 ml-1 no-print">
                              <button
                                type="button"
                                disabled={!canMoveUp}
                                onClick={() => moveItemStep(sheetId, item.id, 'up')}
                                className="p-0.5 rounded bg-slate-100 text-slate-600 hover:bg-blue-100 hover:text-blue-700 disabled:opacity-30"
                                title="순서 위로"
                              >
                                <ChevronUp className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                disabled={!canMoveDown}
                                onClick={() => moveItemStep(sheetId, item.id, 'down')}
                                className="p-0.5 rounded bg-slate-100 text-slate-600 hover:bg-blue-100 hover:text-blue-700 disabled:opacity-30"
                                title="순서 아래로"
                              >
                                <ChevronDown className="w-3.5 h-3.5" />
                              </button>
                            </span>
                          )}
                          {isIntegratedView && (
                            <>
                              <span>·</span>
                              <span className="font-sans font-medium text-blue-600">
                                {sheetName}
                              </span>
                            </>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <button
                            type="button"
                            onClick={() => {
                              const dispSpec = hasSpec ? item.spec : '-';
                              const fk = makeFavoriteLookupKey(item.name, dispSpec);
                              const grp =
                                itemGroupLookup.get(fk) ||
                                allIntegratedGroupLookup.get(fk);
                              toggleFavoriteByKey(fk, item.name, grp?.entryCount || 1);
                            }}
                            className={`no-print p-0.5 rounded transition-colors shrink-0 ${
                              isItemFavorited(item.name, hasSpec ? item.spec : '-')
                                ? 'text-amber-500'
                                : 'text-slate-300 hover:text-amber-500'
                            }`}
                            title="즐겨찾기 [통합보기 [자재]] 토글"
                          >
                            <Star
                              className={`w-4 h-4 ${
                                isItemFavorited(item.name, hasSpec ? item.spec : '-')
                                  ? 'fill-amber-400'
                                  : ''
                              }`}
                            />
                          </button>
                          <h3
                            onClick={() => {
                              if (isIntegratedView) {
                                setInspectedMaterialTarget({
                                  name: item.name,
                                  spec: hasSpec ? item.spec : '-',
                                });
                              }
                            }}
                            className={`text-base font-bold tracking-tight text-slate-900 ${
                              isIntegratedView
                                ? 'cursor-pointer hover:text-blue-700 hover:underline'
                                : ''
                            }`}
                          >
                            {item.name}
                          </h3>
                        </div>
                        {(item.supplier && item.supplier !== '-') || hasSpec ? (
                          <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap items-center gap-1.5">
                            {item.supplier && item.supplier !== '-' && (
                              <span className="font-medium text-slate-700">
                                구매처: {item.supplier}
                              </span>
                            )}
                            {item.supplier && item.supplier !== '-' && hasSpec && (
                              <span>·</span>
                            )}
                            {hasSpec && <span>규격: {item.spec}</span>}
                          </div>
                        ) : null}
                      </div>

                      <span className="text-xs font-mono tabular-nums text-slate-500 shrink-0 whitespace-nowrap">
                        {item.date}
                      </span>
                    </div>

                    <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                      <div>
                        <div className="text-[11px] text-slate-400">반입 수량</div>
                        <div className="mt-0.5">
                          {hasQty ? (
                            <>
                              <span className="font-mono tabular-nums font-bold text-lg text-slate-900">
                                {item.quantity.toLocaleString()}
                              </span>
                              <span className="text-xs text-slate-600 font-semibold ml-1">
                                {item.unit}
                              </span>
                            </>
                          ) : (
                            <span className="text-sm font-medium text-slate-400">수량 미정 (-)</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {item.remarks && (
                      <p className="mt-3 text-xs text-slate-500 line-clamp-2">
                        비고: {item.remarks}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center justify-between pt-3 mt-3 border-t border-slate-100 text-xs no-print">
                    <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-500 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedRowKeys.has(makeRowKey(sheetId, item.id))}
                        onChange={() => toggleSelectRow(sheetId, item.id)}
                        className="w-3.5 h-3.5 rounded accent-blue-600 cursor-pointer"
                      />
                      <span className="font-mono tabular-nums">{item.date}</span>
                    </label>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleDuplicateToForm(item, sheetId)}
                        className="min-h-[34px] px-2 py-1 text-slate-500 hover:text-blue-600 hover:bg-slate-100 rounded-md transition-colors flex items-center gap-1"
                      >
                        <CopyPlus className="w-3.5 h-3.5" />
                        <span>복제</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => openEditModal(item, sheetId)}
                        className="min-h-[34px] px-2.5 py-1 text-slate-600 hover:text-blue-600 bg-slate-100 hover:bg-blue-50 rounded-md transition-colors flex items-center gap-1 font-medium"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>수정</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteItem(sheetId, item.id, item.name)}
                        className="min-h-[34px] px-2.5 py-1 text-rose-600 hover:text-white bg-rose-50 hover:bg-rose-600 border border-rose-200 hover:border-rose-600 rounded-md transition-colors flex items-center gap-1 font-bold"
                        title="확인창 없이 즉시 삭제 (하단 되돌리기 가능)"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>삭제</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination Bar (slices rendered DOM rows while preserving 100% full search, totals & Excel export) */}
        {filteredEntries.length > 50 && (
          <div className="mt-4 px-4 py-3 bg-white rounded-xl border border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs no-print">
            <div className="flex flex-wrap items-center gap-2 text-slate-600">
              <span>
                전체 <strong className="text-slate-900">{filteredEntries.length}</strong>건 중{' '}
                <strong className="text-blue-700 font-mono">
                  {(safeCurrentPage - 1) * pageSize + 1}–
                  {Math.min(safeCurrentPage * pageSize, filteredEntries.length)}
                </strong>
                건 표시
              </span>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="px-2 py-1 rounded-md border border-slate-300 bg-slate-50 text-xs font-semibold text-slate-700 outline-none"
                title="페이지당 표시 행 수"
              >
                <option value={50}>50건씩 보기</option>
                <option value={100}>100건씩 보기</option>
                <option value={200}>200건씩 보기</option>
                <option value={999999}>전체 한 번에 보기</option>
              </select>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={safeCurrentPage <= 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-semibold disabled:opacity-40"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  <span>이전</span>
                </button>
                <span className="px-2 font-mono font-bold text-slate-800">
                  {safeCurrentPage} / {totalPages}
                </span>
                <button
                  type="button"
                  disabled={safeCurrentPage >= totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-semibold disabled:opacity-40"
                >
                  <span>다음</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        )}

        {/* Bottom Utility Footer */}
        <footer className="mt-8 pt-4 border-t border-slate-200 text-xs text-slate-500 text-center sm:text-left no-print">
          <div>
            공용 클라우드 대장(<code className="font-mono">dain_yongin_shared</code>)에 실시간 동기화되며, 재접속 시 빠른 표시를 위해 마지막 정상 수신 자료가 이 기기 캐시에 보관됩니다.
          </div>
        </footer>
      </main>

      {/* Sheet Create / Edit Modal */}
      {sheetModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <h3 className="text-base font-bold text-slate-900">
                {sheetModal.mode === 'create' ? '새 시트 추가' : '시트 이름 및 설명 수정'}
              </h3>
              <button
                type="button"
                onClick={() => setSheetModal(null)}
                className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveSheetModal} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  시트 이름 <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={sheetModal.name}
                  onChange={(e) => setSheetModal({ ...sheetModal, name: e.target.value })}
                  placeholder="예: 용인공장 → Y1 현장 반입, 2차 이전 등"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  시트 설명 (선택)
                </label>
                <input
                  type="text"
                  value={sheetModal.subtitle}
                  onChange={(e) => setSheetModal({ ...sheetModal, subtitle: e.target.value })}
                  placeholder="이 시트의 용도나 기준을 간단히 적어주세요"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setSheetModal(null)}
                  className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                >
                  {sheetModal.mode === 'create' ? '시트 추가' : '저장'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Material Item Modal */}
      {editingState && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl border border-slate-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <h3 className="text-base font-bold text-slate-900">자재 항목 수정</h3>
              <button
                type="button"
                onClick={() => setEditingState(null)}
                className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="space-y-3.5">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    소속 시트
                  </label>
                  <select
                    value={editingState.sheetId}
                    onChange={(e) =>
                      setEditingState({ ...editingState, sheetId: e.target.value })
                    }
                    className="w-full px-3 py-2 text-sm font-medium bg-slate-50 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {sheets.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    반입일자
                  </label>
                  <input
                    type="date"
                    value={editingState.item.date}
                    onChange={(e) =>
                      setEditingState({
                        ...editingState,
                        item: { ...editingState.item, date: e.target.value },
                      })
                    }
                    className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    구매처 (선택)
                  </label>
                  <input
                    type="text"
                    lang="ko"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    style={{ imeMode: 'active' }}
                    value={editingState.item.supplier || ''}
                    placeholder="생략 가능"
                    onChange={(e) =>
                      setEditingState({
                        ...editingState,
                        item: { ...editingState.item, supplier: e.target.value },
                      })
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    자재 품목명 <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    lang="ko"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    style={{ imeMode: 'active' }}
                    value={editingState.item.name}
                    onChange={(e) =>
                      setEditingState({
                        ...editingState,
                        item: { ...editingState.item, name: e.target.value },
                      })
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>


                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    규격 / 사양
                  </label>
                  <input
                    type="text"
                    value={editingState.item.spec}
                    placeholder="생략 가능"
                    onChange={(e) =>
                      setEditingState({
                        ...editingState,
                        item: { ...editingState.item, spec: e.target.value },
                      })
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    반입 수량 <span className="text-slate-400 font-normal">(미정 시 0)</span>
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    required
                    value={editingState.item.quantity}
                    onChange={(e) =>
                      setEditingState({
                        ...editingState,
                        item: {
                          ...editingState.item,
                          quantity: parseFloat(e.target.value) || 0,
                        },
                      })
                    }
                    className="w-full px-3 py-2 text-sm font-mono tabular-nums font-bold border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    단위
                  </label>
                  <input
                    type="text"
                    value={editingState.item.unit}
                    onChange={(e) =>
                      setEditingState({
                        ...editingState,
                        item: { ...editingState.item, unit: e.target.value },
                      })
                    }
                    placeholder="파레트, EA, BOX"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  비고 (선택)
                </label>
                <input
                  type="text"
                  value={editingState.item.remarks}
                  onChange={(e) =>
                    setEditingState({
                      ...editingState,
                      item: { ...editingState.item, remarks: e.target.value },
                    })
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {(() => {
                const editSlipIds = getItemSlipIds(editingState.item);
                if (editSlipIds.length === 0) {
                  return (
                    <div className="flex items-center justify-between p-3 bg-slate-50 border border-dashed border-slate-200 rounded-xl text-xs">
                      <div className="flex items-center gap-2 text-slate-600 font-medium">
                        <Receipt className="w-4 h-4 text-slate-400 shrink-0" />
                        <span>등록된 전표 사진이 없습니다. (납품증/거래명세서 추가 가능)</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const targetSheetId = editingState.sheetId;
                          const targetItem = editingState.item;
                          setEditingState(null);
                          setAttachingTarget({ sheetId: targetSheetId, item: targetItem });
                        }}
                        className="px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold border border-blue-200 rounded-lg transition-colors whitespace-nowrap shadow-xs"
                      >
                        + 전표 등록/연결
                      </button>
                    </div>
                  );
                }

                return (
                  <div className="flex items-center justify-between p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs">
                    <div className="flex items-center gap-2 text-amber-900 font-semibold">
                      {editSlipIds.length > 1 ? (
                        <>
                          <Layers className="w-4 h-4 text-blue-600 shrink-0" />
                          <span>
                            총 <strong className="text-blue-700">{editSlipIds.length}장</strong>의 전표 사진(납품증/거래명세서)이 보관되어 있습니다.
                          </span>
                        </>
                      ) : (
                        <>
                          <Receipt className="w-4 h-4 text-amber-700 shrink-0" />
                          <span>원본 전표(납품증/거래명세서) 사진이 보관되어 있습니다.</span>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => openSlipViewer(editSlipIds[0], editSlipIds)}
                        className="px-2.5 py-1 bg-amber-200 hover:bg-amber-300 text-amber-950 font-bold rounded-lg transition-colors whitespace-nowrap shadow-xs"
                      >
                        {editSlipIds.length > 1 ? `전표 ${editSlipIds.length}장 보기` : '전표 사진 보기'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const targetSheetId = editingState.sheetId;
                          const targetItem = editingState.item;
                          setEditingState(null);
                          setAttachingTarget({ sheetId: targetSheetId, item: targetItem });
                        }}
                        className="px-2 py-1 bg-white hover:bg-blue-50 text-blue-700 border border-blue-200 font-bold rounded-lg transition-colors whitespace-nowrap shadow-xs"
                        title="전표 추가 또는 관리"
                      >
                        + 관리
                      </button>
                    </div>
                  </div>
                );
              })()}

              <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingState(null)}
                  className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                >
                  변경사항 저장
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Custom Confirmation Dialog */}
      {confirmDialog && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-xl border border-slate-200">
            <h3 className="text-base font-bold text-slate-900">{confirmDialog.title}</h3>
            <p className="text-xs text-slate-600 mt-2 leading-relaxed">{confirmDialog.message}</p>
            <div className="flex items-center justify-end gap-2 mt-6 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setConfirmDialog(null)}
                className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                취소
              </button>
              <button
                type="button"
                onClick={confirmDialog.onConfirm}
                className={`px-4 py-2 text-xs font-semibold text-white rounded-lg transition-colors ${
                  confirmDialog.isDestructive
                    ? 'bg-rose-600 hover:bg-rose-700'
                    : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                {confirmDialog.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Standalone Single-File HTML Export Modal */}
      {showHtmlExportModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-xl border border-slate-200 flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Code className="w-5 h-5 text-blue-600" />
                  <span>싱글 파일 HTML 내보내기</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  구매처 열이 반영된 10열 대장 표 양식과 엑셀(.xlsx) 다운로드 기능이 하나의 HTML 파일로 저장됩니다.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowHtmlExportModal(false)}
                className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="my-4 flex-1 flex flex-col overflow-hidden">
              <div className="flex items-center justify-between text-xs text-slate-600 mb-2">
                <span>
                  포함된 시트: {sheets.map((s) => `${s.name}(${s.items.length}건)`).join(', ')}
                </span>
              </div>
              <div className="flex-1 overflow-auto bg-slate-900 rounded-xl p-3 text-slate-300 font-mono text-xs max-h-64 border border-slate-800">
                <pre className="whitespace-pre-wrap">
                  {standaloneHtmlCode.slice(0, 1200)}... (생략)
                </pre>
              </div>
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-slate-100 gap-3">
              <div className="text-xs text-slate-500">
                {copiedCode && (
                  <span className="text-emerald-600 font-medium flex items-center gap-1">
                    <Check className="w-3.5 h-3.5" /> 클립보드에 복사되었습니다!
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyHtmlCode}
                  className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg flex items-center gap-1.5 transition-colors"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>전체 HTML 복사</span>
                </button>
                <button
                  type="button"
                  onClick={handleDownloadHtmlFile}
                  className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg flex items-center gap-1.5 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>.html 파일 다운로드</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Lazy-Loaded Modals (mounted ONLY when opened to keep startup JS parse & DOM minimal) */}
      <Suspense fallback={null}>
        {showExcelImportModal && (
          <ExcelImportModal
            isOpen={showExcelImportModal}
            onClose={() => {
              setShowExcelImportModal(false);
              setDroppedExcelFile(null);
            }}
            sheets={sheets}
            activeTabId={activeTabId}
            initialFile={droppedExcelFile}
            onImportSingle={handleImportSingle}
            onImportMultipleSheets={handleImportMultipleSheets}
          />
        )}

        {showReceiptScanModal && (
          <ReceiptScanModal
            isOpen={showReceiptScanModal}
            onClose={() => {
              setShowReceiptScanModal(false);
              setDroppedReceiptFile(null);
            }}
            sheets={sheets}
            activeTabId={activeTabId}
            initialFile={droppedReceiptFile}
            onImportItems={handleImportSlipItems}
          />
        )}

        {Boolean(activeViewingSlipId) && (
          <SlipViewerModal
            slip={activeViewingSlip}
            isOpen={Boolean(activeViewingSlipId)}
            isLoading={slipViewerLoading}
            onClose={() => {
              setActiveViewingSlipId(null);
              setViewerScopedSlipIds(null);
            }}
            associatedItems={associatedItemsForActiveSlip}
            onDeleteSlip={handleDeleteSlip}
            allSlips={viewerSlipsList}
            onNavigateSlip={(nextId) => openSlipViewer(nextId, viewerScopedSlipIds || undefined)}
          />
        )}

        {showSlipArchiveModal && (
          <SlipArchiveModal
            isOpen={showSlipArchiveModal}
            onClose={() => setShowSlipArchiveModal(false)}
            slips={slips}
            sheets={sheets}
            activeTabId={activeTabId}
            onSelectSlip={(slip) => openSlipViewer(slip.id)}
            onDeleteSlip={handleDeleteSlip}
            onClearAllSlips={handleClearAllSlips}
            onOpenScanNewSlip={(initialFile) => {
              if (initialFile) setDroppedReceiptFile(initialFile);
              setShowReceiptScanModal(true);
            }}
          />
        )}

        {Boolean(attachingTarget) && (
          <AttachSlipModal
            isOpen={Boolean(attachingTarget)}
            onClose={() => setAttachingTarget(null)}
            item={currentAttachingItem}
            sheetId={attachingTarget?.sheetId || null}
            sheetName={
              sheets.find((s) => s.id === attachingTarget?.sheetId)?.name || '선택된 시트'
            }
            slips={slips}
            onAttachSlip={handleAttachSlipToItem}
            onRemoveSlip={handleRemoveSlipFromItem}
            onOpenViewer={(slipId) => {
              const currentItemSlipIds = currentAttachingItem
                ? getItemSlipIds(currentAttachingItem)
                : undefined;
              openSlipViewer(slipId, currentItemSlipIds);
            }}
            onAddNewSlipToArchive={(newSlip) => {
              setSlips((prev) => [newSlip, ...prev.filter((s) => s.id !== newSlip.id)]);
              void persistSlipToSharedCloud(newSlip);
            }}
            onOpenAiScan={(initialFile) => {
              if (initialFile) setDroppedReceiptFile(initialFile);
              setShowReceiptScanModal(true);
            }}
          />
        )}

        {Boolean(droppedSlipIntentFile) && (
          <DropSlipIntentModal
            isOpen={Boolean(droppedSlipIntentFile)}
            onClose={() => setDroppedSlipIntentFile(null)}
            file={droppedSlipIntentFile}
            sheets={sheets}
            activeTabId={activeTabId}
            onAttachToExistingItem={(targetSheetId, targetItem, file) => {
              handleDirectDropSlipOnItem(targetSheetId, targetItem, file);
            }}
            onProceedToAiScan={(file) => {
              setDroppedReceiptFile(file);
              setShowReceiptScanModal(true);
            }}
          />
        )}

        {showChatbotModal && (
          <GeminiChatbotModal
            isOpen={showChatbotModal}
            onClose={() => setShowChatbotModal(false)}
            activeSheet={activeSheet}
            allSheets={sheets}
            siteName={siteName}
          />
        )}

        {inspectedMaterialTarget &&
          (() => {
            const targetKey = makeFavoriteLookupKey(
              inspectedMaterialTarget.name,
              inspectedMaterialTarget.spec
            );
            const cleanTargetName = inspectedMaterialTarget.name
              .trim()
              .replace(/\s+/g, ' ')
              .toLowerCase();

            const searchPool =
              activeTabId === FAVORITE_MATERIALS_TAB_ID
                ? allSheetsEntries
                : integratedEntries;

            let exactEntries = searchPool.filter(
              (e) => makeFavoriteLookupKey(e.item.name, e.item.spec) === targetKey
            );
            if (exactEntries.length === 0) {
              exactEntries = allSheetsEntries.filter(
                (e) => makeFavoriteLookupKey(e.item.name, e.item.spec) === targetKey
              );
            }

            let sameNameEntries = searchPool.filter(
              (e) => e.item.name.trim().replace(/\s+/g, ' ').toLowerCase() === cleanTargetName
            );
            if (sameNameEntries.length === 0) {
              sameNameEntries = allSheetsEntries.filter(
                (e) => e.item.name.trim().replace(/\s+/g, ' ').toLowerCase() === cleanTargetName
              );
            }

            const isFav = isItemFavorited(
              inspectedMaterialTarget.name,
              inspectedMaterialTarget.spec
            );

            return (
              <MaterialQuantityModal
                isOpen={true}
                onClose={() => setInspectedMaterialTarget(null)}
                targetName={inspectedMaterialTarget.name}
                targetSpec={inspectedMaterialTarget.spec}
                entries={exactEntries}
                sameNameEntries={sameNameEntries}
                isFavorited={isFav}
                onToggleFavorite={() => {
                  const grp =
                    allIntegratedGroupLookup.get(targetKey) ||
                    itemGroupLookup.get(targetKey);
                  toggleFavoriteByKey(
                    targetKey,
                    inspectedMaterialTarget.name,
                    grp?.entryCount || exactEntries.length || 1
                  );
                }}
                onFilterInLedger={(filterName) => setSearchTerm(filterName)}
                onOpenSlipViewer={(slipId, scopedIds) => openSlipViewer(slipId, scopedIds)}
              />
            );
          })()}

        {showCloudSyncModal && (
          <CloudSyncModal
            isOpen={showCloudSyncModal}
            onClose={() => setShowCloudSyncModal(false)}
            syncStatus={syncStatus}
            syncError={syncError}
            syncConflicts={syncConflicts}
            lastSyncedAt={lastSyncedAt}
            onRetrySync={() => void handleRetrySharedSync()}
            onDismissConflicts={() => {
              setSyncConflicts([]);
              setSyncStatus('saved');
            }}
            sharedData={sharedData}
            slipsCountOverride={headerSlipCount}
            migrationsOverride={migrationsList}
            localData={readLegacyLocalPayload()}
            legacyAccountData={legacyAccountData}
            onDownloadCurrentBackup={handleDownloadCurrentBackup}
            onMigrateLocalStorage={handleMigrateLocalStorage}
            onMigrateLegacyAccount={handleMigrateLegacyAccount}
            onMigrateJsonBackupFile={handleMigrateJsonBackupFile}
            onInitializeFreshSharedLedger={handleInitializeFreshSharedLedger}
            onClearLegacyLocalAfterMigration={handleClearLegacyLocalAfterMigration}
          />
        )}
      </Suspense>

      {/* Floating Gemini AI Chatbot Trigger Button */}
      <div className="fixed bottom-5 right-5 z-40 no-print">
        <button
          type="button"
          onClick={() => setShowChatbotModal(true)}
          className="group flex items-center gap-2 px-3.5 py-2.5 bg-slate-900 hover:bg-blue-600 text-white rounded-full shadow-xl border border-slate-700 hover:border-blue-500 transition-all duration-200 hover:scale-105 active:scale-95"
          title="Gemini AI 자재 상담 비서 열기"
        >
          <div className="relative">
            <Bot className="w-4 h-4 text-blue-400 group-hover:text-white transition-colors" />
            <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
          </div>
          <span className="text-xs font-bold tracking-tight">AI 자재 상담</span>
          <span className="px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
            초고속 Lite
          </span>
        </button>
      </div>
    </div>
  );
}

