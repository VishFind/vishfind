'use strict';

/**
 * Точка входа для Timeweb Apps.
 * Сначала открываем PORT (health сразу 200), потом грузим приложение.
 * Express не используется. «audited 1 package» — нормально.
 */

const http = require('http');

const RELEASE = 'partner-cards-rank-2026-11-26d';
const rawPort = Number(process.env.PORT);
const PORT = Number.isFinite(rawPort) && rawPort >= 1 && rawPort <= 65535 ? rawPort : 3000;
let HOST = String(process.env.HOST || '0.0.0.0').trim() || '0.0.0.0';
if (
  String(process.env.NODE_ENV || '').toLowerCase() === 'production' &&
  (HOST === '127.0.0.1' || HOST === 'localhost')
) {
  HOST = '0.0.0.0';
}

let appHandler = null;
let loadError = null;

function sendJson(res, status, obj, method) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(method === 'HEAD' ? '' : body);
}

function earlyHandler(req, res) {
  const p = String(req.url || '').split('?')[0];
  const method = req.method || 'GET';
  if (
    (method === 'GET' || method === 'HEAD') &&
    (p === '/api/health' || p === '/api/healthz' || p === '/health' || p === '/ping')
  ) {
    return sendJson(
      res,
      200,
      {
        ok: true,
        name: 'vishfind',
        release: RELEASE,
        booting: !appHandler,
        load_error: loadError,
        partner_catalog_ready: false,
      },
      method
    );
  }
  if (typeof appHandler === 'function') {
    return appHandler(req, res);
  }
  return sendJson(res, 503, { error: 'starting', release: RELEASE, load_error: loadError }, method);
}

process.on('uncaughtException', (e) => {
  loadError = String(e && e.message ? e.message : e);
  console.error('[boot] uncaughtException', e && e.stack ? e.stack : e);
  // Порт уже слушается — не выходим, иначе Timeweb restart loop.
});
process.on('unhandledRejection', (e) => {
  loadError = String(e && e.message ? e.message : e);
  console.error('[boot] unhandledRejection', e && e.stack ? e.stack : e);
});

const server = http.createServer((req, res) => {
  try {
    earlyHandler(req, res);
  } catch (e) {
    console.error('[boot] request crash', e && e.stack ? e.stack : e);
    if (!res.headersSent) {
      res.writeHead(500);
      res.end('error');
    }
  }
});

server.on('error', (e) => {
  console.error('[boot] listen error', e && e.stack ? e.stack : e);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`[boot] listening ${HOST}:${PORT} release=${RELEASE} node=${process.version}`);
  setImmediate(() => {
    try {
      const app = require('./server.js');
      if (typeof app.createRequestListener !== 'function') {
        loadError = 'createRequestListener_missing';
        console.error('[boot]', loadError);
        return;
      }
      appHandler = app.createRequestListener({ release: RELEASE });
      console.log('[boot] app handler ready');
      setTimeout(() => {
        try {
          const r = require('./scripts/prepare-catalog').prepareCatalog();
          console.log(
            '[boot] catalog',
            r && r.ok ? 'ok' : 'skip/fail',
            r && (r.itemCount != null ? r.itemCount : r.reason || r.error || '')
          );
        } catch (e) {
          loadError = String(e && e.message ? e.message : e);
          console.error('[boot] catalog error', e && e.stack ? e.stack : e);
        }
      }, 50);
    } catch (e) {
      loadError = String(e && e.message ? e.message : e);
      console.error('[boot] failed loading server.js', e && e.stack ? e.stack : e);
    }
  });
});
