import type { ErpAppState } from '../types/erp.ts';
import type { ErpMutationAction, ErpMutationResult } from './erpMutations.ts';

export interface ServerStateEnvelope {
  revision: number;
  state: ErpAppState;
  appliedOpIds: string[];
  lastOpId?: string;
  actorClientId?: string;
  summary?: string;
}

export interface MutateApiResponse {
  ok: boolean;
  duplicate?: boolean;
  error?: string;
  data?: ErpMutationResult['data'];
  summary?: string;
  revision: number;
  state: ErpAppState;
  appliedOpIds: string[];
}

export interface MigrateLegacyResponse {
  ok: boolean;
  mode: 'ADOPTED' | 'MERGED' | 'SKIPPED';
  revision: number;
  state: ErpAppState;
  appliedOpIds: string[];
}

export async function fetchServerState(): Promise<ServerStateEnvelope> {
  const res = await fetch('/api/erp/state', {
    method: 'GET',
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`서버 상태 조회 실패 (${res.status})`);
  }
  return (await res.json()) as ServerStateEnvelope;
}

export async function postMutationToServer(params: {
  opId: string;
  clientId: string;
  action: ErpMutationAction;
}): Promise<MutateApiResponse> {
  const res = await fetch('/api/erp/mutate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    throw new Error(`서버 저장 실패 (${res.status})`);
  }
  return (await res.json()) as MutateApiResponse;
}

export async function postMigrateLegacyToServer(params: {
  clientId: string;
  state: ErpAppState;
}): Promise<MigrateLegacyResponse> {
  const res = await fetch('/api/erp/migrate-legacy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    throw new Error(`기존 자료 이관 실패 (${res.status})`);
  }
  return (await res.json()) as MigrateLegacyResponse;
}

export function getWebSocketUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}
