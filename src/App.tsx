import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, X } from 'lucide-react';
import type { ActiveTab, ErpAppState, InventoryItem, ItemKind, ProductCategory } from './types/erp.ts';
import {
  getOrCreateClientId,
  getStoredTheme,
  loadLocalCachedErpState,
  markLegacyMigrated,
  needsLegacyMigration,
  readHtmlBootstrap,
  saveErpState,
  setStoredSyncRevision,
  setStoredTheme,
} from './utils/erpStorage.ts';
import type { BatchReceiptInputRow } from './utils/erpActions.ts';
import {
  applyErpMutation,
  hasCustomErpData,
  type ErpMutationAction,
  type ErpMutationResult,
} from './utils/erpMutations.ts';
import {
  fetchServerState,
  getWebSocketUrl,
  postMigrateLegacyToServer,
  postMutationToServer,
  type ServerStateEnvelope,
} from './utils/erpSyncClient.ts';
import { calculateDashboardSummary } from './utils/erpCalculator.ts';
import { exportErpExcel } from './utils/erpExport.ts';

import { Sidebar } from './components/layout/Sidebar.tsx';
import { TopHeader } from './components/layout/TopHeader.tsx';
import { DashboardView } from './components/views/DashboardView.tsx';
import { ProductionHubView } from './components/views/ProductionHubView.tsx';
import { InventoryHubView } from './components/views/InventoryHubView.tsx';
import { ReceiptView } from './components/views/ReceiptView.tsx';
import { ManageHubView } from './components/views/ManageHubView.tsx';

interface PendingOp {
  opId: string;
  action: ErpMutationAction;
}

function resolveInitialSnapshot(): {
  state: ErpAppState;
  revision: number;
  shouldMigrateLegacy: boolean;
  legacyCandidate: ErpAppState | null;
} {
  const bootstrap = readHtmlBootstrap();
  const local = loadLocalCachedErpState();
  const legacyFlagged = needsLegacyMigration();
  const localHasCustom = local.fromStorage && hasCustomErpData(local.state);

  // 1) 서버가 이미 살아있는 데이터를 갖고 있으면 HTML 부트스트랩으로 즉시 표시
  if (bootstrap && bootstrap.revision > 0) {
    return {
      state: bootstrap.state,
      revision: bootstrap.revision,
      shouldMigrateLegacy: legacyFlagged,
      legacyCandidate: legacyFlagged ? local.state : null,
    };
  }

  // 2) 서버가 초기 시드(rev=0)이고 기존 브라우저 자료가 있으면 기존 자료를 즉시 표시 후 서버로 이관
  if (localHasCustom) {
    return {
      state: local.state,
      revision: 0,
      shouldMigrateLegacy: true,
      legacyCandidate: local.state,
    };
  }

  // 3) 신규 방문자: 서버 부트스트랩(또는 초기 데이터) 즉시 표시
  return {
    state: bootstrap?.state || local.state,
    revision: bootstrap?.revision || 0,
    shouldMigrateLegacy: false,
    legacyCandidate: null,
  };
}

export default function App() {
  const initialSnapshotRef = useRef<ReturnType<typeof resolveInitialSnapshot> | null>(null);
  if (!initialSnapshotRef.current) {
    initialSnapshotRef.current = resolveInitialSnapshot();
  }

  const [state, setState] = useState<ErpAppState>(initialSnapshotRef.current.state);
  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [inventorySubTab, setInventorySubTab] = useState<'stock' | 'purchase'>('stock');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [lastSelectedProductId, setLastSelectedProductId] = useState<string>('prod_post_520');
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => getStoredTheme() === 'dark');
  const [syncAlert, setSyncAlert] = useState<string | null>(null);

  const clientIdRef = useRef<string>(getOrCreateClientId());
  const serverStateRef = useRef<ErpAppState>(initialSnapshotRef.current.state);
  const serverRevRef = useRef<number>(initialSnapshotRef.current.revision);
  const displayStateRef = useRef<ErpAppState>(initialSnapshotRef.current.state);
  const pendingOpsRef = useRef<PendingOp[]>([]);
  const sendChainRef = useRef<Promise<void>>(Promise.resolve());
  const migratingRef = useRef<boolean>(initialSnapshotRef.current.shouldMigrateLegacy);

  // 다크/라이트 테마 동기화
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
      setStoredTheme('dark');
    } else {
      document.documentElement.classList.remove('dark');
      setStoredTheme('light');
    }
  }, [isDarkMode]);

  // 표시 상태 동기화 + 로컬 백업 저장
  const commitDisplayState = useCallback((next: ErpAppState) => {
    displayStateRef.current = next;
    setState(next);
    saveErpState(next);
  }, []);

  const recomputeFromServer = useCallback(
    (baseState: ErpAppState, pending: PendingOp[]) => {
      let acc = baseState;
      for (const op of pending) {
        const res = applyErpMutation(acc, op.action);
        if (res.ok) {
          acc = res.nextState;
        }
      }
      commitDisplayState(acc);
    },
    [commitDisplayState]
  );

  const applyServerEnvelope = useCallback(
    (envelope: ServerStateEnvelope) => {
      if (envelope.revision < serverRevRef.current) return;
      if (migratingRef.current && envelope.revision === 0) return;

      serverRevRef.current = envelope.revision;
      serverStateRef.current = envelope.state;
      setStoredSyncRevision(envelope.revision);

      const acked = new Set(envelope.appliedOpIds || []);
      if (pendingOpsRef.current.length > 0 && acked.size > 0) {
        pendingOpsRef.current = pendingOpsRef.current.filter((op) => !acked.has(op.opId));
      }

      recomputeFromServer(envelope.state, pendingOpsRef.current);
    },
    [recomputeFromServer]
  );

  // 미전송 큐 재전송 (재연결 시 동시 입력 보존)
  const flushPendingOps = useCallback(() => {
    const ops = [...pendingOpsRef.current];
    if (ops.length === 0) return;

    sendChainRef.current = sendChainRef.current.then(async () => {
      for (const op of ops) {
        if (!pendingOpsRef.current.some((p) => p.opId === op.opId)) continue;
        try {
          const res = await postMutationToServer({
            opId: op.opId,
            clientId: clientIdRef.current,
            action: op.action,
          });
          pendingOpsRef.current = pendingOpsRef.current.filter((p) => p.opId !== op.opId);
          if (res.revision >= serverRevRef.current) {
            serverRevRef.current = res.revision;
            serverStateRef.current = res.state;
            setStoredSyncRevision(res.revision);
          }
          if (!res.ok && res.error) {
            setSyncAlert(`동시 입력 반영 중 확인 필요: ${res.error}`);
          }
          recomputeFromServer(serverStateRef.current, pendingOpsRef.current);
        } catch {
          break;
        }
      }
    });
  }, [recomputeFromServer]);

  // 초기 서버 동기화, 기존 로컬 자료 이관 및 실시간 WebSocket 연결
  useEffect(() => {
    let closed = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let backoffMs = 1000;

    const runInitialSyncAndMigrate = async () => {
      try {
        const snapshot = initialSnapshotRef.current;
        if (snapshot?.shouldMigrateLegacy && snapshot.legacyCandidate) {
          const migrated = await postMigrateLegacyToServer({
            clientId: clientIdRef.current,
            state: snapshot.legacyCandidate,
          });
          migratingRef.current = false;
          markLegacyMigrated();
          if (!closed) {
            applyServerEnvelope({
              revision: migrated.revision,
              state: migrated.state,
              appliedOpIds: migrated.appliedOpIds,
            });
          }
          return;
        }
        migratingRef.current = false;
        const latest = await fetchServerState();
        if (!closed) {
          applyServerEnvelope(latest);
        }
      } catch {
        migratingRef.current = false;
      }
    };

    const connectWebSocket = () => {
      if (closed) return;
      try {
        ws = new WebSocket(getWebSocketUrl());
        ws.onopen = () => {
          backoffMs = 1000;
          flushPendingOps();
        };
        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data as string);
            if (msg?.type === 'STATE_SYNC' && msg.state) {
              applyServerEnvelope(msg as ServerStateEnvelope);
            }
          } catch {}
        };
        ws.onclose = () => {
          if (closed) return;
          reconnectTimer = setTimeout(() => {
            backoffMs = Math.min(8000, backoffMs * 2);
            fetchServerState()
              .then((latest) => {
                if (!closed) applyServerEnvelope(latest);
              })
              .catch(() => {});
            connectWebSocket();
          }, backoffMs);
        };
        ws.onerror = () => {
          ws?.close();
        };
      } catch {}
    };

    runInitialSyncAndMigrate();
    connectWebSocket();

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        fetchServerState()
          .then((latest) => {
            if (!closed) applyServerEnvelope(latest);
          })
          .catch(() => {});
        flushPendingOps();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      closed = true;
      document.removeEventListener('visibilitychange', handleVisibility);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) ws.close();
    };
  }, [applyServerEnvelope, flushPendingOps]);

  // 공통 액션 디스패치 (즉시 낙관적 반영 + 서버 순차 직렬 실행)
  const dispatchMutation = useCallback(
    (action: ErpMutationAction): ErpMutationResult => {
      const optimistic = applyErpMutation(displayStateRef.current, action);
      if (!optimistic.ok) {
        return optimistic;
      }

      const opId = `op_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      pendingOpsRef.current.push({ opId, action });
      commitDisplayState(optimistic.nextState);

      sendChainRef.current = sendChainRef.current.then(async () => {
        if (!pendingOpsRef.current.some((p) => p.opId === opId)) return;
        try {
          const res = await postMutationToServer({
            opId,
            clientId: clientIdRef.current,
            action,
          });
          pendingOpsRef.current = pendingOpsRef.current.filter((p) => p.opId !== opId);

          if (res.revision >= serverRevRef.current) {
            serverRevRef.current = res.revision;
            serverStateRef.current = res.state;
            setStoredSyncRevision(res.revision);
          }

          if (!res.ok) {
            setSyncAlert(
              res.error
                ? `동시 작업으로 최신 재고와 충돌하여 반영이 취소되었습니다: ${res.error}`
                : '동시 작업 충돌로 인해 최신 데이터 기준으로 복원되었습니다.'
            );
          } else {
            setSyncAlert((prev) =>
              prev && prev.includes('오프라인') ? null : prev
            );
          }

          recomputeFromServer(serverStateRef.current, pendingOpsRef.current);
        } catch {
          setSyncAlert(
            '서버 연결이 잠시 불안정합니다. 입력한 내용은 임시 보관되며 연결 복구 시 자동 동기화됩니다.'
          );
        }
      });

      return optimistic;
    },
    [commitDisplayState, recomputeFromServer]
  );

  const summary = useMemo(() => calculateDashboardSummary(state), [state]);

  // 생산 등록
  const handleRegisterProduction = (params: {
    productionDate: string;
    productId: string;
    quantity: number;
    worker: string;
    manager: string;
    note: string;
  }) => {
    setLastSelectedProductId(params.productId);
    const recordId = `prod_rec_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const res = dispatchMutation({
      type: 'REGISTER_PRODUCTION',
      payload: { ...params, recordId },
    });
    if (!res.ok || !res.data?.record) {
      return {
        ok: false as const,
        error: res.error || '재고가 부족합니다.',
      };
    }
    return { ok: true as const, record: res.data.record };
  };

  // 생산 취소
  const handleCancelProduction = (recordId: string) => {
    dispatchMutation({ type: 'CANCEL_PRODUCTION', payload: { recordId } });
  };

  // 생산 수정
  const handleUpdateProduction = (
    recordId: string,
    updates: {
      productionDate: string;
      quantity: number;
      worker: string;
      manager: string;
      note: string;
    }
  ) => {
    const res = dispatchMutation({
      type: 'UPDATE_PRODUCTION',
      payload: { recordId, updates },
    });
    if (!res.ok) {
      return {
        ok: false as const,
        error: res.error || '수정할 수 없습니다.',
      };
    }
    return { ok: true as const };
  };

  // 생산 목표 수정
  const handleUpdateTarget = (productId: string, newTarget: number) => {
    dispatchMutation({ type: 'UPDATE_TARGET', payload: { productId, newTarget } });
  };

  // 자재 입고 등록 / 취소 / 수정 / 일괄 등록
  const handleRegisterReceipt = (params: {
    receiptDate: string;
    itemId: string;
    quantity: number;
    supplier: string;
    worker: string;
    note: string;
  }) => {
    dispatchMutation({ type: 'REGISTER_RECEIPT', payload: params });
  };

  const handleCancelReceipt = (receiptId: string) => {
    dispatchMutation({ type: 'CANCEL_RECEIPT', payload: { receiptId } });
  };

  const handleUpdateReceipt = (
    receiptId: string,
    updates: {
      receiptDate: string;
      itemId: string;
      quantity: number;
      supplier: string;
      worker: string;
      note: string;
    }
  ) => {
    dispatchMutation({ type: 'UPDATE_RECEIPT', payload: { receiptId, updates } });
  };

  const handleBatchImportReceipts = (rows: BatchReceiptInputRow[]) => {
    const res = dispatchMutation({
      type: 'BATCH_REGISTER_RECEIPTS',
      payload: { rows },
    });
    return {
      addedCount: res.data?.addedCount || 0,
      createdItemsCount: res.data?.createdItemsCount || 0,
    };
  };

  // 재고 실사 조정
  const handleRegisterAdjustment = (params: {
    adjustmentDate: string;
    itemId: string;
    afterQuantity: number;
    reason: string;
    worker: string;
  }) => {
    dispatchMutation({ type: 'REGISTER_ADJUSTMENT', payload: params });
  };

  // 사용누계 수정
  const handleUpdateTotalUsed = (params: {
    date: string;
    itemId: string;
    newTotalUsed: number;
    syncCurrentStock: boolean;
    reason: string;
    worker: string;
  }) => {
    dispatchMutation({ type: 'UPDATE_TOTAL_USED', payload: params });
  };

  // 신규 자재 추가 / 수정 / 삭제
  const handleAddMaterial = (params: {
    name: string;
    specification: string;
    unit: string;
    kind: ItemKind;
    initialStock: number;
    minimumStock: number;
    notes: string;
  }): string => {
    const suffix = `${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const id = `item_${suffix}`;
    const prodId = `prod_${suffix}`;
    const txId = `tx_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`;

    dispatchMutation({
      type: 'ADD_MATERIAL',
      payload: { ...params, id, prodId, txId },
    });

    return id;
  };

  const handleUpdateMaterial = (itemId: string, updates: Partial<InventoryItem>) => {
    dispatchMutation({ type: 'UPDATE_MATERIAL', payload: { itemId, updates } });
  };

  const handleDeleteMaterial = (itemId: string) => {
    dispatchMutation({ type: 'DELETE_MATERIAL', payload: { itemId } });
  };

  // BOM 추가 / 수정 / 삭제
  const handleAddBomLine = (
    productId: string,
    materialItemId: string,
    quantity: number
  ) => {
    const bomId = `bom_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    dispatchMutation({
      type: 'ADD_BOM_LINE',
      payload: { bomId, productId, materialItemId, quantity },
    });
  };

  const handleUpdateBomQty = (bomId: string, quantity: number) => {
    dispatchMutation({ type: 'UPDATE_BOM_QTY', payload: { bomId, quantity } });
  };

  const handleDeleteBomLine = (bomId: string) => {
    dispatchMutation({ type: 'DELETE_BOM_LINE', payload: { bomId } });
  };

  // 제품명 수정 / 삭제 / 추가
  const handleUpdateProductName = (productId: string, newName: string) => {
    dispatchMutation({
      type: 'UPDATE_PRODUCT_NAME',
      payload: { productId, newName },
    });
  };

  const handleDeleteProduct = (productId: string) => {
    dispatchMutation({ type: 'DELETE_PRODUCT', payload: { productId } });
  };

  const handleAddProduct = (params: {
    productName: string;
    category: ProductCategory;
    unit: string;
    targetQuantity: number;
  }) => {
    const suffix = `${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    dispatchMutation({
      type: 'ADD_PRODUCT',
      payload: {
        ...params,
        prodId: `prod_${suffix}`,
        itemId: `item_${suffix}`,
      },
    });
  };

  const handleSelectTab = (tab: ActiveTab) => {
    if (tab === 'inventory') {
      setInventorySubTab('stock');
    }
    setActiveTab(tab);
  };

  const handleOpenPurchase = () => {
    setInventorySubTab('purchase');
    setActiveTab('inventory');
  };

  const handleResetToInitial = () => {
    markLegacyMigrated();
    dispatchMutation({ type: 'RESET_TO_INITIAL', payload: {} });
  };

  return (
    <div className="min-h-screen flex bg-[#F1F4F8] text-slate-800 dark:bg-[#1C2028] dark:text-slate-100 transition-colors">
      <Sidebar
        activeTab={activeTab}
        onSelectTab={handleSelectTab}
        shortageCount={summary.shortageItemsCount}
        isOpenMobile={isMobileMenuOpen}
        onCloseMobile={() => setIsMobileMenuOpen(false)}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <TopHeader
          activeTab={activeTab}
          isDarkMode={isDarkMode}
          onToggleDarkMode={() => setIsDarkMode((prev) => !prev)}
          onOpenMobileMenu={() => setIsMobileMenuOpen(true)}
          onQuickNavigate={handleSelectTab}
          onQuickExportAll={() => exportErpExcel(state, 'ALL')}
        />

        <main className="flex-1 p-4 sm:p-6 max-w-[1440px] w-full mx-auto">
          {syncAlert && (
            <div className="mb-4 bg-white dark:bg-[#1E232D] border border-rose-200 dark:border-rose-900 rounded-xl p-3.5 flex items-center justify-between gap-3 shadow-2xs">
              <div className="flex items-center space-x-2.5">
                <AlertCircle size={18} className="text-rose-600 dark:text-rose-400 shrink-0" />
                <span className="text-xs sm:text-sm font-bold text-rose-700 dark:text-rose-300">
                  {syncAlert}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSyncAlert(null)}
                className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>
          )}

          {activeTab === 'dashboard' && (
            <DashboardView
              state={state}
              onNavigate={handleSelectTab}
              onOpenPurchase={handleOpenPurchase}
              onAddMaterial={handleAddMaterial}
              onUpdateMaterial={handleUpdateMaterial}
              onDeleteMaterial={handleDeleteMaterial}
              onRegisterAdjustment={handleRegisterAdjustment}
              onAddProduct={handleAddProduct}
              onUpdateProductName={handleUpdateProductName}
              onUpdateTarget={handleUpdateTarget}
              onDeleteProduct={handleDeleteProduct}
            />
          )}

          {activeTab === 'production' && (
            <ProductionHubView
              state={state}
              lastSelectedProductId={lastSelectedProductId}
              onRegisterProduction={handleRegisterProduction}
              onCancelProduction={handleCancelProduction}
              onUpdateProduction={handleUpdateProduction}
              onUpdateTarget={handleUpdateTarget}
              onUpdateProductName={handleUpdateProductName}
              onNavigate={handleSelectTab}
              onExportProduction={() => exportErpExcel(state, 'PRODUCTION')}
              onExportPlan={() => exportErpExcel(state, 'PLAN')}
            />
          )}

          {activeTab === 'inventory' && (
            <InventoryHubView
              key={inventorySubTab}
              state={state}
              initialSubTab={inventorySubTab}
              onNavigate={handleSelectTab}
              onAddMaterial={handleAddMaterial}
              onUpdateMaterial={handleUpdateMaterial}
              onDeleteMaterial={handleDeleteMaterial}
              onRegisterAdjustment={handleRegisterAdjustment}
              onExportInventory={() => exportErpExcel(state, 'INVENTORY')}
              onExportPurchase={() => exportErpExcel(state, 'PURCHASE')}
            />
          )}

          {activeTab === 'receipts' && (
            <ReceiptView
              state={state}
              onRegisterReceipt={handleRegisterReceipt}
              onUpdateReceipt={handleUpdateReceipt}
              onBatchImportReceipts={handleBatchImportReceipts}
              onCancelReceipt={handleCancelReceipt}
              onAddMaterial={handleAddMaterial}
              onUpdateMaterial={handleUpdateMaterial}
              onUpdateTotalUsed={handleUpdateTotalUsed}
              onExportReceipts={() => exportErpExcel(state, 'RECEIPTS')}
            />
          )}

          {activeTab === 'manage' && (
            <ManageHubView
              state={state}
              onAddBomLine={handleAddBomLine}
              onUpdateBomQty={handleUpdateBomQty}
              onDeleteBomLine={handleDeleteBomLine}
              onAddMaterial={handleAddMaterial}
              onAddProduct={handleAddProduct}
              onUpdateProductName={handleUpdateProductName}
              onDeleteProduct={handleDeleteProduct}
              onResetToInitial={handleResetToInitial}
              onExportBom={() => exportErpExcel(state, 'BOM')}
              onExportLedger={() => exportErpExcel(state, 'LEDGER')}
            />
          )}
        </main>
      </div>
    </div>
  );
}
