'use strict';

/**
 * Жёсткие правила категории: не путать джинсы с джинсовой курткой и т.п.
 * Только по названию/категории источника — без выдуманных атрибутов.
 */

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/ё/g, 'е');
}

/** Группы конфликтующих типов одежды. */
// \b в JS не считает кириллицу «словом» — границы задаём явно.
const TYPE_RULES = [
  {
    ids: ['джинсы', 'брюки', 'карго', 'чиносы', 'шорты', 'спортивные брюки'],
    // Джинсы/брюки: «джинсовая куртка» содержит «джинс», но это не штаны.
    accept: [
      /(?:^|[^а-яa-z0-9])джинсы?(?:[^а-яa-z0-9]|$)/,
      /(?:^|[^а-яa-z0-9])джинс[аоуые](?:[^а-яa-z0-9]|$)/,
      /(?:^|[^a-z0-9])jeans?(?:[^a-z0-9]|$)/,
      /брюк/,
      /штаны?/,
      /trousers?/,
      /(?:^|[^a-z0-9])pants?(?:[^a-z0-9]|$)/,
      /карго/,
      /чинос/,
      /шорт/,
    ],
    reject: [/куртк/, /jacket/, /бомбер/, /парка/, /ветровк/, /пуховик/, /плащ/, /тренч/, /пальто/],
  },
  {
    ids: ['куртка', 'кожаная куртка', 'бомбер', 'ветровка', 'парка', 'пуховик', 'косуха'],
    accept: [/куртк/, /jacket/, /бомбер/, /парка/, /ветровк/, /пуховик/, /косух/, /тренч/, /плащ/],
    reject: [/(?:^|[^а-яa-z0-9])джинсы?(?:[^а-яa-z0-9]|$)/, /брюк/, /штаны?/, /шорт/],
  },
  {
    ids: ['сумка', 'рюкзак', 'портфель', 'клатч'],
    accept: [/сумк/, /рюкзак/, /портфел/, /клатч/, /(?:^|[^a-z0-9])bag(?:[^a-z0-9]|$)/, /backpack/],
    reject: [/куртк/, /(?:^|[^а-яa-z0-9])джинсы?(?:[^а-яa-z0-9]|$)/, /брюк/, /ботинк/, /кроссовк/],
  },
  {
    ids: ['футболка', 'рубашка', 'худи', 'свитшот', 'лонгслив', 'поло'],
    accept: [/футболк/, /рубашк/, /худи/, /свитшот/, /лонгслив/, /(?:^|[^а-яa-z0-9])поло(?:[^а-яa-z0-9]|$)/, /t-?shirt/, /hoodie/],
    reject: [/куртк/, /пуховик/, /ботинк/, /сапог/],
  },
];

function ruleForCategory(category) {
  const c = norm(category);
  if (!c) return null;
  for (const rule of TYPE_RULES) {
    if (rule.ids.some((id) => c === norm(id) || c.includes(norm(id)))) return rule;
  }
  return null;
}

/**
 * true = товар подходит под запрошенную категорию.
 * Если категория неизвестна правилам — не блокируем.
 */
function titleFitsCategory(wantedCategory, title, categoryTitle) {
  const rule = ruleForCategory(wantedCategory);
  if (!rule) return true;
  const hay = norm(title) + ' ' + norm(categoryTitle);
  if (rule.reject.some((re) => re.test(hay))) return false;
  if (!rule.accept.length) return true;
  return rule.accept.some((re) => re.test(hay));
}

/**
 * Уточнение текстового токена «джинс» / категории: не матчить джинсовую куртку как джинсы.
 */
function tokenMatchesTitle(token, title, wantedCategory) {
  const t = norm(token);
  const hay = norm(title);
  if (!t || !hay) return false;

  if (t === 'джинс' || t === 'jeans' || t === 'джинсы') {
    if (/куртк|jacket|бомбер|парка|ветровк|пуховик/.test(hay)) return false;
    return (
      /(?:^|[^а-яa-z0-9])джинсы?(?:[^а-яa-z0-9]|$)/.test(hay) ||
      /(?:^|[^а-яa-z0-9])джинс[аоуые](?:[^а-яa-z0-9]|$)/.test(hay) ||
      /(?:^|[^a-z0-9])jeans?(?:[^a-z0-9]|$)/.test(hay)
    );
  }

  if (wantedCategory && !titleFitsCategory(wantedCategory, title, '')) {
    // Токен категории при конфликте типа — не засчитываем.
    const rule = ruleForCategory(wantedCategory);
    if (rule && rule.ids.some((id) => norm(id).includes(t) || t.includes(wordStem(id)))) {
      return false;
    }
  }

  return hay.includes(t);
}

function wordStem(word) {
  const w = norm(word);
  if (w.length <= 4) return w;
  return w.replace(/(ами|ями|ов|ев|ей|ом|ем|ой|ый|ая|ое|ые|ую|ию|ии|ие|ья|ье|ью|и|ы|а|у|е|о|й)$/i, '');
}

module.exports = {
  titleFitsCategory,
  tokenMatchesTitle,
  ruleForCategory,
};
