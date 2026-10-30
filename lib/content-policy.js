'use strict';

/**
 * Ограничения явного порнографического и экстремистского поискового намерения.
 * Не юридическая гарантия и не полная модерация фотографий.
 * Текстовые правила не обеспечивают проверку содержимого изображений.
 *
 * Сравнение — по нормализованной копии; исходный query для поиска не меняется.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'data', 'content-policy-rules.json');

const USER_MESSAGE =
  'Этот запрос не поддерживается. Попробуйте описать одежду, бренд, цвет или другие характеристики';

/** Высокоуверенные сочетания намерения + объекта (RU/EN). Без одиночных неоднозначных слов. */
const PHRASE_RULES = [
  {
    id: 'porn_intent_ru',
    re: /(?:скачать|смотреть|найти|искать|купить|поиск)\s+порно(?:граф)?|(?:порно(?:граф)?)\s+(?:видео|фильм(?:ы)?|ролик(?:и)?|фото|контент)|порнограф(?:ия|ический|ические|ического)\s+(?:контент|материал|фильм)/,
  },
  {
    id: 'porn_intent_en',
    re: /\b(?:download|watch|find|search(?:\s+for)?|buy)\s+(?:porn|xxx)\b|\bporn(?:ographic)?\s+(?:video|videos|movie|movies|film|films|tube|content)\b|\bxxx\s+(?:video|videos|movie|movies)\b/,
  },
  {
    id: 'extremist_materials_ru',
    re: /(?:скачать|купить|найти|искать|поиск|распространять)\s+экстремистск|(?:экстремистск(?:ая|ие|ую|ий|ого)\s+(?:пропаганд|литератур|материал|контент))/,
  },
  {
    id: 'extremist_materials_en',
    re: /\b(?:download|buy|find|search(?:\s+for)?|distribute)\s+extremist\s+(?:propaganda|materials?|literature|content)\b|\bextremist\s+propaganda\b/,
  },
];

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (_) {
    return { version: 1, extremist_org_names: [], extremist_symbols: [] };
  }
}

/** Нормализация только для сравнения: регистр, ё→е, сжатие пробелов. */
function normalizeForMatch(text) {
  return String(text == null ? '' : text)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Отрицание рядом с объектом («без экстремистской…») — не блок.
 */
function hasNegationNear(norm, idx) {
  if (idx < 0) return false;
  const window = norm.slice(Math.max(0, idx - 24), idx);
  return /(?:^|\s)(?:без|не|no|without|free\s+of)\s*$/i.test(window)
    || /(?:без|не)\s+[\wа-я-]*$/i.test(window);
}

function matchPhrases(norm) {
  for (const rule of PHRASE_RULES) {
    const m = norm.match(rule.re);
    if (!m) continue;
    if (hasNegationNear(norm, m.index)) continue;
    return { allowed: false, rule_id: rule.id };
  }
  return null;
}

function matchConfiguredNames(norm, config) {
  const names = Array.isArray(config.extremist_org_names) ? config.extremist_org_names : [];
  const symbols = Array.isArray(config.extremist_symbols) ? config.extremist_symbols : [];
  const intent = /(?:скачать|купить|найти|искать|поиск|download|buy|find|search)/;
  if (!intent.test(norm)) return null;

  for (const name of names) {
    const n = normalizeForMatch(name);
    if (!n || n.length < 3) continue;
    const re = new RegExp('(?:^|\\s)' + escapeRe(n) + '(?:\\s|$)');
    const m = norm.match(re);
    if (m && !hasNegationNear(norm, m.index)) {
      return { allowed: false, rule_id: 'extremist_org_configured' };
    }
  }
  for (const sym of symbols) {
    const s = normalizeForMatch(sym);
    if (!s || s.length < 2) continue;
    if (norm.includes(s) && intent.test(norm)) {
      return { allowed: false, rule_id: 'extremist_symbol_configured' };
    }
  }
  return null;
}

function checkText(text) {
  const norm = normalizeForMatch(text);
  if (!norm) return { allowed: true, rule_id: null };
  const hit = matchPhrases(norm) || matchConfiguredNames(norm, loadConfig());
  if (hit) return hit;
  return { allowed: true, rule_id: null };
}

/**
 * Поля критериев, которые реально влияют на формирование ссылок / фразы.
 * Не сканируем весь JSON произвольно.
 */
function attributeTexts(attrs) {
  if (!attrs || typeof attrs !== 'object') return [];
  const out = [];
  const push = (v) => {
    if (v == null || v === '') return;
    if (Array.isArray(v)) {
      for (const item of v) {
        if (item != null && String(item).trim()) out.push(String(item));
      }
      return;
    }
    if (typeof v === 'string' || typeof v === 'number') out.push(String(v));
  };
  push(attrs.category);
  push(attrs.categories);
  push(attrs.color);
  push(attrs.colors);
  push(attrs.size);
  push(attrs.sizes);
  push(attrs.brand);
  push(attrs.brands);
  push(attrs.rest);
  push(attrs.features);
  return out;
}

/**
 * @param {{ query?: string, attributes?: object|null }} input
 * @returns {{ allowed: true, rule_id: null } | { allowed: false, rule_id: string, error: string, error_kind: 'content_not_allowed' }}
 */
function checkSearchInput(input) {
  const query = input && input.query != null ? String(input.query) : '';
  const parts = [query, ...attributeTexts(input && input.attributes)];
  for (const part of parts) {
    const r = checkText(part);
    if (!r.allowed) {
      return {
        allowed: false,
        rule_id: r.rule_id,
        error: USER_MESSAGE,
        error_kind: 'content_not_allowed',
      };
    }
  }
  return { allowed: true, rule_id: null };
}

module.exports = {
  USER_MESSAGE,
  normalizeForMatch,
  checkText,
  checkSearchInput,
  attributeTexts,
  PHRASE_RULES,
};
