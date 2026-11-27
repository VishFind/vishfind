'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  fallbackNeedCriteria,
  suggestNeedCriteria,
  rankingExtraScore,
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
