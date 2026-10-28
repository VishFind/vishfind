'use strict';

/**
 * Валидация тела POST /api/search (серверная, до parse/Ollama/внешних API).
 * Не контент-политика: только типы, длина, пустота.
 *
 * Длина query: String.prototype.length после trim (UTF-16 code units) —
 * то же правило, что maxlength=300 на клиенте.
 */

const MAX_QUERY_LEN = 300;

function isPlainObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

function attributesHaveContent(attrs) {
  if (!isPlainObject(attrs)) return false;
  const a = attrs;
  if (Array.isArray(a.categories) && a.categories.length) return true;
  if (Array.isArray(a.colors) && a.colors.length) return true;
  if (Array.isArray(a.sizes) && a.sizes.length) return true;
  if (Array.isArray(a.brands) && a.brands.length) return true;
  if (Array.isArray(a.features) && a.features.length) return true;
  if (a.category != null && String(a.category).trim() !== '') return true;
  if (a.color != null && String(a.color).trim() !== '') return true;
  if (a.size != null && String(a.size).trim() !== '') return true;
  if (a.brand != null && String(a.brand).trim() !== '') return true;
  if (a.rest != null && String(a.rest).trim() !== '') return true;
  if (a.budget_min != null && a.budget_min !== '') return true;
  if (a.budget_max != null && a.budget_max !== '') return true;
  if (a.budget != null && a.budget !== '') return true;
  return false;
}

/**
 * @param {*} body — результат JSON.parse
 * @param {{ aiEnabled?: boolean }} opts
 * @returns {{ ok: true, value: object } | { ok: false, status: number, error: string, error_kind: string }}
 */
function validateSearchBody(body, opts) {
  const aiEnabled = !!(opts && opts.aiEnabled);

  if (!isPlainObject(body)) {
    return {
      ok: false,
      status: 400,
      error: 'Некорректный JSON',
      error_kind: 'invalid_body',
    };
  }

  if (Object.prototype.hasOwnProperty.call(body, 'query') && body.query != null) {
    if (typeof body.query !== 'string') {
      return {
        ok: false,
        status: 400,
        error: 'Поле query должно быть строкой',
        error_kind: 'invalid_query_type',
      };
    }
  }
  const query = typeof body.query === 'string' ? body.query.trim() : '';
  if (query.length > MAX_QUERY_LEN) {
    return {
      ok: false,
      status: 400,
      error: 'Запрос слишком длинный (максимум 300 символов)',
      error_kind: 'query_too_long',
    };
  }

  if (Object.prototype.hasOwnProperty.call(body, 'image') && body.image != null) {
    if (typeof body.image !== 'string') {
      return {
        ok: false,
        status: 400,
        error: 'Поле image должно быть строкой',
        error_kind: 'invalid_image_type',
      };
    }
  }
  const imageRaw = typeof body.image === 'string' ? body.image : '';
  const image = imageRaw
    ? imageRaw.replace(/^data:image\/[\w+.-]+;base64,/, '')
    : '';

  if (Object.prototype.hasOwnProperty.call(body, 'attributes') && body.attributes != null) {
    if (!isPlainObject(body.attributes)) {
      return {
        ok: false,
        status: 400,
        error: 'Поле attributes должно быть объектом',
        error_kind: 'invalid_attributes_type',
      };
    }
  }
  const attrs = isPlainObject(body.attributes) ? body.attributes : null;

  if (
    Object.prototype.hasOwnProperty.call(body, 'attributes_priority')
    && body.attributes_priority != null
  ) {
    if (typeof body.attributes_priority !== 'boolean') {
      return {
        ok: false,
        status: 400,
        error: 'Поле attributes_priority должно быть boolean',
        error_kind: 'invalid_attributes_priority_type',
      };
    }
  }
  const attrsOnly = !!(attrs && body.attributes_priority === true);

  if (
    Object.prototype.hasOwnProperty.call(body, 'clear_attributes')
    && body.clear_attributes != null
  ) {
    if (!Array.isArray(body.clear_attributes)) {
      return {
        ok: false,
        status: 400,
        error: 'Поле clear_attributes должно быть массивом',
        error_kind: 'invalid_clear_attributes_type',
      };
    }
    for (const item of body.clear_attributes) {
      if (typeof item !== 'string') {
        return {
          ok: false,
          status: 400,
          error: 'Элементы clear_attributes должны быть строками',
          error_kind: 'invalid_clear_attributes_type',
        };
      }
    }
  }
  const clearAttributes = Array.isArray(body.clear_attributes)
    ? body.clear_attributes.slice()
    : [];

  if (Object.prototype.hasOwnProperty.call(body, 'web_search') && body.web_search != null) {
    if (typeof body.web_search !== 'boolean') {
      return {
        ok: false,
        status: 400,
        error: 'Поле web_search должно быть boolean',
        error_kind: 'invalid_web_search_type',
      };
    }
  }
  const webSearch = body.web_search === true;

  const hasMeaningfulAttrs = attributesHaveContent(attrs) || clearAttributes.length > 0;
  if (!query && !image && !hasMeaningfulAttrs) {
    return {
      ok: false,
      status: 400,
      error: aiEnabled
        ? 'Введите текстовый запрос или приложите фото'
        : 'Введите текстовый запрос',
      error_kind: 'empty_query',
    };
  }

  return {
    ok: true,
    value: {
      query,
      image,
      attrs,
      attrsOnly,
      clearAttributes,
      webSearch,
    },
  };
}

module.exports = {
  MAX_QUERY_LEN,
  isPlainObject,
  attributesHaveContent,
  validateSearchBody,
};
