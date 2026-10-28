'use strict';

/**
 * Справочники критериев UI и разбора.
 * Значения category/color совместимы с parse-query и API.
 */

const COLOR_OPTIONS = [
  { id: 'чёрный', label: 'Чёрный', swatch: '#1a1a1a' },
  { id: 'белый', label: 'Белый', swatch: '#ffffff' },
  { id: 'серый', label: 'Серый', swatch: '#8a8f8c' },
  { id: 'бежевый', label: 'Бежевый', swatch: '#d4c4a8' },
  { id: 'коричневый', label: 'Коричневый', swatch: '#6b3f2a' },
  { id: 'красный', label: 'Красный', swatch: '#c62828' },
  { id: 'бордовый', label: 'Бордовый', swatch: '#7a1f2b' },
  { id: 'розовый', label: 'Розовый', swatch: '#e89ab5' },
  { id: 'оранжевый', label: 'Оранжевый', swatch: '#e67a2e' },
  { id: 'жёлтый', label: 'Жёлтый', swatch: '#e6c84a' },
  { id: 'зелёный', label: 'Зелёный', swatch: '#2e8b57' },
  { id: 'оливковый', label: 'Оливковый', swatch: '#6b7c3a' },
  { id: 'хаки', label: 'Хаки', swatch: '#6b6b3a' },
  { id: 'голубой', label: 'Голубой', swatch: '#6eb6d9' },
  { id: 'синий', label: 'Синий', swatch: '#1e4d8c' },
  { id: 'фиолетовый', label: 'Фиолетовый', swatch: '#6a3d9a' },
  { id: 'многоцветный', label: 'Многоцветный', swatch: 'multi' },
];

const CATEGORY_GROUPS = [
  {
    id: 'outer',
    label: 'Верхняя одежда',
    items: [
      'куртка',
      'кожаная куртка',
      'бомбер',
      'косуха',
      'пуховик',
      'пальто',
      'тренч',
      'плащ',
      'парка',
      'ветровка',
      'дублёнка',
    ],
  },
  {
    id: 'tops',
    label: 'Верх',
    items: [
      'футболка',
      'лонгслив',
      'рубашка',
      'поло',
      'худи',
      'свитшот',
      'свитер',
      'джемпер',
      'кардиган',
      'жилет',
      'топ',
    ],
  },
  {
    id: 'bottoms',
    label: 'Низ',
    items: ['джинсы', 'брюки', 'карго', 'чиносы', 'шорты', 'юбка', 'спортивные брюки'],
  },
  {
    id: 'onesie',
    label: 'Цельные вещи',
    items: ['платье', 'комбинезон', 'костюм'],
  },
  {
    id: 'shoes',
    label: 'Обувь',
    items: ['кроссовки', 'кеды', 'ботинки', 'сапоги', 'туфли', 'лоферы', 'сандалии'],
  },
  {
    id: 'acc',
    label: 'Аксессуары',
    items: ['сумка', 'рюкзак', 'ремень', 'шапка', 'кепка', 'шарф', 'перчатки', 'украшения'],
  },
];

/** Буквенные размеры (не «европейская система» как ярлык). */
const SIZE_LETTER_OPTIONS = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];

/**
 * Числовые варианты по смыслу категории (без автоконвертации систем).
 * Общий список — для панели, когда категория неизвестна.
 */
const SIZE_NUMERIC_OPTIONS = {
  general: ['40', '42', '44', '46', '48', '50', '52', '54'],
  shoes: ['36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46'],
  jeans: ['28', '29', '30', '31', '32', '33', '34', '36', '38'],
};

/** Совместимый плоский список (история / старый UI). */
const SIZE_OPTIONS = [
  ...SIZE_LETTER_OPTIONS,
  ...SIZE_NUMERIC_OPTIONS.general,
];

function isLetterSize(v) {
  return SIZE_LETTER_OPTIONS.includes(String(v || '').toUpperCase());
}

function isNumericSize(v) {
  return /^\d{2,3}$/.test(String(v || ''));
}

const FEATURE_OPTIONS = {
  material: {
    label: 'Материал',
    values: ['кожа', 'замша', 'деним', 'хлопок', 'шерсть', 'лён', 'шёлк', 'синтетика', 'пух'],
  },
  style: {
    label: 'Стиль',
    values: ['винтаж', 'классика', 'спортивный', 'oversize', 'минимализм', 'уличный'],
  },
  fit: {
    label: 'Посадка',
    values: ['slim', 'regular', 'oversize', 'свободный', 'приталенный'],
  },
  condition: {
    label: 'Состояние',
    values: ['новое', 'как новое', 'хорошее', 'винтаж', 'б/у'],
  },
};

/** Категории для extractCategory: более длинные формулировки раньше коротких. */
function wordStem(word) {
  const w = String(word || '')
    .toLowerCase()
    .replace(/ё/g, 'е');
  if (w.length <= 4) return w;
  // грубая основа для падежей: куртка/куртку/куртки → куртк
  return w.replace(/(ами|ями|ов|ев|ей|ом|ем|ой|ый|ая|ое|ые|ую|ию|ии|ие|ья|ье|ью|и|ы|а|у|е|о|й)$/i, '');
}

function flatCategoriesForParser() {
  const pairs = [];
  for (const g of CATEGORY_GROUPS) {
    for (const name of g.items) {
      const stems = [name];
      if (name.includes(' ')) {
        // Многословные: фраза целиком + частые словоформы падежей для «кожаная куртка»
        stems.push(
          name.replace(/ая\s+/, 'ую ').replace(/а$/, 'у'),
          name.replace(/ая\s+/, 'ой ').replace(/а$/, 'и')
        );
      } else {
        stems.push(wordStem(name));
      }
      pairs.push([name, stems.filter(Boolean)]);
    }
  }
  const extra = {
    куртка: ['куртк', 'jacket'],
    бомбер: ['бомбер', 'bomber'],
    пальто: ['coat'],
    плащ: ['плащ', 'raincoat'],
    тренч: ['trench'],
    джинсы: ['джинс', 'jeans'],
    брюки: ['брюк', 'pants', 'trousers', 'штаны'],
    худи: ['hoodi'],
    свитер: ['sweater'],
    свитшот: ['sweatshirt'],
    рубашка: ['рубашк', 'shirt'],
    футболка: ['футболк', 't-shirt', 'tee'],
    платье: ['плать', 'dress'],
    юбка: ['юбк', 'skirt'],
    костюм: ['suit'],
    кроссовки: ['кроссовк', 'sneakers'],
    ботинки: ['ботинк', 'boots'],
    сумка: ['сумк', 'bag'],
    жилет: ['vest'],
    косуха: ['косух'],
    пуховик: ['пуховик'],
    парка: ['парк'],
    ветровка: ['ветровк'],
    дублёнка: ['дубленк', 'дублёнк'],
    лонгслив: ['лонгслив'],
    поло: ['polo'],
    джемпер: ['джемпер'],
    кардиган: ['кардиган'],
    комбинезон: ['комбинезон'],
    кеды: ['кед'],
    сапоги: ['сапог'],
    туфли: ['туфл'],
    лоферы: ['лофер'],
    сандалии: ['сандал'],
  };
  for (const [name, more] of Object.entries(extra)) {
    const row = pairs.find((p) => p[0] === name);
    if (row) {
      for (const m of more) if (!row[1].includes(m)) row[1].push(m);
    }
  }
  pairs.sort((a, b) => b[0].length - a[0].length);
  return pairs;
}

module.exports = {
  COLOR_OPTIONS,
  CATEGORY_GROUPS,
  SIZE_OPTIONS,
  SIZE_LETTER_OPTIONS,
  SIZE_NUMERIC_OPTIONS,
  FEATURE_OPTIONS,
  isLetterSize,
  isNumericSize,
  flatCategoriesForParser,
};
