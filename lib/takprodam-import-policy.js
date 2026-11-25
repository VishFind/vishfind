'use strict';

/**
 * Политика записи каталога Takprodam после импорта.
 *
 * Различаем:
 * - api_error / incomplete → не писать (сохранить предыдущий успешный каталог);
 * - fetched>0 && admitted===0 (массовый отказ валидации) → не писать, не success;
 * - api_empty_success (успешный ответ, предложений действительно нет) → писать пустой каталог;
 * - admitted>0 → писать новый каталог.
 */

/**
 * @param {{
 *   apiError?: boolean,
 *   incomplete?: boolean,
 *   fetched?: number,
 *   admitted?: number,
 *   apiEmptySuccess?: boolean,
 * }} input
 * @returns {{ writeCatalog: boolean, ok: boolean, outcome: string, keepPrevious: boolean }}
 */
function decideCatalogWrite(input) {
  const apiError = !!input.apiError;
  const incomplete = !!input.incomplete;
  const fetched = Number(input.fetched) || 0;
  const admitted = Number(input.admitted) || 0;
  const apiEmptySuccess = !!input.apiEmptySuccess;

  if (apiError || incomplete) {
    return {
      writeCatalog: false,
      ok: false,
      keepPrevious: true,
      outcome: apiError ? 'api_error_keep_previous' : 'incomplete_keep_previous',
    };
  }

  if (fetched > 0 && admitted === 0) {
    return {
      writeCatalog: false,
      ok: false,
      keepPrevious: true,
      outcome: 'validation_rejected_all_keep_previous',
    };
  }

  if (apiEmptySuccess && fetched === 0 && admitted === 0) {
    return {
      writeCatalog: true,
      ok: true,
      keepPrevious: false,
      outcome: 'api_empty_success_write_empty',
    };
  }

  if (admitted > 0) {
    return {
      writeCatalog: true,
      ok: true,
      keepPrevious: false,
      outcome: 'success_write_catalog',
    };
  }

  return {
    writeCatalog: false,
    ok: false,
    keepPrevious: true,
    outcome: 'ambiguous_keep_previous',
  };
}

/**
 * Простой файловый lock против параллельных импортов.
 * @param {string} lockPath
 * @param {{ staleMs?: number, pid?: number }} [opts]
 */
function acquireImportLock(lockPath, opts) {
  const fs = require('fs');
  const path = require('path');
  const staleMs = opts && opts.staleMs != null ? opts.staleMs : 30 * 60 * 1000;
  const pid = opts && opts.pid != null ? opts.pid : process.pid;
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  if (fs.existsSync(lockPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
      const at = Date.parse(raw && raw.at);
      if (Number.isFinite(at) && Date.now() - at < staleMs) {
        return {
          ok: false,
          error: 'import_locked',
          holderPid: raw.pid || null,
          at: raw.at || null,
        };
      }
    } catch (_) {
      /* битый lock — перезапишем */
    }
  }

  const payload = { pid, at: new Date().toISOString() };
  fs.writeFileSync(lockPath, JSON.stringify(payload), { flag: 'w' });
  return { ok: true, error: null, lockPath };
}

function releaseImportLock(lockPath) {
  const fs = require('fs');
  try {
    fs.unlinkSync(lockPath);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Выбор пути каталога: явный env → /data при доступности → локальный data/.
 * Amvera: persistenceMount=/data (см. docs.amvera.ru). Локально /data может отсутствовать.
 */
function resolveCatalogPath({ configuredPath, rootDir, dataRootCandidates }) {
  const path = require('path');
  const fs = require('fs');
  const configured = String(configuredPath || '').trim();
  // Явный абсолютный путь (в т.ч. /data/... на Amvera) — без автоподмены.
  if (configured && path.isAbsolute(configured)) return configured;

  // Amvera: persistenceMount=/data — относительный data/ внутри /app теряется при пересборке
  // (docs.amvera.ru/applications/storage.html). Если /data доступен для записи — используем его.
  const candidates = dataRootCandidates || ['/data'];
  for (const root of candidates) {
    try {
      if (!fs.existsSync(root)) continue;
      const st = fs.statSync(root);
      if (!st.isDirectory()) continue;
      const probe = path.join(root, 'takprodam-catalog');
      fs.mkdirSync(probe, { recursive: true });
      const testFile = path.join(probe, '.write-test');
      fs.writeFileSync(testFile, 'ok');
      fs.unlinkSync(testFile);
      return path.join(probe, 'catalog.json');
    } catch (_) {
      /* нет прав / нет /data */
    }
  }

  if (configured) return path.join(rootDir, configured);
  return path.join(rootDir, 'data', 'takprodam-catalog', 'catalog.json');
}

module.exports = {
  decideCatalogWrite,
  acquireImportLock,
  releaseImportLock,
  resolveCatalogPath,
};
