/**
 * Чистая логика таблицы сравнения (без DOM).
 * UMD: Node tests + browser (window.VishFindCompare).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.VishFindCompare = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function nonempty(v) {
    if (v == null) return false;
    var s = String(v).trim();
    return s !== '' && !/^нет данных$/i.test(s);
  }

  function cellValue(v) {
    return nonempty(v) ? String(v).trim() : 'Нет данных';
  }

  function knownEqual(a, b) {
    if (!nonempty(a) || !nonempty(b)) return false;
    return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
  }

  function knownDiffer(a, b) {
    if (!nonempty(a) || !nonempty(b)) return false;
    return String(a).trim().toLowerCase() !== String(b).trim().toLowerCase();
  }

  function comparablePriceLabel(item) {
    var mode = String((item && item.price_mode) || '');
    var code = String((item && item.currency) || '').toUpperCase();
    if (mode === 'clarify' || mode === 'raw_unspecified_currency' || !code) {
      return { label: 'Уточнить цену', comparable: false, raw: null, currency: '' };
    }
    var n = Number(item && item.price);
    if (!Number.isFinite(n)) {
      return { label: 'Уточнить цену', comparable: false, raw: null, currency: code };
    }
    return { label: null, comparable: true, raw: n, currency: code };
  }

  function buildCompareSpec(items) {
    var list = Array.isArray(items) ? items.slice(0, 3) : [];
    var baseKeys = [
      { key: 'marketplace', label: 'Магазин', get: function (it) { return it.marketplace || it.source; } },
      { key: 'category', label: 'Категория', get: function (it) { return it.category; } },
      { key: 'brand', label: 'Бренд', get: function (it) { return it.brand; } },
      { key: 'color', label: 'Цвет', get: function (it) { return it.color; } },
      { key: 'size', label: 'Размер', get: function (it) { return it.size; } },
      { key: 'condition', label: 'Состояние', get: function (it) { return it.condition; } },
    ];

    var rows = baseKeys.map(function (spec) {
      var knownVals = list.map(function (it) { return spec.get(it); });
      var values = knownVals.map(cellValue);
      var anyKnown = knownVals.some(nonempty);
      var differs = false;
      var i;
      var j;
      for (i = 0; i < knownVals.length; i++) {
        for (j = i + 1; j < knownVals.length; j++) {
          if (knownDiffer(knownVals[i], knownVals[j])) differs = true;
        }
      }
      var origins = list.map(function (it) {
        var notes = Array.isArray(it && it.match_notes) ? it.match_notes : [];
        var hit = notes.find(function (n) {
          return n && (n.field === spec.key || n.label === spec.label);
        });
        return hit && hit.basis ? String(hit.basis) : null;
      });
      return {
        key: spec.key,
        label: spec.label,
        values: values,
        origins: origins,
        differs: differs,
        allUnknown: !anyKnown,
      };
    });

    return { items: list, rows: rows };
  }

  function filterDiffRows(spec, diffsOnly) {
    if (!diffsOnly) return spec.rows.slice();
    return spec.rows.filter(function (row) { return row.differs; });
  }

  function canShowDetailedDiffs(rows) {
    return rows.some(function (row) { return row.differs; });
  }

  return {
    nonempty: nonempty,
    cellValue: cellValue,
    knownEqual: knownEqual,
    knownDiffer: knownDiffer,
    comparablePriceLabel: comparablePriceLabel,
    buildCompareSpec: buildCompareSpec,
    filterDiffRows: filterDiffRows,
    canShowDetailedDiffs: canShowDetailedDiffs,
  };
});
