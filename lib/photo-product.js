'use strict';

/**
 * Определение предмета на фото: одежда + аксессуары каталога.
 * garment_type сохраняется для совместимости (= нормализованный тип товара).
 * Без параллельного классификатора — те же ярлыки, что в criteria-catalog / Takprodam.
 */

const { CATEGORY_GROUPS } = require('./criteria-catalog');

function norm(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanAttr(v) {
  if (v == null) return null;
  let s = String(v).trim();
  if (!s) return null;
  s = s
    .replace(/^["'«]+|["'»]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!s || /^(null|none|unknown|n\/a|неизвестно|нет)$/i.test(s)) return null;
  return s;
}

/** Ярлыки из UI-групп + уточнения каталога (браслет, портмоне). */
function collectSupportedLabels() {
  const out = [];
  const seen = new Set();
  function add(label) {
    const n = norm(label);
    if (!n || seen.has(n)) return;
    seen.add(n);
    out.push(String(label).trim());
  }
  for (const g of CATEGORY_GROUPS) {
    for (const item of g.items || []) add(item);
  }
  // Каталог Takprodam уже ищет эти типы; в чипах «украшения» — обобщение.
  for (const extra of [
    'браслет',
    'портмоне',
    'кошелёк',
    'кошелек',
    'клатч',
    'ремешок',
    'колье',
    'серьги',
    'кольцо',
    'кулон',
    'цепочка',
  ]) {
    add(extra);
  }
  // Длинные первыми — для сканирования текста.
  out.sort((a, b) => b.length - a.length);
  return out;
}

const SUPPORTED_LABELS = collectSupportedLabels();

const ACCESSORY_RE =
  /браслет|сумк|портмон|кошель|рюкзак|ремен|ремеш|клатч|шапк|кепк|шарф|перчат|украшен|колье|серьг|кольц|кулон|подвеск|цепоч|бижут|визитниц|картхолд|кардхолд/i;

const CLOTHING_HINT_RE =
  /куртк|рубашк|футболк|плать|джинс|брюк|пальто|худи|свитер|бомбер|кроссов|ботин|юбк|шорт|пиджак|комбинезон/i;

const NO_SUBJECT_RE =
  /нет[\s\S]{0,48}(предмет|товар|вещ)|пуст(ое|ой)\s+(фото|кадр)|не\s+удалось\s+определить|ничего\s+не\s+видно|blank|empty\s+(image|photo)|no\s+(item|product|subject)/i;

const UNSUPPORTED_RE =
  /смартфон|телефон|наушник|ноутбук|монитор|планшет|еда|еду\b|машин[аы]\b|автомобил|мебель|здание|пейзаж|phone|headphones|laptop|food|car\b|furniture/i;

const UNCLEAR_RE =
  /неясн|не\s+уверен|неразборчив|размыт|плохо\s+видн|невозможно\s+определить|unclear|blurry|cannot\s+tell|unknown\s+object/i;

/** «Нет одежды» само по себе не отказ, если есть аксессуар. */
const NO_CLOTHING_ONLY_RE =
  /нет\s+одежд|не\s*(видн\w+\s+)?одежд|одежд\w+\s+нет|no\s+clothing|not\s+(wearing|a\s+garment)/i;

function matchSupportedLabel(text) {
  const t = norm(text);
  if (!t) return null;
  for (const label of SUPPORTED_LABELS) {
    const n = norm(label);
    if (t === n || t.includes(n)) return label;
  }
  // Англ. частые ярлыки → русские категории проекта.
  const en = {
    bracelet: 'браслет',
    bag: 'сумка',
    handbag: 'сумка',
    purse: 'сумка',
    wallet: 'портмоне',
    shirt: 'рубашка',
    jacket: 'куртка',
    dress: 'платье',
    jewelry: 'украшения',
    jewellery: 'украшения',
  };
  if (en[t]) return en[t];
  return null;
}

/**
 * Нормализованный тип товара для garment_type / category / поиска.
 * @returns {string|null}
 */
function resolveProductType(fields) {
  if (!fields || typeof fields !== 'object') return null;
  const fromType =
    matchSupportedLabel(fields.garment_type) ||
    matchSupportedLabel(fields.subtype) ||
    matchSupportedLabel(fields.category);
  if (fromType) return fromType;

  const desc = cleanAttr(fields.description) || '';
  const fromDesc = matchSupportedLabel(desc);
  if (fromDesc) return fromDesc;

  // Описание «серебряный браслет…» без точного matchSupported по полному тексту —
  // matchSupportedLabel already does includes on labels.
  if (ACCESSORY_RE.test(desc) && /браслет/i.test(desc)) return 'браслет';
  if (ACCESSORY_RE.test(desc) && /портмон|кошель/i.test(desc)) return 'портмоне';
  if (ACCESSORY_RE.test(desc) && /сумк/i.test(desc)) return 'сумка';

  return null;
}

/**
 * Применить нормализацию: заполняет garment_type/category из описания при пустом типе.
 * Не перезаписывает явный поддерживаемый garment_type.
 */
function applyProductTypeNormalization(fields) {
  if (!fields || typeof fields !== 'object') return fields;
  const out = Object.assign({}, fields);
  const resolved = resolveProductType(out);
  if (resolved) {
    const current = matchSupportedLabel(out.garment_type);
    if (!current) {
      out.garment_type = resolved;
    } else {
      out.garment_type = current;
    }
    out.category = out.garment_type;
  }
  return out;
}

/**
 * @returns {{
 *   ok: boolean,
 *   code: string|null,
 *   validation: string,
 *   category: string|null,
 *   garment_type: string|null,
 *   message: string|null
 * }}
 */
function validatePhotoProduct(fields) {
  if (!fields || typeof fields !== 'object') {
    return {
      ok: false,
      code: 'PHOTO_INVALID',
      validation: 'invalid_response',
      category: null,
      garment_type: null,
      message: 'Ответ анализатора пуст или некорректен.',
    };
  }

  const normalized = applyProductTypeNormalization(fields);
  const typeA = matchSupportedLabel(fields.garment_type);
  const typeB = matchSupportedLabel(fields.description);
  if (typeA && typeB && norm(typeA) !== norm(typeB)) {
    // Явное противоречие двух поддерживаемых типов.
    if (
      CLOTHING_HINT_RE.test(String(fields.garment_type || '')) &&
      ACCESSORY_RE.test(String(fields.description || ''))
    ) {
      return {
        ok: false,
        code: 'PHOTO_UNCLEAR',
        validation: 'contradictory_fields',
        category: null,
        garment_type: null,
        message: 'Не удалось однозначно определить предмет на фото.',
      };
    }
  }

  const category = resolveProductType(normalized);
  const desc = String(normalized.description || '');
  const descN = norm(desc);

  if (UNSUPPORTED_RE.test(desc) && !category) {
    return {
      ok: false,
      code: 'PHOTO_UNSUPPORTED',
      validation: 'unsupported_object',
      category: null,
      garment_type: null,
      message: 'На фото объект, который сейчас не поддерживается поиском. Опишите нужную вещь словами.',
    };
  }

  if (NO_SUBJECT_RE.test(desc) && !category) {
    return {
      ok: false,
      code: 'PHOTO_NO_SUBJECT',
      validation: 'no_subject',
      category: null,
      garment_type: null,
      message: 'Не удалось определить предмет на фото. Загрузите другое фото или опишите словами.',
    };
  }

  // «Нет одежды» + аксессуар в типе/описании → ok (после нормализации).
  if (category) {
    return {
      ok: true,
      code: null,
      validation: 'supported_product',
      category,
      garment_type: category,
      message: null,
    };
  }

  if (NO_CLOTHING_ONLY_RE.test(desc) || NO_CLOTHING_ONLY_RE.test(descN)) {
    return {
      ok: false,
      code: 'PHOTO_NO_SUBJECT',
      validation: 'no_subject',
      category: null,
      garment_type: null,
      message: 'Не удалось определить предмет на фото. Загрузите другое фото или опишите словами.',
    };
  }

  if (UNCLEAR_RE.test(desc) || (!cleanAttr(normalized.color_primary) && !cleanAttr(normalized.material) && !desc)) {
    return {
      ok: false,
      code: 'PHOTO_UNCLEAR',
      validation: 'unclear',
      category: null,
      garment_type: null,
      message: 'Не удалось определить предмет на фото. Загрузите другое фото или опишите словами.',
    };
  }

  // Цвет/материал есть, типа нет — неясный предмет, не «успех».
  return {
    ok: false,
    code: 'PHOTO_UNCLEAR',
    validation: 'unclear',
    category: null,
    garment_type: null,
    message: 'Не удалось определить предмет на фото. Загрузите другое фото или опишите словами.',
  };
}

/** Обратная совместимость имени. */
function isNoGarmentResult(fields) {
  return !validatePhotoProduct(fields).ok;
}

module.exports = {
  SUPPORTED_LABELS,
  resolveProductType,
  applyProductTypeNormalization,
  validatePhotoProduct,
  isNoGarmentResult,
  matchSupportedLabel,
  ACCESSORY_RE,
};
