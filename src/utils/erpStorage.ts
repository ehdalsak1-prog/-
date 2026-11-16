import { INITIAL_ERP_STATE } from '../constants/initialData.ts';
import type { ErpAppState } from '../types/erp.ts';
import { hasCustomErpData, normalizeErpState } from './erpMutations.ts';

const STORAGE_KEY_STATE = 'dain_40a_erp_state_v1';
const STORAGE_KEY_THEME = 'mat_calc_theme';
const STORAGE_KEY_SYNC_REV = 'dain_40a_erp_sync_rev_v1';
const STORAGE_KEY_LEGACY_MIGRATED = 'dain_40a_erp_legacy_migrated_v1';
const STORAGE_KEY_CLIENT_ID = 'dain_40a_erp_client_id_v1';

export interface HtmlBootstrapEnvelope {
  revision: number;
  state: ErpAppState;
  appliedOpIds: string[];
  bootstrappedAt?: string;
}

declare global {
  interface Window {
    __INITIAL_ERP_BOOTSTRAP__?: HtmlBootstrapEnvelope;
  }
}

export function readHtmlBootstrap(): HtmlBootstrapEnvelope | null {
  try {
    const raw = typeof window !== 'undefined' ? window.__INITIAL_ERP_BOOTSTRAP__ : undefined;
    if (!raw || typeof raw.revision !== 'number') return null;
    const normalized = normalizeErpState(raw.state);
    if (!normalized) return null;
    return {
      revision: raw.revision,
      state: normalized,
      appliedOpIds: Array.isArray(raw.appliedOpIds) ? raw.appliedOpIds : [],
      bootstrappedAt: raw.bootstrappedAt,
    };
  } catch {
    return null;
  }
}

export function loadLocalCachedErpState(): { state: ErpAppState; fromStorage: boolean } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_STATE);
    if (raw) {
      const normalized = normalizeErpState(JSON.parse(raw));
      if (normalized) {
        return { state: normalized, fromStorage: true };
      }
    }
  } catch (err) {
    console.error('Failed to load ERP state from localStorage:', err);
  }
  return {
    state: JSON.parse(JSON.stringify(INITIAL_ERP_STATE)),
    fromStorage: false,
  };
}

export function loadErpState(): ErpAppState {
  return loadLocalCachedErpState().state;
}

export function saveErpState(state: ErpAppState): void {
  try {
    localStorage.setItem(STORAGE_KEY_STATE, JSON.stringify(state));
  } catch (err) {
    console.error('Failed to save ERP state:', err);
  }
}

export function resetErpState(): ErpAppState {
  const fresh: ErpAppState = JSON.parse(JSON.stringify(INITIAL_ERP_STATE));
  fresh.lastUpdatedAt = new Date().toISOString();
  saveErpState(fresh);
  return fresh;
}

export function getStoredSyncRevision(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SYNC_REV);
    const parsed = raw ? parseInt(raw, 10) : 0;
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

export function setStoredSyncRevision(revision: number): void {
  try {
    localStorage.setItem(STORAGE_KEY_SYNC_REV, String(revision));
  } catch {}
}

export function needsLegacyMigration(): boolean {
  try {
    if (localStorage.getItem(STORAGE_KEY_LEGACY_MIGRATED) === '1') return false;
    const { state, fromStorage } = loadLocalCachedErpState();
    return fromStorage && hasCustomErpData(state);
  } catch {
    return false;
  }
}

export function markLegacyMigrated(): void {
  try {
    localStorage.setItem(STORAGE_KEY_LEGACY_MIGRATED, '1');
  } catch {}
}

export function getOrCreateClientId(): string {
  try {
    const existing = sessionStorage.getItem(STORAGE_KEY_CLIENT_ID);
    if (existing) return existing;
    const created = `client_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    sessionStorage.setItem(STORAGE_KEY_CLIENT_ID, created);
    return created;
  } catch {
    return `client_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }
}

export function getStoredTheme(): 'light' | 'dark' {
  try {
    const theme = localStorage.getItem(STORAGE_KEY_THEME);
    if (theme === 'dark' || theme === 'light') return theme;
  } catch {}
  return 'light';
}

export function setStoredTheme(theme: 'light' | 'dark'): void {
  try {
    localStorage.setItem(STORAGE_KEY_THEME, theme);
  } catch {}
}
