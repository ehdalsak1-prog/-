import React, { useRef, useState } from 'react';
import {
  X,
  Cloud,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Download,
  UploadCloud,
  RefreshCw,
  HardDrive,
  Trash2,
  Users,
  FileJson,
  Lock,
  Sparkles,
} from 'lucide-react';
import type {
  SharedSyncStatus,
  SharedLedgerData,
  SyncConflictInfo,
} from '../utils/cloudSync';
import type { MaterialSheet } from '../App';
import type { StoredReceiptSlip } from '../utils/slipStorage';

interface LegacyAccountSummary {
  uid: string;
  email: string;
  siteName: string;
  sheets: MaterialSheet[];
  slips: StoredReceiptSlip[];
  favoritePinnedKeys: string[];
  favoriteMutedAutoKeys: string[];
}

interface CloudSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  syncStatus: SharedSyncStatus;
  syncError: string | null;
  syncConflicts: SyncConflictInfo[];
  lastSyncedAt: Date | null;
  onRetrySync: () => void;
  onDismissConflicts: () => void;
  sharedData: SharedLedgerData | null;
  slipsCountOverride?: number;
  migrationsOverride?: Array<{
    id: string;
    sourceType: string;
    sourceLabel: string;
    backupTimestamp: string;
    sheetsCount: number;
    itemsCount: number;
    slipsCount: number;
    createdAtMillis: number;
  }>;
  // Existing unmigrated local & optional silent legacy account summaries
  localData: {
    siteName: string;
    sheets: MaterialSheet[];
    slips: StoredReceiptSlip[];
    favoritePinnedKeys: string[];
    favoriteMutedAutoKeys: string[];
    hasLegacyLocalKeys: boolean;
  };
  legacyAccountData: LegacyAccountSummary | null;
  // Actions
  onDownloadCurrentBackup: () => void;
  onMigrateLocalStorage: (downloadBackupFirst: boolean) => Promise<{
    migratedSheetsCount: number;
    migratedItemsCount: number;
    migratedSlipsCount: number;
    skippedExistingItemsCount: number;
    storageWarnings: string[];
  }>;
  onMigrateLegacyAccount: (downloadBackupFirst: boolean) => Promise<{
    migratedSheetsCount: number;
    migratedItemsCount: number;
    migratedSlipsCount: number;
    skippedExistingItemsCount: number;
    storageWarnings: string[];
  }>;
  onMigrateJsonBackupFile: (file: File) => Promise<{
    migratedSheetsCount: number;
    migratedItemsCount: number;
    migratedSlipsCount: number;
    skippedExistingItemsCount: number;
    storageWarnings: string[];
  }>;
  onInitializeFreshSharedLedger: () => Promise<void>;
  onClearLegacyLocalAfterMigration: () => void;
}

export default function CloudSyncModal({
  isOpen,
  onClose,
  syncStatus,
  syncError,
  syncConflicts,
  lastSyncedAt,
  onRetrySync,
  onDismissConflicts,
  sharedData,
  slipsCountOverride,
  migrationsOverride,
  localData,
  legacyAccountData,
  onDownloadCurrentBackup,
  onMigrateLocalStorage,
  onMigrateLegacyAccount,
  onMigrateJsonBackupFile,
  onInitializeFreshSharedLedger,
  onClearLegacyLocalAfterMigration,
}: CloudSyncModalProps) {
  const jsonInputRef = useRef<HTMLInputElement | null>(null);
  const [downloadJsonBeforeMigrate, setDownloadJsonBeforeMigrate] = useState(true);
  const [isMigrating, setIsMigrating] = useState(false);
  const [migrationStepMsg, setMigrationStepMsg] = useState<string | null>(null);
  const [migrationResult, setMigrationResult] = useState<{
    migratedSheetsCount: number;
    migratedItemsCount: number;
    migratedSlipsCount: number;
    skippedExistingItemsCount: number;
    storageWarnings: string[];
  } | null>(null);
  const [migrationError, setMigrationError] = useState<string | null>(null);
  const [confirmClearLocal, setConfirmClearLocal] = useState(false);

  if (!isOpen) return null;

  const sharedSheetCount = sharedData?.sheets.length || 0;
  const sharedItemCount =
    sharedData?.sheets.reduce((sum, s) => sum + s.items.length, 0) || 0;
  const sharedSlipCount =
    typeof slipsCountOverride === 'number' ? slipsCountOverride : sharedData?.slips.length || 0;
  const sharedFavCount = sharedData?.favoritePinnedKeys.length || 0;

  const localItemCount = localData.sheets.reduce((sum, s) => sum + s.items.length, 0);
  const legacyAccountItemCount =
    legacyAccountData?.sheets.reduce((sum, s) => sum + s.items.length, 0) || 0;

  const existingMigrations = migrationsOverride ?? sharedData?.migrations ?? [];
  const isLocalAlreadyMigrated = existingMigrations.some(
    (m) => m.id === 'mig_local_primary_v1' || m.sourceType === 'local_storage'
  );
  const isLegacyUidAlreadyMigrated = legacyAccountData
    ? existingMigrations.some((m) => m.id.startsWith(`mig_legacy_uid_${legacyAccountData.uid.slice(0, 40)}`))
    : false;

  const runAction = async (
    label: string,
    fn: () => Promise<{
      migratedSheetsCount: number;
      migratedItemsCount: number;
      migratedSlipsCount: number;
      skippedExistingItemsCount: number;
      storageWarnings: string[];
    }>
  ) => {
    try {
      setIsMigrating(true);
      setMigrationError(null);
      setMigrationResult(null);
      setMigrationStepMsg(label);
      const res = await fn();
      setMigrationResult(res);
    } catch (err: any) {
      setMigrationError(err?.message || '공용 대장 이전 중 오류가 발생했습니다.');
    } finally {
      setIsMigrating(false);
      setMigrationStepMsg(null);
    }
  };

  const handleInitializeFresh = async () => {
    try {
      setIsMigrating(true);
      setMigrationError(null);
      setMigrationStepMsg('기본 양식으로 공용 대장 생성 중...');
      await onInitializeFreshSharedLedger();
    } catch (err: any) {
      setMigrationError(err?.message || '공용 대장 초기화 중 오류가 발생했습니다.');
    } finally {
      setIsMigrating(false);
      setMigrationStepMsg(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 no-print animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 bg-slate-900 text-white flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-blue-600/90 flex items-center justify-center shrink-0">
              <Users className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-bold text-white truncate">
                공용 대장 실시간 동기화 · 백업 및 이전 관리
              </h3>
              <p className="text-xs text-slate-300 truncate">
                로그인 없이 같은 주소에서 모든 PC·모바일이 동일한 공용 대장을 실시간 공유합니다
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
            title="닫기"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5 bg-slate-50">
          {/* Section 1: Shared Ledger Live Connection & Sync Status */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-2xs space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {syncStatus === 'cached_checking' ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-50 text-amber-800 border border-amber-200 text-xs font-semibold">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>저장된 자료 표시 중·최신 데이터 확인 중</span>
                  </span>
                ) : syncStatus === 'connecting' || syncStatus === 'saving' ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-blue-50 text-blue-700 border border-blue-200 text-xs font-semibold">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>
                      {syncStatus === 'connecting' ? '공용 대장 연결 중...' : '항목별 저장 중...'}
                    </span>
                  </span>
                ) : syncStatus === 'saved' ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-semibold">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>
                      저장 완료
                      {lastSyncedAt
                        ? ` (${lastSyncedAt.toLocaleTimeString('ko-KR', {
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                          })})`
                        : ''}
                    </span>
                  </span>
                ) : syncStatus === 'conflict' ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-50 text-amber-800 border border-amber-300 text-xs font-semibold">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>동시 수정 충돌 감지</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-rose-50 text-rose-700 border border-rose-200 text-xs font-semibold">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>연결 / 저장 실패</span>
                  </span>
                )}

                <span className="text-xs text-slate-500">
                  공용 경로: <code className="font-mono text-[11px]">dain_yongin_shared</code>
                </span>
              </div>

              {(syncStatus === 'error' || syncStatus === 'conflict') && (
                <button
                  type="button"
                  onClick={onRetrySync}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition-colors"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>다시 저장</span>
                </button>
              )}
            </div>

            {syncError && (
              <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-[11px] text-rose-800 break-words">
                <strong>오류 상세:</strong> {syncError}
              </div>
            )}

            {syncConflicts.length > 0 && (
              <div className="p-3 rounded-lg bg-amber-50 border border-amber-300 text-xs text-amber-950 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <strong className="flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-amber-600" />
                    <span>동시 작업 충돌이 감지되어 먼저 저장된 최신 내용으로 보존했습니다</span>
                  </strong>
                  <button
                    type="button"
                    onClick={onDismissConflicts}
                    className="text-[11px] font-bold text-amber-800 hover:underline"
                  >
                    확인
                  </button>
                </div>
                <ul className="list-disc pl-5 text-[11px] space-y-0.5">
                  {syncConflicts.map((c, idx) => (
                    <li key={`${c.itemId}-${idx}`}>
                      <strong>{c.itemName}</strong> — {c.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Shared Cloud Summary Box */}
            <div className="p-3.5 rounded-xl bg-blue-50/70 border border-blue-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="text-xs font-bold text-blue-950 flex items-center gap-1.5">
                  <Cloud className="w-4 h-4 text-blue-600" />
                  <span>현재 공용 클라우드 대장 현황</span>
                  {sharedData?.cloudExists ? (
                    <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                      활성화됨
                    </span>
                  ) : (
                    <span className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 text-[10px] font-bold">
                      초기화 대기
                    </span>
                  )}
                </div>
                <div className="text-xs text-blue-900/85 mt-1">
                  시트 <strong>{sharedSheetCount}개</strong> · 자재{' '}
                  <strong>{sharedItemCount}건</strong> · 즐겨찾기 고정{' '}
                  <strong>{sharedFavCount}종</strong> · 전표 <strong>{sharedSlipCount}장</strong>
                </div>
              </div>
              <button
                type="button"
                onClick={onDownloadCurrentBackup}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold text-slate-800 bg-white hover:bg-slate-100 border border-slate-300 shrink-0 transition-colors"
                title="현재 데이터를 JSON 백업 파일로 다운로드"
              >
                <Download className="w-3.5 h-3.5 text-blue-600" />
                <span>전체 백업 저장 (.json)</span>
              </button>
            </div>

            <p className="text-[11px] text-slate-500 leading-relaxed">
              ※ 앱 주소를 아는 직원은 별도 로그인 없이 공용 대장을 바로 조회·수정할 수 있으며,
              새로 접속한 직원의 브라우저 로컬 데이터는 공용 대장에 자동으로 합쳐지거나 덮어써지지 않습니다.
            </p>
          </div>

          {/* Section 2: One-time Admin Backup & Migration */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-2xs space-y-4">
            <div>
              <h4 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                <HardDrive className="w-4 h-4 text-blue-600" />
                <span>관리자 공용 대장 이전 (1회 실행 · 중복 방지)</span>
              </h4>
              <p className="text-xs text-slate-500 mt-0.5">
                기존 LocalStorage·계정별 자료·백업 파일을 먼저 백업한 뒤 공용 대장으로 1회 이전합니다.{' '}
                <strong className="text-slate-700">이전 성공이 확인되기 전에는 원본을 삭제하지 않습니다.</strong>
              </p>
            </div>

            <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={downloadJsonBeforeMigrate}
                onChange={(e) => setDownloadJsonBeforeMigrate(e.target.checked)}
                className="w-4 h-4 rounded accent-blue-600"
              />
              <span>이전 시작 전 안전을 위해 백업 파일(.json)을 PC/휴대폰에 함께 자동 다운로드</span>
            </label>

            {/* Migration Source Cards */}
            <div className="space-y-3">
              {/* Source A: Empty Shared Ledger Fresh Start */}
              {!sharedData?.cloudExists && (
                <div className="p-3.5 rounded-xl bg-emerald-50/70 border border-emerald-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                  <div>
                    <div className="font-bold text-emerald-950 flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4 text-emerald-600" />
                      <span>새 공용 대장으로 바로 시작 (기존 데이터 없을 때)</span>
                    </div>
                    <p className="text-emerald-800 mt-0.5">
                      공용 대장이 현재 비어 있습니다. 기본 시트 양식(고안리·청주이전·용인·사무용품)으로 공용 대장을 생성합니다.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={isMigrating}
                    onClick={handleInitializeFresh}
                    className="px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold whitespace-nowrap shrink-0 disabled:opacity-60"
                  >
                    기본 양식으로 시작
                  </button>
                </div>
              )}

              {/* Source B: Current Browser LocalStorage / IndexedDB */}
              {localData.hasLegacyLocalKeys && (
                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                  <div>
                    <div className="font-bold text-slate-900">
                      이 브라우저의 기존 LocalStorage 자료
                    </div>
                    <div className="text-slate-600 mt-0.5">
                      시트 <strong>{localData.sheets.length}개</strong> · 자재{' '}
                      <strong>{localItemCount}건</strong> · 전표{' '}
                      <strong>{localData.slips.length}장</strong>
                    </div>
                  </div>
                  {isLocalAlreadyMigrated ? (
                    <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-200 text-slate-700 font-bold whitespace-nowrap shrink-0">
                      <Lock className="w-3.5 h-3.5" />
                      <span>이미 공용 이전 완료됨</span>
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={isMigrating}
                      onClick={() =>
                        runAction('로컬 자료 백업 및 공용 이전 중...', () =>
                          onMigrateLocalStorage(downloadJsonBeforeMigrate)
                        )
                      }
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold whitespace-nowrap shrink-0 disabled:opacity-60"
                    >
                      {isMigrating ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <UploadCloud className="w-3.5 h-3.5" />
                      )}
                      <span>백업 후 공용 대장으로 1회 이전</span>
                    </button>
                  )}
                </div>
              )}

              {/* Source C: Legacy Account Cloud Data (detected silently if browser still holds legacy session) */}
              {legacyAccountData && (
                <div className="p-3.5 rounded-xl bg-indigo-50/70 border border-indigo-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                  <div>
                    <div className="font-bold text-indigo-950">
                      이전 계정 클라우드 자료 감지됨 ({legacyAccountData.email || legacyAccountData.uid})
                    </div>
                    <div className="text-indigo-800 mt-0.5">
                      시트 <strong>{legacyAccountData.sheets.length}개</strong> · 자재{' '}
                      <strong>{legacyAccountItemCount}건</strong> · 전표{' '}
                      <strong>{legacyAccountData.slips.length}장</strong>
                    </div>
                  </div>
                  {isLegacyUidAlreadyMigrated ? (
                    <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-indigo-100 text-indigo-800 font-bold whitespace-nowrap shrink-0">
                      <Lock className="w-3.5 h-3.5" />
                      <span>이미 공용 이전 완료됨</span>
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={isMigrating}
                      onClick={() =>
                        runAction('이전 계정 자료 백업 및 공용 이전 중...', () =>
                          onMigrateLegacyAccount(downloadJsonBeforeMigrate)
                        )
                      }
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold whitespace-nowrap shrink-0 disabled:opacity-60"
                    >
                      {isMigrating ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <UploadCloud className="w-3.5 h-3.5" />
                      )}
                      <span>계정 자료 백업 후 공용 이전</span>
                    </button>
                  )}
                </div>
              )}

              {/* Source D: Restore / Migrate from JSON backup file */}
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                <div>
                  <div className="font-bold text-slate-900 flex items-center gap-1.5">
                    <FileJson className="w-4 h-4 text-slate-600" />
                    <span>백업 파일(.json)로 공용 대장 이전/복구</span>
                  </div>
                  <p className="text-slate-600 mt-0.5">
                    다른 PC에서 저장한 <code className="font-mono">.json</code> 백업 파일을 업로드하여 중복 없이 공용 대장에 반영합니다.
                  </p>
                </div>
                <input
                  ref={jsonInputRef}
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      void runAction('JSON 백업 파일 검증 및 이전 중...', () =>
                        onMigrateJsonBackupFile(file)
                      );
                    }
                    if (e.target) e.target.value = '';
                  }}
                />
                <button
                  type="button"
                  disabled={isMigrating}
                  onClick={() => jsonInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 font-bold whitespace-nowrap shrink-0 disabled:opacity-60"
                >
                  <FileJson className="w-3.5 h-3.5 text-blue-600" />
                  <span>.json 파일 선택</span>
                </button>
              </div>
            </div>

            {migrationStepMsg && (
              <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-800 flex items-center gap-2 font-semibold">
                <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                <span>{migrationStepMsg}</span>
              </div>
            )}

            {migrationError && (
              <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800">
                <strong>이전 실패:</strong> {migrationError} (원본 LocalStorage 및 기존 자료는 삭제되지 않고 그대로 보존되었습니다.)
              </div>
            )}

            {migrationResult && (
              <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 space-y-1">
                <div className="font-bold flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>
                    공용 대장 이전 완료! (시트 {migrationResult.migratedSheetsCount}개 · 신규 자재{' '}
                    {migrationResult.migratedItemsCount}건 · 전표{' '}
                    {migrationResult.migratedSlipsCount}장
                    {migrationResult.skippedExistingItemsCount > 0
                      ? ` · 중복 건너뜀 ${migrationResult.skippedExistingItemsCount}건`
                      : ''}
                    )
                  </span>
                </div>
                {migrationResult.storageWarnings.length > 0 && (
                  <div className="text-amber-800 bg-amber-50 border border-amber-200 rounded p-2 mt-1">
                    <div className="font-semibold">일부 전표 이미지 Storage 업로드 경고:</div>
                    <ul className="list-disc pl-4 mt-0.5 space-y-0.5">
                      {migrationResult.storageWarnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Migration History Log */}
            {existingMigrations.length > 0 && (
              <div className="pt-2 border-t border-slate-100 space-y-1.5">
                <div className="text-[11px] font-bold text-slate-600">
                  공용 대장 이전 완료 이력 (중복 실행 방지 잠금 적용)
                </div>
                <div className="space-y-1">
                  {existingMigrations.map((m) => (
                    <div
                      key={m.id}
                      className="text-[11px] px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-200 flex flex-wrap items-center justify-between gap-2 text-slate-700"
                    >
                      <span className="font-semibold">{m.sourceLabel}</span>
                      <span className="text-slate-500">
                        시트 {m.sheetsCount} · 자재 {m.itemsCount} · 전표 {m.slipsCount} (
                        {new Date(m.createdAtMillis).toLocaleString('ko-KR')})
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Optional LocalStorage Cleanup ONLY after verified migration */}
            {existingMigrations.length > 0 && localData.hasLegacyLocalKeys && (
              <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="text-slate-600">
                  공용 이전이 확인되었습니다. 원하시면 이 브라우저의 구형 임시저장만 수동 정리할 수 있습니다.
                </span>
                {!confirmClearLocal ? (
                  <button
                    type="button"
                    onClick={() => setConfirmClearLocal(true)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-slate-600 hover:text-rose-700 bg-slate-100 hover:bg-rose-50 border border-slate-200 font-semibold transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>기존 로컬 임시저장 정리</span>
                  </button>
                ) : (
                  <div className="inline-flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        onClearLegacyLocalAfterMigration();
                        setConfirmClearLocal(false);
                      }}
                      className="px-2.5 py-1 rounded-md bg-rose-600 hover:bg-rose-700 text-white font-bold"
                    >
                      정리 확인
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmClearLocal(false)}
                      className="px-2.5 py-1 rounded-md bg-slate-200 text-slate-700 font-semibold"
                    >
                      취소
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-white border-t border-slate-200 flex items-center justify-between gap-2 shrink-0 text-xs text-slate-500">
          <span>
            보안 규칙 적용됨 · 공용 대장 경로 및 검증된 데이터·파일 형식만 허용됩니다.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 transition-colors"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
