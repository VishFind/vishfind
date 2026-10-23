'use strict';
/**
 * Сравнение schema vs twopass на локальных фото (без фиктивного успеха).
 * Запуск: node scripts/compare-photo-pipelines.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OLLAMA_URL = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
const MODEL = process.env.OLLAMA_MODEL || 'qwen3-vl:4b-instruct';
const TIMEOUT_MS = Number(process.env.PHOTO_TIMEOUT_SEC || 90) * 1000;

const PHOTO_FORMAT = {
  type: 'object',
  properties: {
    garment_type: { type: ['string', 'null'] },
    subtype: { type: ['string', 'null'] },
    color_primary: { type: ['string', 'null'] },
    color_extra: { type: 'array', items: { type: 'string' } },
    material: { type: ['string', 'null'] },
    pattern: { type: ['string', 'null'] },
    collar: { type: ['string', 'null'] },
    closure: { type: ['string', 'null'] },
    pockets: { type: ['string', 'null'] },
    length: { type: ['string', 'null'] },
    fit: { type: ['string', 'null'] },
    hardware_and_details: { type: ['string', 'null'] },
    era_or_style: { type: ['string', 'null'] },
    visible_text: { type: 'array', items: { type: 'string' } },
    brand: { type: ['string', 'null'] },
    model_name: { type: ['string', 'null'] },
    description: { type: ['string', 'null'] },
  },
  required: [
    'garment_type', 'subtype', 'color_primary', 'color_extra', 'material', 'pattern',
    'collar', 'closure', 'pockets', 'length', 'fit', 'hardware_and_details',
    'era_or_style', 'visible_text', 'brand', 'model_name', 'description',
  ],
};

const PHOTOS = [
  { name: 'test-jacket.jpg', file: path.join(ROOT, 'img', 'test-jacket.jpg') },
  { name: 'team.jpeg', file: path.join(ROOT, 'images', 'team.jpeg') },
];

function extractModelText(message) {
  if (!message || typeof message !== 'object') return '';
  const content = String(message.content || '').trim();
  if (content) return content;
  return String(message.thinking || '').replace(/<\/?think>/gi, ' ').trim();
}

function parseJsonLoose(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch (_) {
    const m = s.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]);
    } catch (_) {
      return null;
    }
  }
}

function score(fields) {
  if (!fields) return 0;
  const keys = [
    'garment_type', 'subtype', 'color_primary', 'material', 'pattern', 'collar',
    'closure', 'pockets', 'length', 'fit', 'hardware_and_details', 'era_or_style', 'description',
  ];
  let n = 0;
  for (const k of keys) if (fields[k]) n += 1;
  if (Array.isArray(fields.color_extra) && fields.color_extra.length) n += 1;
  if (Array.isArray(fields.visible_text) && fields.visible_text.length) n += 1;
  if (fields.brand) n += 1;
  if (fields.model_name) n += 1;
  return n;
}

async function ollamaChat(body) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`Ollama ${r.status}: ${text.slice(0, 200)}`);
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

const SCHEMA_PROMPT =
  'Разбери одежду на фото максимально детально для поиска похожих вещей. ' +
  'Поля на русском по схеме. brand и model_name ТОЛЬКО если читаются на фото, иначе null. ' +
  'Не угадывай бренд по силуэту. description — одно предложение.';

async function runSchema(b64) {
  const t0 = Date.now();
  const data = await ollamaChat({
    model: MODEL,
    messages: [{ role: 'user', content: SCHEMA_PROMPT, images: [b64] }],
    stream: false,
    format: PHOTO_FORMAT,
    think: false,
    options: { temperature: 0, num_predict: 900 },
    keep_alive: '30m',
  });
  const raw = extractModelText(data.message);
  const fields = parseJsonLoose(raw);
  return { ms: Date.now() - t0, fields, raw: raw.slice(0, 400), ok: !!fields };
}

async function runTwopass(b64) {
  const t0 = Date.now();
  const free = await ollamaChat({
    model: MODEL,
    messages: [{
      role: 'user',
      content:
        'Опиши одежду на фото подробно по-русски. Тип, подтип, цвета, материал, застёжка, карманы, фурнитура, текст/логотипы. ' +
        'Бренд только если читается, иначе скажи что не виден.',
      images: [b64],
    }],
    stream: false,
    think: false,
    options: { temperature: 0, num_predict: 700 },
    keep_alive: '30m',
  });
  const freeText = extractModelText(free.message);
  const data = await ollamaChat({
    model: MODEL,
    messages: [{
      role: 'user',
      content:
        'Преобразуй описание в JSON по схеме. brand/model_name только если явно видны в тексте, иначе null.\n' +
        freeText,
    }],
    stream: false,
    format: PHOTO_FORMAT,
    think: false,
    options: { temperature: 0, num_predict: 900 },
    keep_alive: '30m',
  });
  const raw = extractModelText(data.message);
  const fields = parseJsonLoose(raw);
  return {
    ms: Date.now() - t0,
    fields,
    free_text: freeText.slice(0, 500),
    raw: raw.slice(0, 400),
    ok: !!fields,
  };
}

(async () => {
  const out = { model: MODEL, photos: [] };
  for (const p of PHOTOS) {
    if (!fs.existsSync(p.file)) {
      out.photos.push({ name: p.name, error: 'file missing' });
      continue;
    }
    const b64 = fs.readFileSync(p.file).toString('base64');
    console.log('---', p.name, 'schema...');
    let schema;
    try {
      schema = await runSchema(b64);
    } catch (e) {
      schema = { ok: false, error: e.message, ms: null, fields: null };
    }
    console.log('---', p.name, 'twopass...');
    let twopass;
    try {
      twopass = await runTwopass(b64);
    } catch (e) {
      twopass = { ok: false, error: e.message, ms: null, fields: null };
    }
    const row = {
      name: p.name,
      schema: {
        ok: schema.ok,
        ms: schema.ms,
        score: score(schema.fields),
        error: schema.error || null,
        fields: schema.fields,
      },
      twopass: {
        ok: twopass.ok,
        ms: twopass.ms,
        score: score(twopass.fields),
        error: twopass.error || null,
        free_text: twopass.free_text || null,
        fields: twopass.fields,
      },
      richer:
        score(schema.fields) === score(twopass.fields)
          ? 'tie'
          : score(twopass.fields) > score(schema.fields)
            ? 'twopass'
            : 'schema',
    };
    out.photos.push(row);
    console.log(
      p.name,
      'schema',
      row.schema.score,
      (row.schema.ms / 1000).toFixed(1) + 's',
      '| twopass',
      row.twopass.score,
      row.twopass.ms != null ? (row.twopass.ms / 1000).toFixed(1) + 's' : 'fail',
      '| richer:',
      row.richer
    );
  }
  const outPath = path.join(ROOT, 'scripts', 'photo-pipeline-compare.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
  console.log('wrote', outPath);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
