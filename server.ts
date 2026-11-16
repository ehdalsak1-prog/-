import express from 'express';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { INITIAL_ERP_STATE } from './src/constants/initialData.ts';
import type { ErpAppState } from './src/types/erp.ts';
import {
  applyErpMutation,
  hasCustomErpData,
  mergeLegacyStateIntoAuthoritative,
  normalizeErpState,
  type ErpMutationAction,
  type ErpMutationResult,
} from './src/utils/erpMutations.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const IS_PROD = process.env.NODE_ENV === 'production';
const DATA_DIR = path.resolve(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'erp-state.json');
const MAX_APPLIED_OP_IDS = 500;

interface PersistedEnvelope {
  revision: number;
  state: ErpAppState;
  appliedOpIds: string[];
}

interface AliveWebSocket extends WebSocket {
  isAlive?: boolean;
}

let serverRevision = 0;
let serverState: ErpAppState = JSON.parse(JSON.stringify(INITIAL_ERP_STATE));
let appliedOpIds: string[] = [];
const appliedOpSet = new Set<string>();
const opResultCache = new Map<string, { ok: boolean; error?: string; data?: ErpMutationResult['data'] }>();

function recordAppliedOp(
  opId: string,
  result: { ok: boolean; error?: string; data?: ErpMutationResult['data'] }
) {
  if (!opId || appliedOpSet.has(opId)) return;
  appliedOpSet.add(opId);
  appliedOpIds.push(opId);
  opResultCache.set(opId, result);
  while (appliedOpIds.length > MAX_APPLIED_OP_IDS) {
    const oldest = appliedOpIds.shift();
    if (oldest) {
      appliedOpSet.delete(oldest);
      opResultCache.delete(oldest);
    }
  }
}

async function loadPersistedState(): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const raw = await fs.readFile(DATA_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<PersistedEnvelope>;
    const normalized = normalizeErpState(parsed?.state ?? parsed);
    if (normalized) {
      serverState = normalized;
      serverRevision = typeof parsed?.revision === 'number' && parsed.revision >= 0 ? parsed.revision : 1;
      const ops = Array.isArray(parsed?.appliedOpIds) ? parsed.appliedOpIds : [];
      appliedOpIds = ops.slice(-MAX_APPLIED_OP_IDS);
      appliedOpIds.forEach((id) => appliedOpSet.add(id));
      console.log(`[ERP Server] Loaded persisted state (revision=${serverRevision}, items=${serverState.items.length})`);
      return;
    }
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code !== 'ENOENT') {
      console.error('[ERP Server] Failed to read persisted state, initializing fresh seed:', err);
    }
  }
  serverRevision = 0;
  serverState = JSON.parse(JSON.stringify(INITIAL_ERP_STATE));
}

async function persistStateToDisk(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const envelope: PersistedEnvelope = {
    revision: serverRevision,
    state: serverState,
    appliedOpIds,
  };
  const tmpFile = `${DATA_FILE}.tmp.${process.pid}`;
  await fs.writeFile(tmpFile, JSON.stringify(envelope), 'utf-8');
  await fs.rename(tmpFile, DATA_FILE);
}

// 직렬화된 뮤테이션 큐 (동시 입력 시 경합/덮어쓰기 방지)
let mutationQueue: Promise<unknown> = Promise.resolve();
function enqueueTask<T>(fn: () => Promise<T>): Promise<T> {
  const next = mutationQueue.then(fn, fn);
  mutationQueue = next.catch(() => undefined);
  return next;
}

function safeJsonForHtml(payload: unknown): string {
  return JSON.stringify(payload)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function injectBootstrapHtml(html: string): string {
  const bootstrapPayload = {
    revision: serverRevision,
    state: serverState,
    appliedOpIds,
    bootstrappedAt: new Date().toISOString(),
  };
  const scriptTag = `<script>window.__INITIAL_ERP_BOOTSTRAP__=${safeJsonForHtml(bootstrapPayload)};</script>`;
  if (html.includes('</head>')) {
    return html.replace('</head>', `  ${scriptTag}\n  </head>`);
  }
  return `${scriptTag}\n${html}`;
}

async function startServer() {
  await loadPersistedState();

  const app = express();
  app.use(express.json({ limit: '15mb' }));

  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  const broadcastStateSync = (meta?: {
    lastOpId?: string;
    actorClientId?: string;
    summary?: string;
  }) => {
    const message = JSON.stringify({
      type: 'STATE_SYNC',
      revision: serverRevision,
      state: serverState,
      appliedOpIds,
      lastOpId: meta?.lastOpId,
      actorClientId: meta?.actorClientId,
      summary: meta?.summary,
    });
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  };

  httpServer.on('upgrade', (request, socket, head) => {
    try {
      const url = new URL(request.url || '/', 'http://localhost');
      if (url.pathname === '/ws') {
        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit('connection', ws, request);
        });
      }
    } catch {
      socket.destroy();
    }
  });

  wss.on('connection', (ws: AliveWebSocket) => {
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });
    ws.send(
      JSON.stringify({
        type: 'STATE_SYNC',
        revision: serverRevision,
        state: serverState,
        appliedOpIds,
      })
    );
  });

  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      const aliveWs = client as AliveWebSocket;
      if (aliveWs.isAlive === false) {
        aliveWs.terminate();
        continue;
      }
      aliveWs.isAlive = false;
      aliveWs.ping();
    }
  }, 25000);

  wss.on('close', () => clearInterval(heartbeat));

  // Health & Current State Endpoints
  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      revision: serverRevision,
      connectedClients: wss.clients.size,
      lastUpdatedAt: serverState.lastUpdatedAt,
    });
  });

  app.get('/api/erp/state', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      revision: serverRevision,
      state: serverState,
      appliedOpIds,
    });
  });

  // 기존 로컬 자료 보존 / 이관 엔드포인트
  app.post('/api/erp/migrate-legacy', async (req, res) => {
    const { clientId, state: rawLegacy } = (req.body || {}) as {
      clientId?: string;
      state?: unknown;
    };
    const legacyState = normalizeErpState(rawLegacy);
    if (!legacyState) {
      res.status(400).json({ ok: false, error: '유효하지 않은 ERP 데이터 형식입니다.' });
      return;
    }

    const outcome = await enqueueTask(async () => {
      if (serverRevision === 0) {
        if (hasCustomErpData(legacyState)) {
          serverState = legacyState;
          serverRevision = 1;
          await persistStateToDisk();
          broadcastStateSync({
            actorClientId: clientId,
            summary: '기존 저장 자료 서버 이관 완료',
          });
          return { mode: 'ADOPTED' as const, revision: serverRevision, state: serverState };
        }
        return { mode: 'SKIPPED' as const, revision: serverRevision, state: serverState };
      }

      const mergedRes = mergeLegacyStateIntoAuthoritative(serverState, legacyState);
      if (mergedRes.merged) {
        serverState = mergedRes.nextState;
        serverRevision += 1;
        await persistStateToDisk();
        broadcastStateSync({
          actorClientId: clientId,
          summary: '기존 로컬 자료 병합 반영',
        });
        return { mode: 'MERGED' as const, revision: serverRevision, state: serverState };
      }
      return { mode: 'SKIPPED' as const, revision: serverRevision, state: serverState };
    });

    res.json({ ok: true, ...outcome, appliedOpIds });
  });

  // 동시 입력 보존용 원자적 액션 실행 엔드포인트
  app.post('/api/erp/mutate', async (req, res) => {
    const { opId, clientId, action } = (req.body || {}) as {
      opId?: string;
      clientId?: string;
      action?: ErpMutationAction;
    };

    if (!opId || !action || !action.type) {
      res.status(400).json({ ok: false, error: '잘못된 요청 형식입니다.' });
      return;
    }

    const result = await enqueueTask(async () => {
      if (appliedOpSet.has(opId)) {
        const cached = opResultCache.get(opId);
        return {
          ok: cached?.ok ?? true,
          duplicate: true,
          error: cached?.error,
          data: cached?.data,
          revision: serverRevision,
          state: serverState,
          appliedOpIds,
        };
      }

      const applied = applyErpMutation(serverState, action);
      if (!applied.ok) {
        recordAppliedOp(opId, { ok: false, error: applied.error });
        return {
          ok: false,
          duplicate: false,
          error: applied.error,
          revision: serverRevision,
          state: serverState,
          appliedOpIds,
        };
      }

      serverState = applied.nextState;
      serverRevision += 1;
      recordAppliedOp(opId, { ok: true, data: applied.data });
      await persistStateToDisk();

      broadcastStateSync({
        lastOpId: opId,
        actorClientId: clientId,
        summary: applied.summary,
      });

      return {
        ok: true,
        duplicate: false,
        data: applied.data,
        summary: applied.summary,
        revision: serverRevision,
        state: serverState,
        appliedOpIds,
      };
    });

    res.json(result);
  });

  // Frontend serving (Vite dev middleware or production dist)
  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'custom',
    });

    app.use(vite.middlewares);

    app.use(async (req, res, next) => {
      if (req.method !== 'GET' || req.originalUrl.startsWith('/api')) {
        next();
        return;
      }
      try {
        const rawHtml = await fs.readFile(path.resolve(__dirname, 'index.html'), 'utf-8');
        const transformed = await vite.transformIndexHtml(req.originalUrl, rawHtml);
        const withBootstrap = injectBootstrapHtml(transformed);
        res.status(200).set({ 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }).end(withBootstrap);
      } catch (err) {
        vite.ssrFixStacktrace(err as Error);
        next(err);
      }
    });
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    const distHtml = await fs.readFile(path.join(distDir, 'index.html'), 'utf-8');
    app.use(express.static(distDir, { index: false }));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.originalUrl.startsWith('/api')) {
        next();
        return;
      }
      const withBootstrap = injectBootstrapHtml(distHtml);
      res.status(200).set({ 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }).end(withBootstrap);
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`[ERP Server] Listening on http://0.0.0.0:${PORT} (mode=${IS_PROD ? 'production' : 'development'})`);
  });
}

startServer().catch((err) => {
  console.error('[ERP Server] Fatal startup error:', err);
  process.exit(1);
});
