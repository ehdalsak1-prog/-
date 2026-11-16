import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  doc,
  getDocFromServer,
  type Firestore,
} from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import firebaseConfig from '../firebase-applet-config.json';

export const SHARED_LEDGER_ID = 'dain_yongin_shared';

const app = initializeApp(firebaseConfig);

let dbInstance: Firestore;
try {
  dbInstance = initializeFirestore(
    app,
    {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
    },
    firebaseConfig.firestoreDatabaseId
  );
} catch {
  dbInstance = getFirestore(app, firebaseConfig.firestoreDatabaseId);
}

export const db = dbInstance;
// Auth is retained silently only to allow optional read-only recovery of legacy per-user data if already signed in
export const auth = getAuth(app);
export const storage = getStorage(app);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid ?? null,
      email: auth.currentUser?.email ?? null,
      emailVerified: auth.currentUser?.emailVerified ?? null,
      isAnonymous: auth.currentUser?.isAnonymous ?? null,
      tenantId: auth.currentUser?.tenantId ?? null,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

/**
 * Ensures any document ID strictly conforms to Firestore rules `^[a-zA-Z0-9_\-]+$` (1..128 chars).
 */
export function sanitizeFirestoreId(rawId: string, fallbackPrefix = 'doc'): string {
  const cleaned = (rawId || '')
    .trim()
    .replace(/[^a-zA-Z0-9_\-]/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
  if (cleaned && /^[a-zA-Z0-9_\-]+$/.test(cleaned)) {
    return cleaned;
  }
  return `${fallbackPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export async function testConnection(): Promise<{ ok: boolean; error?: string; latencyMs: number }> {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  try {
    await getDocFromServer(doc(db, 'ledgers', SHARED_LEDGER_ID));
    const latencyMs = Math.round(
      (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0
    );
    return { ok: true, latencyMs };
  } catch (error) {
    const latencyMs = Math.round(
      (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0
    );
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
    return { ok: false, error: msg, latencyMs };
  }
}

export async function diagnoseConnectivity(rawErr?: string): Promise<{
  category: 'preview_server' | 'firestore_permission' | 'firestore_quota' | 'firestore_offline' | 'unknown';
  summary: string;
  detail: string;
}> {
  // Check local/preview app server responsiveness
  let previewServerOk = false;
  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 3000);
    const res = await fetch('/api/health', { signal: controller.signal, cache: 'no-store' });
    window.clearTimeout(timer);
    previewServerOk = res.ok;
  } catch {
    previewServerOk = false;
  }

  const fbTest = await testConnection();
  const combinedErr = `${rawErr || ''} ${fbTest.error || ''}`;
  const lower = combinedErr.toLowerCase();

  if (!previewServerOk && !fbTest.ok) {
    return {
      category: 'preview_server',
      summary: '개발 미리보기 서버 및 네트워크 연결 지연',
      detail:
        '앱 서버(/api/health)와 데이터베이스 모두 응답하지 않습니다. 인터넷 연결 또는 AI Studio 미리보기 세션을 새로고침해 주세요.',
    };
  }

  if (lower.includes('permission-denied') || lower.includes('missing or insufficient permissions')) {
    return {
      category: 'firestore_permission',
      summary: 'Firestore 보안 규칙(권한) 오류',
      detail:
        '공용 대장 접근 권한이 거부되었습니다. Firestore 보안 규칙(firestore.rules) 배포 상태와 경로를 확인해 주세요.',
    };
  }

  if (lower.includes('quota') || lower.includes('resource-exhausted')) {
    return {
      category: 'firestore_quota',
      summary: 'Firestore 사용량 한도(Quota) 초과',
      detail:
        '일일 무료 읽기/쓰기 한도에 도달했습니다. Firebase 콘솔에서 할당량 상태를 확인해 주세요.',
    };
  }

  if (!fbTest.ok || lower.includes('offline') || lower.includes('unavailable') || lower.includes('timeout')) {
    return {
      category: 'firestore_offline',
      summary: previewServerOk
        ? '앱 서버는 정상이나 Cloud Firestore 연결 실패'
        : '네트워크 또는 Firestore 연결 지연',
      detail: previewServerOk
        ? `앱 서버(/api/health)는 정상 응답했지만 Cloud Firestore 서버 응답이 지연되거나 차단되었습니다. (${fbTest.error || rawErr || '시간 초과'})`
        : '네트워크 연결이 불안정하거나 방화벽에서 Firestore 통신이 차단되었습니다.',
    };
  }

  return {
    category: 'unknown',
    summary: '일시적 동기화 오류',
    detail: rawErr || '데이터베이스와 동기화하는 중 알 수 없는 오류가 발생했습니다.',
  };
}

export default app;
