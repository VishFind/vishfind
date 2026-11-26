'use strict';

/**
 * Персистентный счётчик платных HTTP-вызовов этапа.
 * Не обнуляется при перезапуске процесса.
 * При limit<=0 учёт выключен (обычная работа).
 *
 * Путь: явный аргумент → PAID_CALL_PATH → data/paid-call-stage.json.
 * Тесты обязаны задавать PAID_CALL_PATH во временный файл.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_PATH = path.join(__dirname, '..', 'data', 'paid-call-stage.json');

function resolvePath(filePath, env) {
  if (filePath) return filePath;
  const e = env || process.env;
  const fromEnv = String((e && e.PAID_CALL_PATH) || '').trim();
  if (fromEnv) return fromEnv;
  return DEFAULT_PATH;
}

function readState(filePath, env) {
  const p = resolvePath(filePath, env);
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    return {
      stage: String(raw.stage || ''),
      used: Math.max(0, Number(raw.used) || 0),
      limit: Math.max(0, Number(raw.limit) || 0),
      updated_at: raw.updated_at || null,
      path: p,
    };
  } catch (_) {
    return { stage: '', used: 0, limit: 0, updated_at: null, path: p };
  }
}

function writeState(state, filePath, env) {
  const p = resolvePath(filePath, env);
  const dir = path.dirname(p);
  fs.mkdirSync(dir, { recursive: true });
  const out = {
    stage: String(state.stage || ''),
    used: Math.max(0, Number(state.used) || 0),
    limit: Math.max(0, Number(state.limit) || 0),
    updated_at: new Date().toISOString(),
  };
  fs.writeFileSync(p, JSON.stringify(out, null, 2) + '\n', 'utf8');
  return Object.assign({}, out, { path: p });
}

/**
 * Инициализация/синхронизация этапа из env (не уменьшает used).
 */
function syncFromEnv(env, filePath) {
  const e = env || process.env;
  const stage = String(e.PAID_CALL_STAGE || '').trim();
  const limit = Math.max(0, Number(e.PAID_CALL_LIMIT) || 0);
  const p = resolvePath(filePath, e);
  if (!stage || limit <= 0) {
    return { enabled: false, ...readState(p, e) };
  }
  const cur = readState(p, e);
  if (cur.stage !== stage) {
    // Новый этап — начинаем с 0. Смена stage только явным PAID_CALL_STAGE.
    return {
      enabled: true,
      ...writeState({ stage, used: 0, limit }, p, e),
    };
  }
  // Тот же этап: limit можно поднять, used не трогаем.
  if (cur.limit !== limit) {
    return {
      enabled: true,
      ...writeState({ stage: cur.stage, used: cur.used, limit }, p, e),
    };
  }
  return { enabled: true, ...cur };
}

/**
 * Резервирует один платный вызов. Бросает { code: 'PAID_CALL_LIMIT' }, если лимит исчерпан.
 * @returns {{ enabled: boolean, stage: string, used: number, limit: number }}
 */
function beginCall(env, filePath) {
  const e = env || process.env;
  const synced = syncFromEnv(e, filePath);
  if (!synced.enabled) {
    return { enabled: false, stage: synced.stage || '', used: synced.used || 0, limit: 0 };
  }
  if (synced.used >= synced.limit) {
    const err = new Error(
      `Лимит платных вызовов этапа исчерпан (${synced.used}/${synced.limit}).`
    );
    err.code = 'PAID_CALL_LIMIT';
    err.paid = { stage: synced.stage, used: synced.used, limit: synced.limit };
    throw err;
  }
  const next = writeState(
    { stage: synced.stage, used: synced.used + 1, limit: synced.limit },
    filePath,
    e
  );
  return { enabled: true, ...next };
}

function publicStatus(env, filePath) {
  const synced = syncFromEnv(env || process.env, filePath);
  return {
    enabled: !!synced.enabled,
    stage: synced.stage || null,
    used: synced.used || 0,
    limit: synced.limit || 0,
    remaining: synced.enabled ? Math.max(0, synced.limit - synced.used) : null,
    updated_at: synced.updated_at || null,
  };
}

module.exports = {
  DEFAULT_PATH,
  resolvePath,
  readState,
  writeState,
  syncFromEnv,
  beginCall,
  publicStatus,
};
