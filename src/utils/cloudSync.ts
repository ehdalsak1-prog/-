import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  writeBatch,
  serverTimestamp,
  deleteDoc,
  runTransaction,
  updateDoc,
  arrayUnion,
  arrayRemove,
  Timestamp,
} from 'firebase/firestore';
import {
  db,
  OperationType,
  handleFirestoreError,
  sanitizeFirestoreId,
  SHARED_LEDGER_ID,
} from '../firebase';
import { StoredReceiptSlip } from './slipStorage';
import {
  uploadSharedSlipAssetToStorage,
  deleteSharedSlipAssetFromStorage,
} from './firebaseStorage';
import type { MaterialItem, MaterialSheet } from '../App';

export type SharedSyncStatus =
  | 'cached_checking'
  | 'connecting'
  | 'saving'
  | 'saved'
  | 'conflict'
  | 'error';

export const SHARED_LEDGER_CACHE_KEY = 'dain_shared_ledger_cache_v1';
export const SHARED_ACTIVE_TAB_CACHE_KEY = 'dain_shared_active_tab_v1';

export interface SharedLedgerCachePayload {
  version: number;
  ledgerId: string;
  cachedAt: number;
  siteName: string;
  favoritePinnedKeys: string[];
  favoriteMutedAutoKeys: string[];
  sheets: MaterialSheet[];
}

export function readSharedLedgerCache(): SharedLedgerCachePayload | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const raw = window.localStorage.getItem(SHARED_LEDGER_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      parsed.ledgerId !== SHARED_LEDGER_ID ||
      !Array.isArray(parsed.sheets) ||
      parsed.sheets.length === 0
    ) {
      return null;
    }
    return {
      version: 1,
      ledgerId: SHARED_LEDGER_ID,
      cachedAt: typeof parsed.cachedAt === 'number' ? parsed.cachedAt : Date.now(),
      siteName:
        typeof parsed.siteName === 'string' && parsed.siteName.trim()
          ? parsed.siteName
          : '신규 발주 자재 반입 관리',
      favoritePinnedKeys: Array.isArray(parsed.favoritePinnedKeys)
        ? parsed.favoritePinnedKeys
        : [],
      favoriteMutedAutoKeys: Array.isArray(parsed.favoriteMutedAutoKeys)
        ? parsed.favoriteMutedAutoKeys
        : [],
      sheets: parsed.sheets,
    };
  } catch {
    return null;
  }
}

export function writeSharedLedgerCache(payload: {
  siteName: string;
  favoritePinnedKeys: string[];
  favoriteMutedAutoKeys: string[];
  sheets: MaterialSheet[];
}): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    if (!Array.isArray(payload.sheets) || payload.sheets.length === 0) return;
    const cacheDoc: SharedLedgerCachePayload = {
      version: 1,
      ledgerId: SHARED_LEDGER_ID,
      cachedAt: Date.now(),
      siteName: payload.siteName || '신규 발주 자재 반입 관리',
      favoritePinnedKeys: payload.favoritePinnedKeys || [],
      favoriteMutedAutoKeys: payload.favoriteMutedAutoKeys || [],
      sheets: payload.sheets,
    };
    window.localStorage.setItem(SHARED_LEDGER_CACHE_KEY, JSON.stringify(cacheDoc));
  } catch {
    // Ignore storage quota errors cleanly
  }
}

export function readCachedActiveTabId(): string | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const val = window.localStorage.getItem(SHARED_ACTIVE_TAB_CACHE_KEY);
    return val && val.trim() ? val.trim() : null;
  } catch {
    return null;
  }
}

export function writeCachedActiveTabId(tabId: string): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    if (tabId) {
      window.localStorage.setItem(SHARED_ACTIVE_TAB_CACHE_KEY, tabId);
    }
  } catch {
    // ignore
  }
}

export interface MigrationRecordInfo {
  id: string;
  sourceType: 'local_storage' | 'legacy_uid' | 'json_backup' | 'fresh_seed';
  sourceLabel: string;
  backupTimestamp: string;
  sheetsCount: number;
  itemsCount: number;
  slipsCount: number;
  createdAtMillis: number;
}

export interface SharedLedgerTimingInfo {
  workspaceMs?: number;
  sheetsMs?: number;
  priorityItemsMs?: number;
  firstPaintReadyMs?: number;
  allItemsMs?: number;
}

export interface SharedLedgerData {
  siteName: string;
  favoritePinnedKeys: string[];
  favoriteMutedAutoKeys: string[];
  sheets: MaterialSheet[];
  slips: StoredReceiptSlip[];
  migrations: MigrationRecordInfo[];
  migratedFromLegacy: boolean;
  lastMigrationId: string;
  cloudExists: boolean;
  hasWorkspaceDoc: boolean;
  isFromServer: boolean;
  isAllSheetsSynced: boolean;
  timingMs?: SharedLedgerTimingInfo;
  knownSheetIds: Set<string>;
  knownItemIds: Set<string>;
  knownSlipIds: Set<string>;
}

export interface SyncableSnapshot {
  siteName: string;
  favoritePinnedKeys: string[];
  favoriteMutedAutoKeys: string[];
  sheets: MaterialSheet[];
}

export interface SyncConflictInfo {
  itemId: string;
  itemName: string;
  reason: string;
}

export interface LocalBackupPayload {
  version: number;
  backedUpAt: string;
  source?: string;
  siteName: string;
  favoritePinnedKeys: string[];
  favoriteMutedAutoKeys: string[];
  sheets: MaterialSheet[];
  slips: StoredReceiptSlip[];
}

function clampStr(val: unknown, maxLen: number, fallback = ''): string {
  const s = typeof val === 'string' ? val : String(val ?? fallback);
  return s.slice(0, maxLen);
}

function clampNum(val: unknown, min = 0, max = 100000000, fallback = 0): number {
  const n = typeof val === 'number' ? val : parseFloat(String(val));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function clampStrList(val: unknown, maxItems: number, maxItemLen = 200): string[] {
  if (!Array.isArray(val)) return [];
  return val
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .slice(0, maxItems)
    .map((v) => v.slice(0, maxItemLen));
}

function serializeItemContent(
  sheetId: string,
  it: MaterialItem,
  orderIndex: number
): string {
  const slipIds = Array.isArray(it.slipIds)
    ? it.slipIds.slice(0, 30).map((s) => sanitizeFirestoreId(s, 'slip'))
    : it.slipId
    ? [sanitizeFirestoreId(it.slipId, 'slip')]
    : [];

  return JSON.stringify({
    sheetId: sanitizeFirestoreId(sheetId, 'sheet'),
    orderIndex: clampNum(orderIndex, 0, 100000, 0),
    name: clampStr(it.name.trim() || '자재', 300, '자재'),
    supplier: clampStr(it.supplier || '', 200),
    spec: clampStr(it.spec || '-', 300, '-'),
    unit: clampStr(it.unit || 'EA', 50, 'EA'),
    quantity: clampNum(it.quantity, 0, 100000000, 0),
    packQty: clampNum(it.packQty || 0, 0, 1000000, 0),
    subUnit: clampStr(it.subUnit || 'EA', 50, 'EA'),
    isCompleted: Boolean(it.isCompleted),
    location: clampStr(it.location || '', 200),
    remarks: clampStr(it.remarks || '', 1000),
    date: clampStr(it.date || '', 32),
    slipIds,
  });
}

function serializeSheetsCompare(s: SyncableSnapshot): string {
  return JSON.stringify({
    siteName: s.siteName,
    favoritePinnedKeys: s.favoritePinnedKeys,
    favoriteMutedAutoKeys: s.favoriteMutedAutoKeys,
    sheets: s.sheets.map((sh, sIdx) => ({
      id: sanitizeFirestoreId(sh.id, 'sheet'),
      name: sh.name,
      subtitle: sh.subtitle,
      orderIndex: sIdx,
      items: sh.items.map((it, iIdx) => ({
        id: sanitizeFirestoreId(it.id, 'mat'),
        content: serializeItemContent(sh.id, it, iIdx),
      })),
    })),
  });
}

export function areSnapshotsEquivalent(
  a: SyncableSnapshot | null,
  b: SyncableSnapshot | null
): boolean {
  if (!a || !b) return false;
  return serializeSheetsCompare(a) === serializeSheetsCompare(b);
}

function timestampToMillis(ts: unknown, fallback = Date.now()): number {
  if (typeof ts === 'number' && Number.isFinite(ts)) return ts;
  if (ts && typeof (ts as Timestamp).toMillis === 'function') {
    return (ts as Timestamp).toMillis();
  }
  return fallback;
}

/**
 * Merges an incoming server snapshot with any locally edited (unsaved) items so that
 * concurrent additions/edits by colleagues appear immediately without wiping the user's active edit.
 */
export function mergeIncomingWithDirtyLocal(
  prevSynced: SyncableSnapshot | null,
  currentLocal: SyncableSnapshot,
  incomingRemote: SyncableSnapshot
): SyncableSnapshot {
  if (!prevSynced) return incomingRemote;

  const prevItems = new Map<string, string>();
  prevSynced.sheets.forEach((sh) => {
    sh.items.forEach((it, idx) => {
      prevItems.set(sanitizeFirestoreId(it.id, 'mat'), serializeItemContent(sh.id, it, idx));
    });
  });

  // Identify items modified locally since prevSynced
  const dirtyLocalItems = new Map<string, { item: MaterialItem; sheetId: string }>();
  const addedLocalItemsBySheet = new Map<string, MaterialItem[]>();

  currentLocal.sheets.forEach((sh) => {
    const shId = sanitizeFirestoreId(sh.id, 'sheet');
    sh.items.forEach((it, idx) => {
      const itId = sanitizeFirestoreId(it.id, 'mat');
      const prevSer = prevItems.get(itId);
      const currSer = serializeItemContent(shId, it, idx);
      if (prevSer === undefined) {
        if (!addedLocalItemsBySheet.has(shId)) addedLocalItemsBySheet.set(shId, []);
        addedLocalItemsBySheet.get(shId)!.push(it);
      } else if (prevSer !== currSer) {
        dirtyLocalItems.set(itId, { item: it, sheetId: shId });
      }
    });
  });

  // If no dirty local items exist, use remote directly
  if (dirtyLocalItems.size === 0 && addedLocalItemsBySheet.size === 0) {
    return incomingRemote;
  }

  const remoteItemIds = new Set<string>();
  const mergedSheets: MaterialSheet[] = incomingRemote.sheets.map((rSh) => {
    const rShId = sanitizeFirestoreId(rSh.id, 'sheet');
    const mergedItems: MaterialItem[] = rSh.items.map((rIt) => {
      const rItId = sanitizeFirestoreId(rIt.id, 'mat');
      remoteItemIds.add(rItId);
      const dirty = dirtyLocalItems.get(rItId);
      if (dirty && dirty.sheetId === rShId) {
        // Keep local edited fields, but adopt latest server revision if unchanged on server
        const prevRev =
          prevSynced.sheets
            .flatMap((s) => s.items)
            .find((x) => sanitizeFirestoreId(x.id, 'mat') === rItId)?.revision ?? 1;
        if ((rIt.revision ?? 1) === prevRev) {
          return { ...dirty.item, revision: rIt.revision };
        }
      }
      return rIt;
    });

    const localAdds = addedLocalItemsBySheet.get(rShId) || [];
    for (const addIt of localAdds) {
      const addId = sanitizeFirestoreId(addIt.id, 'mat');
      if (!remoteItemIds.has(addId)) {
        mergedItems.push(addIt);
        remoteItemIds.add(addId);
      }
    }

    return {
      ...rSh,
      items: mergedItems,
    };
  });

  return {
    siteName:
      currentLocal.siteName !== prevSynced.siteName
        ? currentLocal.siteName
        : incomingRemote.siteName,
    favoritePinnedKeys:
      JSON.stringify(currentLocal.favoritePinnedKeys) !==
      JSON.stringify(prevSynced.favoritePinnedKeys)
        ? currentLocal.favoritePinnedKeys
        : incomingRemote.favoritePinnedKeys,
    favoriteMutedAutoKeys:
      JSON.stringify(currentLocal.favoriteMutedAutoKeys) !==
      JSON.stringify(prevSynced.favoriteMutedAutoKeys)
        ? currentLocal.favoriteMutedAutoKeys
        : incomingRemote.favoriteMutedAutoKeys,
    sheets: mergedSheets,
  };
}

function parseSharedItemDoc(d: { id: string; data: () => Record<string, any> }): {
  item: MaterialItem;
  sheetId: string;
  orderIndex: number;
} {
  const data = d.data();
  const slipIds = Array.isArray(data.slipIds)
    ? data.slipIds.filter((x: unknown): x is string => typeof x === 'string' && Boolean(x))
    : [];
  const packQtyNum =
    typeof data.packQty === 'number' && data.packQty > 0 ? data.packQty : undefined;
  const item: MaterialItem = {
    id: d.id,
    name: String(data.name || ''),
    supplier: String(data.supplier || ''),
    spec: String(data.spec || '-'),
    unit: String(data.unit || 'EA'),
    quantity: typeof data.quantity === 'number' ? data.quantity : 0,
    packQty: packQtyNum,
    subUnit: packQtyNum ? String(data.subUnit || 'EA') : undefined,
    isCompleted: Boolean(data.isCompleted),
    location: String(data.location || ''),
    remarks: String(data.remarks || ''),
    date: String(data.date || ''),
    createdAt: timestampToMillis(data.clientCreatedAt, timestampToMillis(data.createdAt)),
    slipIds,
    slipId: slipIds[0],
    revision: typeof data.revision === 'number' && data.revision >= 1 ? data.revision : 1,
  };
  return {
    item,
    sheetId: String(data.sheetId || ''),
    orderIndex: typeof data.orderIndex === 'number' ? data.orderIndex : 0,
  };
}

function parseSharedSlipDoc(d: { id: string; data: () => Record<string, any> }): StoredReceiptSlip {
  const data = d.data();
  return {
    id: d.id,
    title: String(data.title || '전표'),
    documentType: String(data.documentType || '납품/반입 전표'),
    supplierName: String(data.supplierName || ''),
    documentDate: String(data.documentDate || ''),
    receiverName: String(data.receiverName || ''),
    totalAmount:
      typeof data.totalAmount === 'number' && data.totalAmount > 0 ? data.totalAmount : undefined,
    notes: String(data.notes || ''),
    sheetId: String(data.sheetId || ''),
    sheetName: String(data.sheetName || ''),
    itemIds: Array.isArray(data.itemIds) ? data.itemIds : [],
    itemNames: Array.isArray(data.itemNames) ? data.itemNames : [],
    imageUrl: String(data.imageUrl || ''),
    storagePath: String(data.storagePath || ''),
    fileName: String(data.fileName || ''),
    fileSize: typeof data.fileSize === 'number' ? data.fileSize : undefined,
    createdAt: timestampToMillis(data.clientCreatedAt, timestampToMillis(data.createdAt)),
  };
}

const singleSlipMemoryCache = new Map<string, StoredReceiptSlip>();

export async function fetchSingleSharedSlip(slipId: string): Promise<StoredReceiptSlip | null> {
  const safeId = sanitizeFirestoreId(slipId, 'slip');
  const cached = singleSlipMemoryCache.get(safeId);
  if (cached) return cached;

  const slipPath = `ledgers/${SHARED_LEDGER_ID}/slips/${safeId}`;
  try {
    const snap = await getDoc(doc(db, 'ledgers', SHARED_LEDGER_ID, 'slips', safeId));
    if (!snap.exists()) return null;
    const parsed = parseSharedSlipDoc(snap);
    singleSlipMemoryCache.set(safeId, parsed);
    return parsed;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, slipPath);
  }
}

export function subscribeSharedSlips(callbacks: {
  onData: (slips: StoredReceiptSlip[]) => void;
  onError: (err: Error) => void;
}): () => void {
  const slipsPath = `ledgers/${SHARED_LEDGER_ID}/slips`;
  return onSnapshot(
    query(
      collection(db, 'ledgers', SHARED_LEDGER_ID, 'slips'),
      where('ledgerId', '==', SHARED_LEDGER_ID)
    ),
    (snap) => {
      const parsed = snap.docs
        .map((d) => {
          const item = parseSharedSlipDoc(d);
          singleSlipMemoryCache.set(item.id, item);
          return item;
        })
        .sort((a, b) => b.createdAt - a.createdAt);
      callbacks.onData(parsed);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, slipsPath);
      } catch (e) {
        callbacks.onError(e instanceof Error ? e : new Error(String(e)));
      }
    }
  );
}

export function subscribeSharedMigrations(callbacks: {
  onData: (migrations: MigrationRecordInfo[]) => void;
  onError: (err: Error) => void;
}): () => void {
  const migPath = `ledgers/${SHARED_LEDGER_ID}/migrations`;
  return onSnapshot(
    query(
      collection(db, 'ledgers', SHARED_LEDGER_ID, 'migrations'),
      where('ledgerId', '==', SHARED_LEDGER_ID)
    ),
    (snap) => {
      const parsed = snap.docs
        .map((d) => {
          const data = d.data();
          return {
            id: d.id,
            sourceType: data.sourceType || 'local_storage',
            sourceLabel: String(data.sourceLabel || ''),
            backupTimestamp: String(data.backupTimestamp || ''),
            sheetsCount: typeof data.sheetsCount === 'number' ? data.sheetsCount : 0,
            itemsCount: typeof data.itemsCount === 'number' ? data.itemsCount : 0,
            slipsCount: typeof data.slipsCount === 'number' ? data.slipsCount : 0,
            createdAtMillis: timestampToMillis(data.createdAt),
          } as MigrationRecordInfo;
        })
        .sort((a, b) => b.createdAtMillis - a.createdAtMillis);
      callbacks.onData(parsed);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, migPath);
      } catch (e) {
        callbacks.onError(e instanceof Error ? e : new Error(String(e)));
      }
    }
  );
}

/**
 * Progressive, non-blocking subscription to the shared company ledger (`/ledgers/dain_yongin_shared`):
 * - Stage 1 (First Paint): Fetches `workspace`, `sheets` metadata, and ONLY the active/priority sheet's items.
 *   Never blocks on `slips` or `migrations`.
 * - Stage 2 (Background / On-Demand): Subscribes to all remaining items across all sheets once Stage 1
 *   renders (or immediately if requested), then unsubscribes the temporary Stage 1 single-sheet listener
 *   to guarantee zero duplicate listeners.
 */
export function subscribeSharedLedger(
  callbacks: {
    onData: (data: SharedLedgerData) => void;
    onError: (err: Error) => void;
  },
  options?: {
    prioritySheetId?: string;
    deferBackgroundMs?: number;
  }
): { unsubscribe: () => void; requestAllSheets: () => void } {
  const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const timingMs: SharedLedgerTimingInfo = {};

  const rawPriority = options?.prioritySheetId || '';
  const resolvedPrioritySheetId =
    rawPriority &&
    rawPriority !== 'ALL' &&
    rawPriority !== 'FAVORITE_MATERIALS'
      ? sanitizeFirestoreId(rawPriority, 'sheet')
      : 'sheet-yongin-direct';

  let workspaceDocExists = false;
  let workspaceFromCache = true;
  let workspaceData = {
    siteName: '신규 발주 자재 반입 관리',
    favoritePinnedKeys: [] as string[],
    favoriteMutedAutoKeys: [] as string[],
    sheetOrder: [] as string[],
    migratedFromLegacy: false,
    lastMigrationId: '',
  };

  let rawSheets: Array<{ id: string; name: string; subtitle: string; orderIndex: number }> = [];
  let sheetsFromCache = true;
  let priorityItems: Array<{ item: MaterialItem; sheetId: string; orderIndex: number }> = [];
  let allItems: Array<{ item: MaterialItem; sheetId: string; orderIndex: number }> = [];
  let itemsFromCache = true;

  let readyWorkspace = false;
  let readySheets = false;
  let readyPriorityItems = false;
  let readyAllItems = false;

  let allItemsAttached = false;
  let isDisposed = false;
  let bgTimer: number | null = null;
  let unsubPriorityItems: (() => void) | null = null;
  let unsubAllItems: (() => void) | null = null;

  const nowElapsed = () =>
    Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - startTime);

  const emitIfReady = () => {
    if (isDisposed) return;
    if (!readyWorkspace || !readySheets) return;
    if (!readyPriorityItems && !readyAllItems) return;

    if (timingMs.firstPaintReadyMs === undefined) {
      timingMs.firstPaintReadyMs = nowElapsed();
    }

    const orderMap = new Map<string, number>();
    workspaceData.sheetOrder.forEach((id, idx) => orderMap.set(id, idx));

    const sortedSheets = [...rawSheets].sort((a, b) => {
      const oa = orderMap.has(a.id) ? orderMap.get(a.id)! : 10000 + a.orderIndex;
      const ob = orderMap.has(b.id) ? orderMap.get(b.id)! : 10000 + b.orderIndex;
      if (oa !== ob) return oa - ob;
      return a.orderIndex - b.orderIndex;
    });

    const activeItemsPool = readyAllItems ? allItems : priorityItems;
    const itemsBySheet = new Map<string, Array<{ item: MaterialItem; orderIndex: number }>>();
    for (const entry of activeItemsPool) {
      if (!itemsBySheet.has(entry.sheetId)) {
        itemsBySheet.set(entry.sheetId, []);
      }
      itemsBySheet.get(entry.sheetId)!.push(entry);
    }

    const hydratedSheets: MaterialSheet[] = sortedSheets.map((sh) => {
      const list = itemsBySheet.get(sh.id) || [];
      list.sort((a, b) => {
        if (a.orderIndex !== b.orderIndex) return a.orderIndex - b.orderIndex;
        return (a.item.createdAt || 0) - (b.item.createdAt || 0);
      });
      return {
        id: sh.id,
        name: sh.name,
        subtitle: sh.subtitle,
        items: list.map((x) => x.item),
      };
    });

    const allFromServer = !workspaceFromCache && !sheetsFromCache && !itemsFromCache;

    callbacks.onData({
      siteName: workspaceData.siteName,
      favoritePinnedKeys: workspaceData.favoritePinnedKeys,
      favoriteMutedAutoKeys: workspaceData.favoriteMutedAutoKeys,
      sheets: hydratedSheets,
      slips: [],
      migrations: [],
      migratedFromLegacy: workspaceData.migratedFromLegacy,
      lastMigrationId: workspaceData.lastMigrationId,
      cloudExists:
        workspaceDocExists || rawSheets.length > 0 || activeItemsPool.length > 0,
      hasWorkspaceDoc: workspaceDocExists,
      isFromServer: allFromServer,
      isAllSheetsSynced: readyAllItems,
      timingMs: { ...timingMs },
      knownSheetIds: new Set(rawSheets.map((s) => s.id)),
      knownItemIds: new Set(activeItemsPool.map((i) => i.item.id)),
      knownSlipIds: new Set(),
    });
  };

  const attachAllItemsListener = () => {
    if (isDisposed || allItemsAttached) return;
    allItemsAttached = true;
    if (bgTimer !== null && typeof window !== 'undefined') {
      window.clearTimeout(bgTimer);
      bgTimer = null;
    }

    const itemsPath = `ledgers/${SHARED_LEDGER_ID}/items`;
    unsubAllItems = onSnapshot(
      query(
        collection(db, 'ledgers', SHARED_LEDGER_ID, 'items'),
        where('ledgerId', '==', SHARED_LEDGER_ID)
      ),
      { includeMetadataChanges: true },
      (snap) => {
        if (isDisposed) return;
        const isFirstAllEmit = !readyAllItems;
        readyAllItems = true;
        itemsFromCache = snap.metadata.fromCache;
        allItems = snap.docs.map((d) => parseSharedItemDoc(d));
        if (timingMs.allItemsMs === undefined && !snap.metadata.fromCache) {
          timingMs.allItemsMs = nowElapsed();
        }
        // Clean up temporary priority-sheet listener once full items listener is live
        if (isFirstAllEmit && unsubPriorityItems) {
          unsubPriorityItems();
          unsubPriorityItems = null;
        }
        emitIfReady();
      },
      (error) => {
        try {
          handleFirestoreError(error, OperationType.LIST, itemsPath);
        } catch (e) {
          callbacks.onError(e instanceof Error ? e : new Error(String(e)));
        }
      }
    );
  };

  const scheduleBackgroundAllItems = () => {
    if (allItemsAttached || bgTimer !== null) return;
    const delay = options?.deferBackgroundMs ?? 80;
    if (typeof window !== 'undefined') {
      bgTimer = window.setTimeout(() => {
        bgTimer = null;
        attachAllItemsListener();
      }, delay);
    } else {
      attachAllItemsListener();
    }
  };

  const wsPath = `ledgers/${SHARED_LEDGER_ID}`;
  const unsubWorkspace = onSnapshot(
    doc(db, 'ledgers', SHARED_LEDGER_ID),
    { includeMetadataChanges: true },
    (snap) => {
      if (isDisposed) return;
      readyWorkspace = true;
      workspaceFromCache = snap.metadata.fromCache;
      workspaceDocExists = snap.exists();
      if (timingMs.workspaceMs === undefined && !snap.metadata.fromCache) {
        timingMs.workspaceMs = nowElapsed();
      }
      if (snap.exists()) {
        const d = snap.data();
        workspaceData = {
          siteName:
            clampStr(d.siteName, 200, '신규 발주 자재 반입 관리') ||
            '신규 발주 자재 반입 관리',
          favoritePinnedKeys: clampStrList(d.favoritePinnedKeys, 500),
          favoriteMutedAutoKeys: clampStrList(d.favoriteMutedAutoKeys, 500),
          sheetOrder: clampStrList(d.sheetOrder, 100),
          migratedFromLegacy: Boolean(d.migratedFromLegacy),
          lastMigrationId: clampStr(d.lastMigrationId, 128),
        };
      }
      emitIfReady();
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, wsPath);
      } catch (e) {
        callbacks.onError(e instanceof Error ? e : new Error(String(e)));
      }
    }
  );

  const sheetsPath = `ledgers/${SHARED_LEDGER_ID}/sheets`;
  const unsubSheets = onSnapshot(
    query(
      collection(db, 'ledgers', SHARED_LEDGER_ID, 'sheets'),
      where('ledgerId', '==', SHARED_LEDGER_ID)
    ),
    { includeMetadataChanges: true },
    (snap) => {
      if (isDisposed) return;
      readySheets = true;
      sheetsFromCache = snap.metadata.fromCache;
      if (timingMs.sheetsMs === undefined && !snap.metadata.fromCache) {
        timingMs.sheetsMs = nowElapsed();
      }
      rawSheets = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          name: String(data.name || '새 시트'),
          subtitle: String(data.subtitle || ''),
          orderIndex: typeof data.orderIndex === 'number' ? data.orderIndex : 0,
        };
      });
      // If cached prioritySheetId doesn't exist in server sheets, immediately promote allItems
      if (
        rawSheets.length > 0 &&
        !rawSheets.some((s) => s.id === resolvedPrioritySheetId)
      ) {
        attachAllItemsListener();
      }
      emitIfReady();
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, sheetsPath);
      } catch (e) {
        callbacks.onError(e instanceof Error ? e : new Error(String(e)));
      }
    }
  );

  const priorityItemsPath = `ledgers/${SHARED_LEDGER_ID}/items?sheetId=${resolvedPrioritySheetId}`;
  unsubPriorityItems = onSnapshot(
    query(
      collection(db, 'ledgers', SHARED_LEDGER_ID, 'items'),
      where('ledgerId', '==', SHARED_LEDGER_ID),
      where('sheetId', '==', resolvedPrioritySheetId)
    ),
    { includeMetadataChanges: true },
    (snap) => {
      if (isDisposed) return;
      readyPriorityItems = true;
      if (!readyAllItems) {
        itemsFromCache = snap.metadata.fromCache;
      }
      if (timingMs.priorityItemsMs === undefined && !snap.metadata.fromCache) {
        timingMs.priorityItemsMs = nowElapsed();
      }
      priorityItems = snap.docs.map((d) => parseSharedItemDoc(d));
      emitIfReady();
      if (!snap.metadata.fromCache || snap.docs.length > 0) {
        scheduleBackgroundAllItems();
      }
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, priorityItemsPath);
      } catch (e) {
        callbacks.onError(e instanceof Error ? e : new Error(String(e)));
      }
    }
  );

  return {
    unsubscribe: () => {
      isDisposed = true;
      if (bgTimer !== null && typeof window !== 'undefined') {
        window.clearTimeout(bgTimer);
        bgTimer = null;
      }
      unsubWorkspace();
      unsubSheets();
      if (unsubPriorityItems) {
        unsubPriorityItems();
        unsubPriorityItems = null;
      }
      if (unsubAllItems) {
        unsubAllItems();
        unsubAllItems = null;
      }
    },
    requestAllSheets: () => {
      attachAllItemsListener();
    },
  };
}

function buildSharedItemPayload(
  sheetId: string,
  item: MaterialItem,
  orderIndex: number,
  isCreate: boolean,
  revision = 1
) {
  const safeId = sanitizeFirestoreId(item.id, 'mat');
  const safeSheetId = sanitizeFirestoreId(sheetId, 'sheet');
  const slipIds = Array.isArray(item.slipIds)
    ? item.slipIds.slice(0, 30).map((s) => sanitizeFirestoreId(s, 'slip'))
    : item.slipId
    ? [sanitizeFirestoreId(item.slipId, 'slip')]
    : [];

  const baseFields = {
    sheetId: safeSheetId,
    orderIndex: clampNum(orderIndex, 0, 100000, 0),
    name: clampStr(item.name.trim() || '자재', 300, '자재'),
    supplier: clampStr(item.supplier || '', 200),
    spec: clampStr(item.spec || '-', 300, '-'),
    unit: clampStr(item.unit || 'EA', 50, 'EA'),
    quantity: clampNum(item.quantity, 0, 100000000, 0),
    packQty: clampNum(item.packQty || 0, 0, 1000000, 0),
    subUnit: clampStr(item.subUnit || 'EA', 50, 'EA'),
    isCompleted: Boolean(item.isCompleted),
    location: clampStr(item.location || '', 200),
    remarks: clampStr(item.remarks || '', 1000),
    date: clampStr(item.date || '', 32),
    slipIds,
    revision: clampNum(revision, 1, 10000000, 1),
    updatedAt: serverTimestamp(),
  };

  if (isCreate) {
    return {
      ...baseFields,
      id: safeId,
      ledgerId: SHARED_LEDGER_ID,
      clientCreatedAt: clampNum(
        item.createdAt || Date.now(),
        0,
        Number.MAX_SAFE_INTEGER,
        Date.now()
      ),
      revision: 1,
      createdAt: serverTimestamp(),
    };
  }
  return baseFields;
}

type QueuedOp = (batch: ReturnType<typeof writeBatch>) => void;

async function commitBatchedOps(ops: QueuedOp[], pathContext: string) {
  const CHUNK_SIZE = 380;
  for (let i = 0; i < ops.length; i += CHUNK_SIZE) {
    const chunk = ops.slice(i, i + CHUNK_SIZE);
    const batch = writeBatch(db);
    chunk.forEach((fn) => fn(batch));
    try {
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, pathContext);
    }
  }
}

/**
 * Atomically syncs ONLY changed fields/sheets/items to the shared ledger:
 * - Item updates execute per-item Firestore transactions verifying `revision` to avoid silent overwrites.
 * - Workspace favorites use arrayUnion/arrayRemove when adding or removing keys.
 * - Only items/sheets present in `prev` and absent in `next` are deleted (never deleting teammates' concurrent additions).
 */
export async function syncSharedChangesToFirestore(params: {
  prev: SyncableSnapshot;
  next: SyncableSnapshot;
  knownSheetIds: Set<string>;
  knownItemIds: Set<string>;
  hasWorkspaceDoc: boolean;
}): Promise<{
  knownSheetIds: Set<string>;
  knownItemIds: Set<string>;
  hasWorkspaceDoc: boolean;
  conflicts: SyncConflictInfo[];
  updatedRevisions: Record<string, number>;
}> {
  const { prev, next } = params;
  const nextKnownSheets = new Set(params.knownSheetIds);
  const nextKnownItems = new Set(params.knownItemIds);
  let hasWorkspace = params.hasWorkspaceDoc;
  const conflicts: SyncConflictInfo[] = [];
  const updatedRevisions: Record<string, number> = {};

  const nextSheetOrder = next.sheets
    .map((s) => sanitizeFirestoreId(s.id, 'sheet'))
    .slice(0, 100);
  const prevSheetOrder = prev.sheets
    .map((s) => sanitizeFirestoreId(s.id, 'sheet'))
    .slice(0, 100);

  const wsRef = doc(db, 'ledgers', SHARED_LEDGER_ID);
  const ops: QueuedOp[] = [];

  // 1. Workspace doc updates (granular)
  if (!hasWorkspace) {
    ops.push((batch) =>
      batch.set(wsRef, {
        id: SHARED_LEDGER_ID,
        siteName: clampStr(next.siteName.trim() || '신규 발주 자재 반입 관리', 200),
        favoritePinnedKeys: clampStrList(next.favoritePinnedKeys, 500),
        favoriteMutedAutoKeys: clampStrList(next.favoriteMutedAutoKeys, 500),
        sheetOrder: nextSheetOrder,
        migratedFromLegacy: false,
        lastMigrationId: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
    hasWorkspace = true;
  } else {
    const wsUpdate: Record<string, any> = {};
    let hasWsFieldChange = false;

    if (prev.siteName !== next.siteName) {
      wsUpdate.siteName = clampStr(next.siteName.trim() || '신규 발주 자재 반입 관리', 200);
      hasWsFieldChange = true;
    }
    if (JSON.stringify(prevSheetOrder) !== JSON.stringify(nextSheetOrder)) {
      wsUpdate.sheetOrder = nextSheetOrder;
      hasWsFieldChange = true;
    }

    const pinnedAdded = next.favoritePinnedKeys.filter(
      (k) => !prev.favoritePinnedKeys.includes(k)
    );
    const pinnedRemoved = prev.favoritePinnedKeys.filter(
      (k) => !next.favoritePinnedKeys.includes(k)
    );
    if (pinnedAdded.length > 0 && pinnedRemoved.length === 0) {
      wsUpdate.favoritePinnedKeys = arrayUnion(...pinnedAdded.slice(0, 100));
      hasWsFieldChange = true;
    } else if (pinnedRemoved.length > 0 && pinnedAdded.length === 0) {
      wsUpdate.favoritePinnedKeys = arrayRemove(...pinnedRemoved.slice(0, 100));
      hasWsFieldChange = true;
    } else if (pinnedAdded.length > 0 || pinnedRemoved.length > 0) {
      wsUpdate.favoritePinnedKeys = clampStrList(next.favoritePinnedKeys, 500);
      hasWsFieldChange = true;
    }

    const mutedAdded = next.favoriteMutedAutoKeys.filter(
      (k) => !prev.favoriteMutedAutoKeys.includes(k)
    );
    const mutedRemoved = prev.favoriteMutedAutoKeys.filter(
      (k) => !next.favoriteMutedAutoKeys.includes(k)
    );
    if (mutedAdded.length > 0 && mutedRemoved.length === 0) {
      wsUpdate.favoriteMutedAutoKeys = arrayUnion(...mutedAdded.slice(0, 100));
      hasWsFieldChange = true;
    } else if (mutedRemoved.length > 0 && mutedAdded.length === 0) {
      wsUpdate.favoriteMutedAutoKeys = arrayRemove(...mutedRemoved.slice(0, 100));
      hasWsFieldChange = true;
    } else if (mutedAdded.length > 0 || mutedRemoved.length > 0) {
      wsUpdate.favoriteMutedAutoKeys = clampStrList(next.favoriteMutedAutoKeys, 500);
      hasWsFieldChange = true;
    }

    if (hasWsFieldChange) {
      wsUpdate.updatedAt = serverTimestamp();
      ops.push((batch) => batch.update(wsRef, wsUpdate));
    }
  }

  // Index prev sheets & items
  const prevSheetMap = new Map<
    string,
    { name: string; subtitle: string; orderIndex: number }
  >();
  const prevItemMap = new Map<
    string,
    { sheetId: string; orderIndex: number; serialized: string; revision: number }
  >();

  prev.sheets.forEach((sh, sIdx) => {
    const shId = sanitizeFirestoreId(sh.id, 'sheet');
    prevSheetMap.set(shId, { name: sh.name, subtitle: sh.subtitle, orderIndex: sIdx });
    sh.items.forEach((it, iIdx) => {
      const itId = sanitizeFirestoreId(it.id, 'mat');
      prevItemMap.set(itId, {
        sheetId: shId,
        orderIndex: iIdx,
        serialized: serializeItemContent(shId, it, iIdx),
        revision: typeof it.revision === 'number' && it.revision >= 1 ? it.revision : 1,
      });
    });
  });

  // 2. Sheets create / update
  const nextSheetIdSet = new Set<string>();
  const nextItemIdSet = new Set<string>();

  next.sheets.forEach((sh, sIdx) => {
    const shId = sanitizeFirestoreId(sh.id, 'sheet');
    nextSheetIdSet.add(shId);
    const prevSh = prevSheetMap.get(shId);
    const shRef = doc(db, 'ledgers', SHARED_LEDGER_ID, 'sheets', shId);

    if (!nextKnownSheets.has(shId) && !prevSh) {
      ops.push((batch) =>
        batch.set(shRef, {
          id: shId,
          ledgerId: SHARED_LEDGER_ID,
          name: clampStr(sh.name.trim() || '시트', 120, '시트'),
          subtitle: clampStr(sh.subtitle || '', 300),
          orderIndex: clampNum(sIdx, 0, 10000, 0),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
      nextKnownSheets.add(shId);
    } else if (
      prevSh &&
      (prevSh.name !== sh.name ||
        prevSh.subtitle !== sh.subtitle ||
        prevSh.orderIndex !== sIdx)
    ) {
      ops.push((batch) =>
        batch.update(shRef, {
          name: clampStr(sh.name.trim() || '시트', 120, '시트'),
          subtitle: clampStr(sh.subtitle || '', 300),
          orderIndex: clampNum(sIdx, 0, 10000, 0),
          updatedAt: serverTimestamp(),
        })
      );
    }
  });

  // 3. New items create (batch) vs Modified items (per-item revision-guarded transaction)
  const itemsToUpdateInTx: Array<{
    itemId: string;
    sheetId: string;
    item: MaterialItem;
    orderIndex: number;
    expectedRevision: number;
  }> = [];

  next.sheets.forEach((sh) => {
    const shId = sanitizeFirestoreId(sh.id, 'sheet');
    sh.items.forEach((it, iIdx) => {
      const itId = sanitizeFirestoreId(it.id, 'mat');
      nextItemIdSet.add(itId);
      const prevItem = prevItemMap.get(itId);

      if (!prevItem && !nextKnownItems.has(itId)) {
        const itRef = doc(db, 'ledgers', SHARED_LEDGER_ID, 'items', itId);
        ops.push((batch) =>
          batch.set(itRef, buildSharedItemPayload(shId, it, iIdx, true, 1))
        );
        nextKnownItems.add(itId);
      } else if (prevItem) {
        const serializedNext = serializeItemContent(shId, it, iIdx);
        if (prevItem.serialized !== serializedNext) {
          itemsToUpdateInTx.push({
            itemId: itId,
            sheetId: shId,
            item: it,
            orderIndex: iIdx,
            expectedRevision: prevItem.revision,
          });
        }
      }
    });
  });

  // 4. Delete ONLY items/sheets that were explicitly in `prev` and removed in `next`
  prevItemMap.forEach((_, oldItemId) => {
    if (!nextItemIdSet.has(oldItemId)) {
      ops.push((batch) =>
        batch.delete(doc(db, 'ledgers', SHARED_LEDGER_ID, 'items', oldItemId))
      );
      nextKnownItems.delete(oldItemId);
    }
  });

  prevSheetMap.forEach((_, oldSheetId) => {
    if (!nextSheetIdSet.has(oldSheetId)) {
      ops.push((batch) =>
        batch.delete(doc(db, 'ledgers', SHARED_LEDGER_ID, 'sheets', oldSheetId))
      );
      nextKnownSheets.delete(oldSheetId);
    }
  });

  // Commit workspace/sheet/create/delete batch first
  if (ops.length > 0) {
    await commitBatchedOps(ops, `ledgers/${SHARED_LEDGER_ID}`);
  }

  // Run per-item optimistic concurrency transactions for modified items
  for (const mod of itemsToUpdateInTx) {
    const itRef = doc(db, 'ledgers', SHARED_LEDGER_ID, 'items', mod.itemId);
    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(itRef);
        if (!snap.exists()) {
          throw new Error(`CONFLICT_DELETED:${mod.item.name}`);
        }
        const serverData = snap.data();
        const serverRev =
          typeof serverData.revision === 'number' ? serverData.revision : 1;
        if (serverRev !== mod.expectedRevision) {
          throw new Error(`CONFLICT_MODIFIED:${mod.item.name}`);
        }
        const nextRev = mod.expectedRevision + 1;
        const updatePayload = buildSharedItemPayload(
          mod.sheetId,
          mod.item,
          mod.orderIndex,
          false,
          nextRev
        );
        tx.update(itRef, updatePayload);
      });
      updatedRevisions[mod.itemId] = mod.expectedRevision + 1;
    } catch (err: any) {
      const msg = err?.message || '';
      if (msg.startsWith('CONFLICT_DELETED:')) {
        conflicts.push({
          itemId: mod.itemId,
          itemName: mod.item.name,
          reason: '다른 사용자가 방금 해당 품목을 삭제했습니다.',
        });
      } else if (
        msg.startsWith('CONFLICT_MODIFIED:') ||
        err?.code === 'permission-denied' ||
        err?.code === 'aborted'
      ) {
        conflicts.push({
          itemId: mod.itemId,
          itemName: mod.item.name,
          reason: '다른 사용자가 동시에 같은 품목을 먼저 수정했습니다.',
        });
      } else {
        handleFirestoreError(
          err,
          OperationType.UPDATE,
          `ledgers/${SHARED_LEDGER_ID}/items/${mod.itemId}`
        );
      }
    }
  }

  return {
    knownSheetIds: nextKnownSheets,
    knownItemIds: nextKnownItems,
    hasWorkspaceDoc: hasWorkspace,
    conflicts,
    updatedRevisions,
  };
}

/**
 * Uploads a slip image to the shared Firebase Storage path and saves slip metadata to Firestore.
 */
export async function saveSharedSlipToCloud(
  slip: StoredReceiptSlip,
  options?: { isExisting?: boolean; hasWorkspaceDoc?: boolean; rawFile?: File }
): Promise<StoredReceiptSlip> {
  const safeSlipId = sanitizeFirestoreId(slip.id, 'slip');

  let finalImageUrl = slip.imageUrl || '';
  let finalStoragePath = slip.storagePath || '';
  let finalFileSize = slip.fileSize || 0;

  if (
    options?.rawFile ||
    (finalImageUrl &&
      (!finalImageUrl.startsWith('https://firebasestorage.googleapis.com/') ||
        !finalStoragePath.startsWith(`ledgers/${SHARED_LEDGER_ID}/slips/`)))
  ) {
    const uploaded = await uploadSharedSlipAssetToStorage(
      safeSlipId,
      options?.rawFile || finalImageUrl,
      slip.fileName,
      finalStoragePath
    );
    finalImageUrl = uploaded.imageUrl;
    finalStoragePath = uploaded.storagePath;
    if (uploaded.fileSize > 0) finalFileSize = uploaded.fileSize;
  }

  const slipRef = doc(db, 'ledgers', SHARED_LEDGER_ID, 'slips', safeSlipId);
  const ops: QueuedOp[] = [];

  if (!options?.hasWorkspaceDoc) {
    const wsRef = doc(db, 'ledgers', SHARED_LEDGER_ID);
    ops.push((batch) =>
      batch.set(wsRef, {
        id: SHARED_LEDGER_ID,
        siteName: '신규 발주 자재 반입 관리',
        favoritePinnedKeys: [],
        favoriteMutedAutoKeys: [],
        sheetOrder: [],
        migratedFromLegacy: false,
        lastMigrationId: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  }

  const commonFields = {
    title: clampStr(slip.title || '전표', 300, '전표'),
    documentType: clampStr(slip.documentType || '납품/반입 전표', 100),
    supplierName: clampStr(slip.supplierName || '', 200),
    documentDate: clampStr(slip.documentDate || '', 32),
    receiverName: clampStr(slip.receiverName || '', 200),
    totalAmount: clampNum(slip.totalAmount || 0, 0, Number.MAX_SAFE_INTEGER, 0),
    notes: clampStr(slip.notes || '', 2000),
    sheetId: clampStr(sanitizeFirestoreId(slip.sheetId || 'sheet', 'sheet'), 128),
    sheetName: clampStr(slip.sheetName || '', 200),
    itemIds: clampStrList(slip.itemIds, 500, 128),
    itemNames: clampStrList(slip.itemNames, 500, 200),
    imageUrl: clampStr(finalImageUrl, 500000),
    storagePath: clampStr(finalStoragePath, 500),
    fileName: clampStr(slip.fileName || '', 300),
    fileSize: clampNum(finalFileSize, 0, Number.MAX_SAFE_INTEGER, 0),
    updatedAt: serverTimestamp(),
  };

  if (options?.isExisting) {
    ops.push((batch) => batch.update(slipRef, commonFields));
  } else {
    ops.push((batch) =>
      batch.set(slipRef, {
        ...commonFields,
        id: safeSlipId,
        ledgerId: SHARED_LEDGER_ID,
        clientCreatedAt: clampNum(
          slip.createdAt || Date.now(),
          0,
          Number.MAX_SAFE_INTEGER,
          Date.now()
        ),
        createdAt: serverTimestamp(),
      })
    );
  }

  await commitBatchedOps(ops, `ledgers/${SHARED_LEDGER_ID}/slips/${safeSlipId}`);

  const savedSlip: StoredReceiptSlip = {
    ...slip,
    id: safeSlipId,
    imageUrl: finalImageUrl,
    storagePath: finalStoragePath,
    fileSize: finalFileSize,
  };
  singleSlipMemoryCache.set(safeSlipId, savedSlip);
  return savedSlip;
}

export async function deleteSharedSlipFromCloud(
  slipId: string,
  storagePath?: string
): Promise<void> {
  const safeSlipId = sanitizeFirestoreId(slipId, 'slip');
  const slipRef = doc(db, 'ledgers', SHARED_LEDGER_ID, 'slips', safeSlipId);

  try {
    await deleteDoc(slipRef);
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.DELETE,
      `ledgers/${SHARED_LEDGER_ID}/slips/${safeSlipId}`
    );
  }

  singleSlipMemoryCache.delete(safeSlipId);

  if (storagePath) {
    await deleteSharedSlipAssetFromStorage(storagePath);
  }
}

export function createLocalBackupSnapshot(
  sourceTag: string,
  payload: Omit<LocalBackupPayload, 'version' | 'backedUpAt' | 'source'>
): string {
  const backupKey = `field_material_shared_backup_v1_${sanitizeFirestoreId(sourceTag, 'bak')}`;
  const fullPayload: LocalBackupPayload = {
    version: 2,
    backedUpAt: new Date().toISOString(),
    source: sourceTag,
    ...payload,
  };
  try {
    const lightBackup: LocalBackupPayload = {
      ...fullPayload,
      slips: fullPayload.slips.map((s) => ({
        ...s,
        imageUrl:
          s.imageUrl.startsWith('data:') && s.imageUrl.length > 150000 ? '' : s.imageUrl,
      })),
    };
    localStorage.setItem(backupKey, JSON.stringify(lightBackup));
  } catch (err) {
    console.warn('LocalStorage pre-migration backup quota warning:', err);
  }
  return backupKey;
}

export function downloadLocalBackupJsonFile(
  payload: Omit<LocalBackupPayload, 'version' | 'backedUpAt'>
): void {
  const full: LocalBackupPayload = {
    version: 2,
    backedUpAt: new Date().toISOString(),
    ...payload,
  };
  const blob = new Blob([JSON.stringify(full, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  const now = new Date();
  const ymd = now.toISOString().split('T')[0];
  const hm = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `(주)다인_공용대장_백업_${ymd}_${hm}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Silently reads legacy per-user cloud data (`/users/{uid}/...`) if the browser still holds an active legacy session.
 */
export async function fetchLegacyAccountCloudData(uid: string): Promise<{
  exists: boolean;
  siteName: string;
  favoritePinnedKeys: string[];
  favoriteMutedAutoKeys: string[];
  sheets: MaterialSheet[];
  slips: StoredReceiptSlip[];
}> {
  const safeUid = sanitizeFirestoreId(uid, 'user');
  const wsSnap = await getDoc(doc(db, 'users', safeUid));
  const sheetsSnap = await getDocs(
    query(collection(db, 'users', safeUid, 'sheets'), where('uid', '==', safeUid))
  );
  const itemsSnap = await getDocs(
    query(collection(db, 'users', safeUid, 'items'), where('uid', '==', safeUid))
  );
  const slipsSnap = await getDocs(
    query(collection(db, 'users', safeUid, 'slips'), where('uid', '==', safeUid))
  );

  const exists =
    wsSnap.exists() || !sheetsSnap.empty || !itemsSnap.empty || !slipsSnap.empty;

  const ws = wsSnap.exists() ? wsSnap.data() : {};
  const sheetOrder = clampStrList(ws.sheetOrder, 100);
  const orderMap = new Map<string, number>();
  sheetOrder.forEach((id, idx) => orderMap.set(id, idx));

  const itemsBySheet = new Map<string, Array<{ item: MaterialItem; orderIndex: number }>>();
  itemsSnap.docs.forEach((d) => {
    const data = d.data();
    const slipIds = Array.isArray(data.slipIds)
      ? data.slipIds.filter((x: unknown): x is string => typeof x === 'string' && Boolean(x))
      : [];
    const packQtyNum =
      typeof data.packQty === 'number' && data.packQty > 0 ? data.packQty : undefined;
    const item: MaterialItem = {
      id: d.id,
      name: String(data.name || ''),
      supplier: String(data.supplier || ''),
      spec: String(data.spec || '-'),
      unit: String(data.unit || 'EA'),
      quantity: typeof data.quantity === 'number' ? data.quantity : 0,
      packQty: packQtyNum,
      subUnit: packQtyNum ? String(data.subUnit || 'EA') : undefined,
      isCompleted: Boolean(data.isCompleted),
      location: String(data.location || ''),
      remarks: String(data.remarks || ''),
      date: String(data.date || ''),
      createdAt: timestampToMillis(data.clientCreatedAt, timestampToMillis(data.createdAt)),
      slipIds,
      slipId: slipIds[0],
      revision: 1,
    };
    const shId = String(data.sheetId || '');
    if (!itemsBySheet.has(shId)) itemsBySheet.set(shId, []);
    itemsBySheet.get(shId)!.push({
      item,
      orderIndex: typeof data.orderIndex === 'number' ? data.orderIndex : 0,
    });
  });

  const rawSheets = sheetsSnap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      name: String(data.name || '시트'),
      subtitle: String(data.subtitle || ''),
      orderIndex: typeof data.orderIndex === 'number' ? data.orderIndex : 0,
    };
  });

  rawSheets.sort((a, b) => {
    const oa = orderMap.has(a.id) ? orderMap.get(a.id)! : 10000 + a.orderIndex;
    const ob = orderMap.has(b.id) ? orderMap.get(b.id)! : 10000 + b.orderIndex;
    if (oa !== ob) return oa - ob;
    return a.orderIndex - b.orderIndex;
  });

  const sheets: MaterialSheet[] = rawSheets.map((sh) => {
    const list = itemsBySheet.get(sh.id) || [];
    list.sort((a, b) => a.orderIndex - b.orderIndex);
    return {
      id: sh.id,
      name: sh.name,
      subtitle: sh.subtitle,
      items: list.map((x) => x.item),
    };
  });

  const slips: StoredReceiptSlip[] = slipsSnap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      title: String(data.title || '전표'),
      documentType: String(data.documentType || '납품/반입 전표'),
      supplierName: String(data.supplierName || ''),
      documentDate: String(data.documentDate || ''),
      receiverName: String(data.receiverName || ''),
      totalAmount:
        typeof data.totalAmount === 'number' && data.totalAmount > 0
          ? data.totalAmount
          : undefined,
      notes: String(data.notes || ''),
      sheetId: String(data.sheetId || ''),
      sheetName: String(data.sheetName || ''),
      itemIds: Array.isArray(data.itemIds) ? data.itemIds : [],
      itemNames: Array.isArray(data.itemNames) ? data.itemNames : [],
      imageUrl: String(data.imageUrl || ''),
      storagePath: String(data.storagePath || ''),
      fileName: String(data.fileName || ''),
      fileSize: typeof data.fileSize === 'number' ? data.fileSize : undefined,
      createdAt: timestampToMillis(data.clientCreatedAt, timestampToMillis(data.createdAt)),
    };
  });

  return {
    exists,
    siteName: clampStr(ws.siteName, 200, '신규 발주 자재 반입 관리') || '신규 발주 자재 반입 관리',
    favoritePinnedKeys: clampStrList(ws.favoritePinnedKeys, 500),
    favoriteMutedAutoKeys: clampStrList(ws.favoriteMutedAutoKeys, 500),
    sheets,
    slips,
  };
}

/**
 * One-time admin migration from LocalStorage, legacy account cloud, or JSON backup into the shared ledger.
 * - Creates a local backup snapshot first.
 * - Checks immutable migration record `/ledgers/dain_yongin_shared/migrations/{migrationId}` to prevent duplicates.
 * - Skips creating items/sheets whose IDs already exist in shared cloud so existing shared edits are preserved.
 * - Never deletes source LocalStorage or legacy data before verified completion.
 */
export async function migrateToSharedLedger(params: {
  migrationId: string;
  sourceType: 'local_storage' | 'legacy_uid' | 'json_backup' | 'fresh_seed';
  sourceLabel: string;
  sourceData: {
    siteName: string;
    favoritePinnedKeys: string[];
    favoriteMutedAutoKeys: string[];
    sheets: MaterialSheet[];
    slips: StoredReceiptSlip[];
  };
  currentShared: SharedLedgerData | null;
  onProgress?: (stepMessage: string) => void;
}): Promise<{
  backupKey: string;
  migrationId: string;
  migratedSheetsCount: number;
  migratedItemsCount: number;
  migratedSlipsCount: number;
  skippedExistingItemsCount: number;
  storageWarnings: string[];
}> {
  const { sourceType, sourceLabel, sourceData, currentShared, onProgress } = params;
  const safeMigrationId = sanitizeFirestoreId(params.migrationId, 'mig');
  const backupTimestamp = new Date().toISOString();

  // 1. Check duplicate migration lock in Firestore
  const migRef = doc(db, 'ledgers', SHARED_LEDGER_ID, 'migrations', safeMigrationId);
  const existingMig = await getDoc(migRef);
  if (existingMig.exists()) {
    throw new Error(
      `중복 이전 차단: 이 자료(${sourceLabel})는 이미 공용 대장으로 이전되었습니다.`
    );
  }

  // 2. Always back up source data into LocalStorage before any cloud write
  onProgress?.('1/3 · 원본 데이터를 안전하게 백업 중...');
  const backupKey = createLocalBackupSnapshot(safeMigrationId, sourceData);

  const wsRef = doc(db, 'ledgers', SHARED_LEDGER_ID);
  const existingWsSnap = await getDoc(wsRef);
  const knownSheets = new Set(currentShared?.knownSheetIds || []);
  const knownItems = new Set(currentShared?.knownItemIds || []);
  const knownSlips = new Set(currentShared?.knownSlipIds || []);

  const ops: QueuedOp[] = [];

  const mergedPinned = Array.from(
    new Set([
      ...(currentShared?.favoritePinnedKeys || []),
      ...sourceData.favoritePinnedKeys,
    ])
  ).slice(0, 500);
  const mergedMuted = Array.from(
    new Set([
      ...(currentShared?.favoriteMutedAutoKeys || []),
      ...sourceData.favoriteMutedAutoKeys,
    ])
  ).slice(0, 500);

  const existingOrder = (currentShared?.sheets || []).map((s) =>
    sanitizeFirestoreId(s.id, 'sheet')
  );
  const sourceOrder = sourceData.sheets.map((s) => sanitizeFirestoreId(s.id, 'sheet'));
  const mergedSheetOrder = Array.from(new Set([...existingOrder, ...sourceOrder])).slice(0, 100);

  if (!existingWsSnap.exists()) {
    ops.push((batch) =>
      batch.set(wsRef, {
        id: SHARED_LEDGER_ID,
        siteName: clampStr(sourceData.siteName.trim() || '신규 발주 자재 반입 관리', 200),
        favoritePinnedKeys: mergedPinned,
        favoriteMutedAutoKeys: mergedMuted,
        sheetOrder: mergedSheetOrder,
        migratedFromLegacy: true,
        lastMigrationId: safeMigrationId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  } else {
    ops.push((batch) =>
      batch.update(wsRef, {
        siteName: clampStr(
          currentShared?.siteName || sourceData.siteName || '신규 발주 자재 반입 관리',
          200
        ),
        favoritePinnedKeys: mergedPinned,
        favoriteMutedAutoKeys: mergedMuted,
        sheetOrder: mergedSheetOrder,
        migratedFromLegacy: true,
        lastMigrationId: safeMigrationId,
        updatedAt: serverTimestamp(),
      })
    );
  }

  let createdSheetsCount = 0;
  let createdItemsCount = 0;
  let skippedExistingItemsCount = 0;

  // 3. Create non-duplicate sheets & items
  onProgress?.('2/3 · 시트·자재 내역·즐겨찾기를 공용 Cloud Firestore로 이전 중...');
  sourceData.sheets.forEach((sh, sIdx) => {
    const shId = sanitizeFirestoreId(sh.id, 'sheet');
    if (!knownSheets.has(shId)) {
      const shRef = doc(db, 'ledgers', SHARED_LEDGER_ID, 'sheets', shId);
      ops.push((batch) =>
        batch.set(shRef, {
          id: shId,
          ledgerId: SHARED_LEDGER_ID,
          name: clampStr(sh.name.trim() || '시트', 120, '시트'),
          subtitle: clampStr(sh.subtitle || '', 300),
          orderIndex: clampNum(sIdx, 0, 10000, 0),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
      knownSheets.add(shId);
      createdSheetsCount += 1;
    }

    sh.items.forEach((it, iIdx) => {
      const itId = sanitizeFirestoreId(it.id, 'mat');
      if (knownItems.has(itId)) {
        skippedExistingItemsCount += 1;
        return;
      }
      const itRef = doc(db, 'ledgers', SHARED_LEDGER_ID, 'items', itId);
      ops.push((batch) =>
        batch.set(itRef, buildSharedItemPayload(shId, it, iIdx, true, 1))
      );
      knownItems.add(itId);
      createdItemsCount += 1;
    });
  });

  if (ops.length > 0) {
    await commitBatchedOps(ops, `ledgers/${SHARED_LEDGER_ID}`);
  }

  // 4. Upload receipt slips to shared Storage path
  const storageWarnings: string[] = [];
  let uploadedSlipCount = 0;

  for (let i = 0; i < sourceData.slips.length; i++) {
    const slip = sourceData.slips[i];
    const safeSlipId = sanitizeFirestoreId(slip.id, 'slip');
    if (knownSlips.has(safeSlipId)) {
      continue;
    }
    onProgress?.(
      `3/3 · 전표 이미지 공용 Storage 업로드 중 (${i + 1}/${sourceData.slips.length})...`
    );
    try {
      await saveSharedSlipToCloud(
        { ...slip, id: safeSlipId },
        { isExisting: false, hasWorkspaceDoc: true }
      );
      knownSlips.add(safeSlipId);
      uploadedSlipCount += 1;
    } catch (err: any) {
      console.error(`Shared slip migration error (${slip.id}):`, err);
      storageWarnings.push(
        `'${slip.title}' 업로드 실패: ${err?.message || 'Storage 오류'}`
      );
    }
  }

  // 5. Record immutable migration lock ONLY if zero storage errors occurred
  if (storageWarnings.length === 0) {
    await commitBatchedOps(
      [
        (batch) =>
          batch.set(migRef, {
            id: safeMigrationId,
            ledgerId: SHARED_LEDGER_ID,
            sourceType,
            sourceLabel: clampStr(sourceLabel, 200, sourceType),
            backupTimestamp,
            sheetsCount: createdSheetsCount,
            itemsCount: createdItemsCount,
            slipsCount: uploadedSlipCount,
            createdAt: serverTimestamp(),
          }),
      ],
      `ledgers/${SHARED_LEDGER_ID}/migrations/${safeMigrationId}`
    );

    try {
      localStorage.setItem(
        `field_material_shared_migrated_${safeMigrationId}`,
        JSON.stringify({
          migratedAt: backupTimestamp,
          backupKey,
          sheetsCount: createdSheetsCount,
          itemsCount: createdItemsCount,
          slipsCount: uploadedSlipCount,
        })
      );
    } catch {
      // ignore
    }
  }

  return {
    backupKey,
    migrationId: safeMigrationId,
    migratedSheetsCount: createdSheetsCount,
    migratedItemsCount: createdItemsCount,
    migratedSlipsCount: uploadedSlipCount,
    skippedExistingItemsCount,
    storageWarnings,
  };
}
