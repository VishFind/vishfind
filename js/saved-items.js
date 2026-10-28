/**
 * Избранное VishFind: нормализация, миграция старых записей, безопасная работа с storage.
 * UMD: браузер (window.VishFindSaved) и Node (module.exports) для тестов.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.VishFindSaved = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SAVED_KEY = 'vishfind-saved';
  var MIGRATION_FLAG = 'vishfind-saved-migrated-v1';

  function isObject(v) {
    return v != null && typeof v === 'object' && !Array.isArray(v);
  }

  function safeStr(v) {
    return v == null ? '' : String(v);
  }

  function looksLikeMarketplaceName(name) {
    var n = safeStr(name).trim().toLowerCase();
    if (!n) return false;
    return /^(ozon|wildberries|wb|яндекс(\s*маркет)?|yandex(\s*market)?|avito|lamoda|zara|ebay|vestiaire|demo)$/i.test(n);
  }

  function capitalize(text) {
    var value = safeStr(text).trim();
    if (!value) return '';
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  function titleFromQuery(query) {
    var text = safeStr(query);
    text = text.replace(/\bдо\s+\d[\d\s\u00a0]*\s*(₽|руб\.?|р\b)?/gi, ' ');
    text = text.replace(/\bразмер\s+[a-zA-Zа-яА-ЯёЁ0-9]+/gi, ' ');
    text = text.replace(/[,;]+/g, ' ').replace(/\s+/g, ' ').trim();
    return text || safeStr(query).replace(/\s+/g, ' ').trim();
  }

  /**
   * Нормализация одной записи. Не выдумывает бренд/цвет/модель.
   * @returns {{ item: object, changed: boolean }}
   */
  function normalizeSavedItem(raw) {
    if (!isObject(raw)) return { item: null, changed: false };
    var changed = false;
    var item = Object.assign({}, raw);
    var type = safeStr(item.type || item.kind || '').toLowerCase();
    if (type === 'query' || type === 'link' || type === 'offer') {
      item.type = type;
    } else if (item.url && (item.price != null || item.is_demo != null)) {
      item.type = 'offer';
      changed = true;
    } else if (item.url) {
      item.type = 'link';
      changed = true;
    } else if (item.query) {
      item.type = 'query';
      changed = true;
    } else {
      return { item: null, changed: false };
    }

    if (!item.id) {
      item.id = 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      changed = true;
    }
    if (!item.at) {
      item.at = new Date().toISOString();
      changed = true;
    }

    if (item.type === 'query') {
      var q = safeStr(item.query).trim();
      var label = safeStr(item.item || item.title).trim();
      if (!label || looksLikeMarketplaceName(label)) {
        var next = q ? capitalize(titleFromQuery(q)) : 'Сохранённый запрос';
        if (label !== next) {
          item.item = next;
          item.title = next;
          changed = true;
        }
      } else if (!item.item) {
        item.item = label;
        changed = true;
      }
      if (!item.search_type) {
        item.search_type = 'text';
        changed = true;
      }
    } else if (item.type === 'link') {
      var place = safeStr(item.place || '').trim();
      var title = safeStr(item.title || '').trim();
      var current = safeStr(item.item || '').trim();
      if (!place && looksLikeMarketplaceName(title)) {
        place = title;
        item.place = place;
        changed = true;
      } else if (!place && looksLikeMarketplaceName(current)) {
        place = current;
        item.place = place;
        changed = true;
      }
      var query = safeStr(item.query).trim();
      var thing = current;
      if (!thing || looksLikeMarketplaceName(thing)) {
        if (query) thing = capitalize(titleFromQuery(query));
        else if (title && !looksLikeMarketplaceName(title)) thing = title;
        else thing = 'Сохранённая ссылка';
        if (safeStr(item.item) !== thing) {
          item.item = thing;
          changed = true;
        }
      }
      if (!item.title || looksLikeMarketplaceName(item.title)) {
        item.title = item.item;
        changed = true;
      }
      if (!item.url) return { item: null, changed: false };
    } else if (item.type === 'offer') {
      var offerTitle = safeStr(item.item || item.title).trim();
      if (!offerTitle || looksLikeMarketplaceName(offerTitle)) {
        offerTitle = 'Сохранённое предложение';
        item.item = offerTitle;
        item.title = offerTitle;
        item.needs_rename = true;
        changed = true;
      } else {
        if (!item.item) {
          item.item = offerTitle;
          changed = true;
        }
        if (!item.title) {
          item.title = offerTitle;
          changed = true;
        }
      }
      if (!item.place && item.source) {
        item.place = safeStr(item.source);
        changed = true;
      }
      if (item.is_demo == null) {
        item.is_demo = true;
        changed = true;
      }
    }

    return { item: item, changed: changed };
  }

  function savedSame(a, b) {
    if (!a || !b || a.type !== b.type) return false;
    if (a.type === 'query') return a.query === b.query && a.search_type === b.search_type;
    if (a.type === 'link') return a.url === b.url;
    return (
      safeStr(a.item || a.title) === safeStr(b.item || b.title) &&
      a.price === b.price &&
      safeStr(a.url) === safeStr(b.url) &&
      safeStr(a.place || a.source) === safeStr(b.place || b.source)
    );
  }

  /**
   * Идемпотентная миграция списка. Не ходит в сеть и не выдумывает вещи.
   */
  function migrateSavedList(list) {
    if (!Array.isArray(list)) return { list: [], changed: true };
    var out = [];
    var changed = false;
    for (var i = 0; i < list.length; i++) {
      var normed = normalizeSavedItem(list[i]);
      if (!normed.item) {
        changed = true;
        continue;
      }
      if (normed.changed) changed = true;
      var dup = out.find(function (row) {
        return savedSame(row, normed.item);
      });
      if (dup) {
        changed = true;
        continue;
      }
      out.push(normed.item);
    }
    return { list: out, changed: changed };
  }

  function createMemoryStorage(seed) {
    var map = Object.create(null);
    if (seed && typeof seed === 'object') {
      Object.keys(seed).forEach(function (k) {
        map[k] = String(seed[k]);
      });
    }
    return {
      getItem: function (k) {
        return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null;
      },
      setItem: function (k, v) {
        map[k] = String(v);
      },
      removeItem: function (k) {
        delete map[k];
      },
    };
  }

  /**
   * Загрузка с миграцией. storage — localStorage-совместимый адаптер.
   * @returns {{ list: object[], error: string|null, migrated: boolean }}
   */
  function loadSaved(storage, options) {
    var opts = options || {};
    var key = opts.key || SAVED_KEY;
    var flag = opts.flag || MIGRATION_FLAG;
    if (!storage || typeof storage.getItem !== 'function') {
      return { list: [], error: 'Хранилище недоступно в этом браузере.', migrated: false };
    }
    var raw;
    try {
      raw = storage.getItem(key);
    } catch (e) {
      return { list: [], error: 'Не удалось прочитать избранное.', migrated: false };
    }
    if (raw == null || raw === '') {
      return { list: [], error: null, migrated: false };
    }
    var parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      return { list: [], error: 'Избранное повреждено и не может быть прочитано.', migrated: false };
    }
    if (!Array.isArray(parsed)) {
      return { list: [], error: 'Избранное имеет неверный формат.', migrated: false };
    }
    var result = migrateSavedList(parsed);
    var already = false;
    try {
      already = storage.getItem(flag) === '1';
    } catch (_) {
      already = false;
    }
    if (result.changed) {
      var saved = writeSaved(storage, result.list, { key: key, flag: flag });
      if (saved.error) {
        return { list: result.list, error: saved.error, migrated: true };
      }
      return { list: result.list, error: null, migrated: true };
    }
    if (!already) {
      try {
        storage.setItem(flag, '1');
      } catch (_) {
        /* флаг не критичен */
      }
    }
    return { list: result.list, error: null, migrated: false };
  }

  function writeSaved(storage, list, options) {
    var opts = options || {};
    var key = opts.key || SAVED_KEY;
    var flag = opts.flag || MIGRATION_FLAG;
    if (!storage || typeof storage.setItem !== 'function') {
      return { ok: false, error: 'Хранилище недоступно в этом браузере.' };
    }
    if (!Array.isArray(list)) {
      return { ok: false, error: 'Некорректные данные избранного.' };
    }
    try {
      storage.setItem(key, JSON.stringify(list));
      storage.setItem(flag, '1');
      return { ok: true, error: null };
    } catch (e) {
      return {
        ok: false,
        error: 'Не удалось сохранить избранное. Возможно, память браузера переполнена.',
      };
    }
  }

  function renameSavedItem(list, id, newName) {
    var name = safeStr(newName).trim();
    if (!name) return { list: list, changed: false, error: 'Введите название.' };
    var out = (list || []).map(function (row) {
      if (!row || row.id !== id) return row;
      var next = Object.assign({}, row, {
        item: name,
        title: name,
        needs_rename: false,
        renamed: true,
      });
      return next;
    });
    return { list: out, changed: true, error: null };
  }

  return {
    SAVED_KEY: SAVED_KEY,
    MIGRATION_FLAG: MIGRATION_FLAG,
    looksLikeMarketplaceName: looksLikeMarketplaceName,
    titleFromQuery: titleFromQuery,
    normalizeSavedItem: normalizeSavedItem,
    migrateSavedList: migrateSavedList,
    savedSame: savedSame,
    createMemoryStorage: createMemoryStorage,
    loadSaved: loadSaved,
    writeSaved: writeSaved,
    renameSavedItem: renameSavedItem,
  };
});
