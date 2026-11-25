'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  decideCatalogWrite,
  acquireImportLock,
  releaseImportLock,
  resolveCatalogPath,
} = require('../lib/takprodam-import-policy');

test('decideCatalogWrite: API error / incomplete → keep previous', () => {
  const a = decideCatalogWrite({
    apiError: true,
    incomplete: false,
    fetched: 10,
    admitted: 5,
    apiEmptySuccess: false,
  });
  assert.equal(a.writeCatalog, false);
  assert.equal(a.keepPrevious, true);
  assert.equal(a.outcome, 'api_error_keep_previous');

  const b = decideCatalogWrite({
    apiError: false,
    incomplete: true,
    fetched: 3,
    admitted: 1,
    apiEmptySuccess: false,
  });
  assert.equal(b.writeCatalog, false);
  assert.equal(b.keepPrevious, true);
  assert.equal(b.outcome, 'incomplete_keep_previous');
});

test('decideCatalogWrite: validation rejected all → keep previous, not success', () => {
  const d = decideCatalogWrite({
    apiError: false,
    incomplete: false,
    fetched: 40,
    admitted: 0,
    apiEmptySuccess: false,
  });
  assert.equal(d.writeCatalog, false);
  assert.equal(d.ok, false);
  assert.equal(d.keepPrevious, true);
  assert.equal(d.outcome, 'validation_rejected_all_keep_previous');
});

test('decideCatalogWrite: api empty success → write empty catalog', () => {
  const d = decideCatalogWrite({
    apiError: false,
    incomplete: false,
    fetched: 0,
    admitted: 0,
    apiEmptySuccess: true,
  });
  assert.equal(d.writeCatalog, true);
  assert.equal(d.ok, true);
  assert.equal(d.keepPrevious, false);
  assert.equal(d.outcome, 'api_empty_success_write_empty');
});

test('decideCatalogWrite: admitted>0 → write; admitted===0 without empty flag → keep', () => {
  const ok = decideCatalogWrite({
    apiError: false,
    incomplete: false,
    fetched: 10,
    admitted: 4,
    apiEmptySuccess: false,
  });
  assert.equal(ok.writeCatalog, true);
  assert.equal(ok.outcome, 'success_write_catalog');

  const amb = decideCatalogWrite({
    apiError: false,
    incomplete: false,
    fetched: 0,
    admitted: 0,
    apiEmptySuccess: false,
  });
  assert.equal(amb.writeCatalog, false);
  assert.equal(amb.keepPrevious, true);
  assert.equal(amb.outcome, 'ambiguous_keep_previous');
});

test('import lock: второй acquire блокируется до release', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-lock-'));
  const lockPath = path.join(dir, 'import.lock');
  const first = acquireImportLock(lockPath, { pid: 111 });
  assert.equal(first.ok, true);
  const second = acquireImportLock(lockPath, { pid: 222 });
  assert.equal(second.ok, false);
  assert.equal(second.error, 'import_locked');
  assert.equal(releaseImportLock(lockPath), true);
  const third = acquireImportLock(lockPath, { pid: 333 });
  assert.equal(third.ok, true);
  releaseImportLock(lockPath);
});

test('resolveCatalogPath: явный абсолютный путь; иначе fallback в root/data', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-root-'));
  const abs = path.join(root, 'custom', 'catalog.json');
  assert.equal(
    resolveCatalogPath({ configuredPath: abs, rootDir: root, dataRootCandidates: [] }),
    abs
  );
  const rel = resolveCatalogPath({
    configuredPath: 'data/takprodam-catalog/catalog.json',
    rootDir: root,
    dataRootCandidates: [],
  });
  assert.equal(rel, path.join(root, 'data', 'takprodam-catalog', 'catalog.json'));

  const fallback = resolveCatalogPath({
    configuredPath: null,
    rootDir: root,
    dataRootCandidates: [path.join(root, 'missing-data-root')],
  });
  assert.equal(fallback, path.join(root, 'data', 'takprodam-catalog', 'catalog.json'));

  const dataRoot = path.join(root, 'persist');
  fs.mkdirSync(dataRoot);
  // Даже при относительном configuredPath доступный data-root важнее (Amvera /data).
  const viaData = resolveCatalogPath({
    configuredPath: 'data/takprodam-catalog/catalog.json',
    rootDir: root,
    dataRootCandidates: [dataRoot],
  });
  assert.equal(viaData, path.join(dataRoot, 'takprodam-catalog', 'catalog.json'));
  assert.ok(fs.existsSync(path.join(dataRoot, 'takprodam-catalog')));
});
