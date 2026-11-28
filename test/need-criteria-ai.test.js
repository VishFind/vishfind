'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  fallbackNeedCriteria,
  suggestNeedCriteria,
  rankingExtraScore,
  pickBestByCriteria,
  scoreOfferForCriterion,
} = require('../lib/need-criteria-ai');

test('fallback: зимняя куртка даёт теплоту', () => {
  const r = fallbackNeedCriteria('самая тёплая зимняя куртка', { category: 'куртка' });
  assert.equal(r.criteria.length, 5);
  assert.ok(r.criteria.some((c) => c.id === 'warmth'));
  assert.ok(r.boost_terms.some((t) => /тёпл|тепл|пуховик|утепл|зимн/.test(t)));
});

test('fallback: летние джинсы — дышащие/комфорт', () => {
  const r = fallbackNeedCriteria('летние джинсы дышащие', { category: 'джинсы' });
  assert.ok(r.criteria.some((c) => c.id === 'breathable' || c.id === 'fit' || c.id === 'comfort'));
  assert.ok(r.penalize_terms.some((t) => /куртк|jacket|бомбер|зимн|утепл/.test(t)));
});

test('rankingExtraScore поднимает тёплые названия', () => {
  const ranking = fallbackNeedCriteria('тёплая куртка', { category: 'куртка' });
  const warm = rankingExtraScore('Куртка утеплённая зимняя', ranking);
  const light = rankingExtraScore('Куртка летняя тонкая', ranking);
  assert.ok(warm > light);
});

test('suggestNeedCriteria без ollamaChat = rules', async () => {
  const r = await suggestNeedCriteria({
    query: 'сумка кожаная',
    parsed: { category: 'сумка' },
  });
  assert.equal(r.source, 'rules');
  assert.equal(r.criteria.length, 5);
});

test('suggestNeedCriteria с qwen-ответом', async () => {
  const r = await suggestNeedCriteria({
    query: 'зимняя куртка',
    parsed: { category: 'куртка' },
    model: 'qwen3-vl:4b-instruct',
    provider: 'ollama',
    external: false,
    ollamaChat: async () => ({
      message: {
        content: JSON.stringify({
          focus_category: 'куртка',
          criteria: [
            { id: 'relevance', label: 'Соответствие', weight: 2 },
            { id: 'price', label: 'Цена', weight: 1 },
            { id: 'quality', label: 'Качество', weight: 1 },
            { id: 'warmth', label: 'Теплота', weight: 1.5 },
            { id: 'material', label: 'Материал', weight: 1.2 },
          ],
          boost_terms: ['утепл', 'пуховик'],
          penalize_terms: ['летн'],
        }),
      },
    }),
  });
  assert.equal(r.source, 'ollama');
  assert.equal(r.external, false);
  assert.ok(r.criteria.some((c) => c.id === 'warmth'));
});

test('на production auto → rules без внешних вызовов', () => {
  const { resolveNeedCriteriaMode } = require('../lib/need-criteria-ai');
  assert.equal(
    resolveNeedCriteriaMode({
      needCriteriaProvider: 'auto',
      isProd: true,
      aiEnabled: true,
      photoProvider: 'timeweb',
      timewebConfigured: true,
    }),
    'rules'
  );
});

test('pickBestByCriteria: разные бейджи и реальный лидер по цене', () => {
  const ranking = fallbackNeedCriteria('джинсы', { category: 'джинсы' });
  const rows = [
    {
      id: 'a',
      title: 'Джинсы slim stretch хлопок',
      price: 9000,
      currency: 'RUB',
      brand: 'A',
      need_score: 40,
    },
    {
      id: 'b',
      title: 'Джинсы базовые',
      price: 2500,
      currency: 'RUB',
      brand: 'B',
      need_score: 35,
    },
    {
      id: 'c',
      title: 'Джинсы премиум натуральный хлопок',
      price: 12000,
      currency: 'RUB',
      brand: 'C',
      need_score: 38,
    },
    {
      id: 'd',
      title: 'Джинсы regular comfort',
      price: 4500,
      currency: 'RUB',
      brand: 'D',
      need_score: 42,
    },
    {
      id: 'e',
      title: 'Джинсы straight',
      price: 5000,
      currency: 'RUB',
      brand: 'E',
      need_score: 30,
    },
  ];
  const picked = pickBestByCriteria(rows, ranking.criteria, 5);
  assert.equal(picked.length, 5);
  const labels = picked.map((p) => p.best_for && p.best_for.label).filter(Boolean);
  assert.equal(new Set(labels).size, labels.length);
  const priceWinner = picked.find((p) => p.best_for && p.best_for.id === 'price');
  assert.ok(priceWinner);
  assert.equal(priceWinner.id, 'b');
  const cheapScore = scoreOfferForCriterion(rows[1], { id: 'price', weight: 1 });
  const dearScore = scoreOfferForCriterion(rows[2], { id: 'price', weight: 1 });
  assert.ok(cheapScore > dearScore);
});
