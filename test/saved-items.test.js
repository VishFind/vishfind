'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Saved = require('../js/saved-items.js');

test('миграция: Ozon + query → название вещи, площадка вторична', () => {
  const { list, changed } = Saved.migrateSavedList([
    {
      id: '1',
      type: 'link',
      title: 'Ozon',
      url: 'https://www.ozon.ru/search/?text=kurtka',
      query: 'Чёрная винтажная куртка',
      at: '2026-10-26T00:00:00.000Z',
    },
  ]);
  assert.equal(changed, true);
  assert.equal(list.length, 1);
  assert.equal(list[0].item, 'Чёрная винтажная куртка');
  assert.equal(list[0].place, 'Ozon');
  assert.equal(list[0].url, 'https://www.ozon.ru/search/?text=kurtka');
});

test('миграция идемпотентна и не дублирует', () => {
  const first = Saved.migrateSavedList([
    { id: '1', type: 'link', title: 'Wildberries', url: 'https://wb.example/1', query: 'красное платье' },
  ]);
  const second = Saved.migrateSavedList(first.list);
  assert.equal(second.changed, false);
  assert.equal(second.list.length, 1);
  assert.equal(second.list[0].item, 'Красное платье');
});

test('разные URL одной площадки не сливаются', () => {
  const { list } = Saved.migrateSavedList([
    { id: 'a', type: 'link', title: 'Ozon', url: 'https://ozon.test/a', query: 'куртка' },
    { id: 'b', type: 'link', title: 'Ozon', url: 'https://ozon.test/b', query: 'куртка' },
  ]);
  assert.equal(list.length, 2);
});

test('хорошее название предложения не подменяется', () => {
  const { list } = Saved.migrateSavedList([
    {
      id: 'o1',
      type: 'offer',
      title: 'Куртка кожаная, чёрная',
      item: 'Куртка кожаная, чёрная',
      price: 18900,
      currency: 'RUB',
      is_demo: true,
      url: '',
      at: '2026-10-26T00:00:00.000Z',
    },
  ]);
  assert.equal(list[0].item, 'Куртка кожаная, чёрная');
  assert.equal(list[0].title, 'Куртка кожаная, чёрная');
  assert.notEqual(list[0].needs_rename, true);
});

test('без названия вещи — нейтральная подпись и needs_rename', () => {
  const { list } = Saved.migrateSavedList([
    { id: 'o2', type: 'offer', title: 'Ozon', price: 100, currency: 'RUB', is_demo: true },
  ]);
  assert.equal(list[0].item, 'Сохранённое предложение');
  assert.equal(list[0].needs_rename, true);
});

test('повреждённый JSON не роняет загрузку', () => {
  const storage = Saved.createMemoryStorage({ 'vishfind-saved': '{not-json' });
  const res = Saved.loadSaved(storage);
  assert.deepEqual(res.list, []);
  assert.match(res.error || '', /поврежд/i);
});

test('некорректный тип данных', () => {
  const storage = Saved.createMemoryStorage({ 'vishfind-saved': '{"a":1}' });
  const res = Saved.loadSaved(storage);
  assert.deepEqual(res.list, []);
  assert.match(res.error || '', /неверн/i);
});

test('переполнение setItem не сообщает ложный успех', () => {
  const storage = {
    getItem: () => '[]',
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
    removeItem: () => {},
  };
  const res = Saved.writeSaved(storage, [{ id: '1', type: 'query', query: 'куртка', item: 'Куртка' }]);
  assert.equal(res.ok, false);
  assert.match(res.error || '', /сохранить|переполн/i);
});

test('хранилище недоступно', () => {
  const res = Saved.loadSaved(null);
  assert.deepEqual(res.list, []);
  assert.match(res.error || '', /недоступн/i);
});

test('renameSavedItem', () => {
  const list = [{ id: '1', type: 'link', item: 'Сохранённая ссылка', needs_rename: true, url: 'https://x' }];
  const out = Saved.renameSavedItem(list, '1', 'Моя куртка');
  assert.equal(out.list[0].item, 'Моя куртка');
  assert.equal(out.list[0].needs_rename, false);
});
