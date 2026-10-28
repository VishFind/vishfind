'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/** @type {Array<object>} */
const brands = [
  { id: 'nike', name: 'Nike', aliases: ['Nike', 'Найк'], domain: 'www.nike.com', categories: ['sport', 'sneakers'], related: ['jordan'] },
  { id: 'jordan', name: 'Jordan', aliases: ['Jordan', 'Air Jordan', 'Джордан'], domain: 'www.nike.com', categories: ['sport', 'sneakers'], related: ['nike'], note: 'Линейка Nike' },
  { id: 'adidas', name: 'adidas', aliases: ['Adidas', 'adidas', 'Адидас'], domain: 'www.adidas.com', categories: ['sport', 'sneakers'] },
  { id: 'puma', name: 'Puma', aliases: ['Puma', 'Пума'], domain: 'www.puma.com', categories: ['sport'] },
  { id: 'new_balance', name: 'New Balance', aliases: ['New Balance', 'NB'], domain: 'www.newbalance.com', categories: ['sport', 'sneakers'] },
  { id: 'asics', name: 'ASICS', aliases: ['ASICS', 'Asics', 'Асикс'], domain: 'www.asics.com', categories: ['sport', 'sneakers'] },
  { id: 'reebok', name: 'Reebok', aliases: ['Reebok', 'Рибок'], domain: 'www.reebok.com', categories: ['sport'] },
  { id: 'converse', name: 'Converse', aliases: ['Converse', 'Конверс'], domain: 'www.converse.com', categories: ['sneakers'] },
  { id: 'vans', name: 'Vans', aliases: ['Vans', 'Ванс'], domain: 'www.vans.com', categories: ['sneakers'] },
  { id: 'salomon', name: 'Salomon', aliases: ['Salomon', 'Саломон'], domain: 'www.salomon.com', categories: ['outdoor', 'sneakers'] },
  { id: 'the_north_face', name: 'The North Face', aliases: ['The North Face', 'TNF', 'Норт Фейс'], domain: 'www.thenorthface.com', categories: ['outdoor'] },
  { id: 'arcteryx', name: "Arc'teryx", aliases: ["Arc'teryx", 'Arcteryx', 'Арктирикс'], domain: 'arcteryx.com', categories: ['outdoor'] },
  { id: 'columbia', name: 'Columbia', aliases: ['Columbia', 'Коламбия'], domain: 'www.columbia.com', categories: ['outdoor'] },
  { id: 'patagonia', name: 'Patagonia', aliases: ['Patagonia', 'Патагония'], domain: 'www.patagonia.com', categories: ['outdoor'] },
  { id: 'on', name: 'On', aliases: ['On', 'On Running'], domain: 'www.on.com', categories: ['sport', 'sneakers'] },
  { id: 'mizuno', name: 'Mizuno', aliases: ['Mizuno', 'Мизуно'], domain: 'www.mizuno.com', categories: ['sport'] },
  { id: 'hoka', name: 'Hoka', aliases: ['Hoka', 'HOKA', 'Hoka One One'], domain: 'www.hoka.com', categories: ['sport', 'sneakers'] },
  { id: 'under_armour', name: 'Under Armour', aliases: ['Under Armour', 'UA'], domain: 'www.underarmour.com', categories: ['sport'] },
  { id: 'stone_island', name: 'Stone Island', aliases: ['Stone Island', 'Стоун Айленд'], domain: 'www.stoneisland.com', categories: ['streetwear'] },
  { id: 'cp_company', name: 'C.P. Company', aliases: ['C.P. Company', 'CP Company', 'C.P.Company'], domain: 'www.cpcompany.com', categories: ['streetwear'] },
  { id: 'carhartt_wip', name: 'Carhartt WIP', aliases: ['Carhartt WIP', 'Carhartt', 'Кархарт'], domain: 'www.carhartt-wip.com', categories: ['streetwear', 'workwear'] },
  { id: 'dickies', name: 'Dickies', aliases: ['Dickies', 'Диккис'], domain: 'www.dickies.com', categories: ['workwear'] },
  { id: 'stussy', name: 'Stüssy', aliases: ['Stüssy', 'Stussy', 'Стусси'], domain: 'www.stussy.com', categories: ['streetwear'] },
  { id: 'supreme', name: 'Supreme', aliases: ['Supreme', 'Суприм'], domain: null, categories: ['streetwear'], domain_note: 'Официальный домен витрины не закреплён в этой проверке' },
  { id: 'palace', name: 'Palace', aliases: ['Palace', 'Palace Skateboards'], domain: 'www.palaceskateboards.com', categories: ['streetwear'] },
  { id: 'bape', name: 'A Bathing Ape', aliases: ['A Bathing Ape', 'BAPE', 'Bape'], domain: 'www.bape.com', categories: ['streetwear'] },
  { id: 'fear_of_god', name: 'Fear of God', aliases: ['Fear of God', 'FOG'], domain: 'fearofgod.com', categories: ['streetwear'], related: ['essentials'] },
  { id: 'essentials', name: 'Essentials', aliases: ['Essentials', 'Fear of God Essentials'], domain: 'fearofgod.com', categories: ['streetwear'], related: ['fear_of_god'], note: 'Линейка Fear of God' },
  { id: 'represent', name: 'Represent', aliases: ['Represent'], domain: 'www.representclo.com', categories: ['streetwear'] },
  { id: 'corteiz', name: 'Corteiz', aliases: ['Corteiz', 'CRTZ'], domain: null, categories: ['streetwear'], domain_note: 'кандидат' },
  { id: 'off_white', name: 'Off-White', aliases: ['Off-White', 'Off White', 'Офф Вайт'], domain: 'www.off---white.com', categories: ['streetwear', 'designer'] },
  { id: 'palm_angels', name: 'Palm Angels', aliases: ['Palm Angels'], domain: 'www.palmangels.com', categories: ['streetwear', 'designer'] },
  { id: 'louis_vuitton', name: 'Louis Vuitton', aliases: ['Louis Vuitton', 'LV', 'Луи Виттон'], domain: 'www.louisvuitton.com', categories: ['luxury'] },
  { id: 'dior', name: 'Dior', aliases: ['Dior', 'Christian Dior', 'Диор'], domain: 'www.dior.com', categories: ['luxury'] },
  { id: 'gucci', name: 'Gucci', aliases: ['Gucci', 'Гуччи'], domain: 'www.gucci.com', categories: ['luxury'] },
  { id: 'prada', name: 'Prada', aliases: ['Prada', 'Прада'], domain: 'www.prada.com', categories: ['luxury'] },
  { id: 'balenciaga', name: 'Balenciaga', aliases: ['Balenciaga', 'Баленсиага'], domain: 'www.balenciaga.com', categories: ['luxury'] },
  { id: 'saint_laurent', name: 'Saint Laurent', aliases: ['Saint Laurent', 'YSL', 'Yves Saint Laurent'], domain: 'www.ysl.com', categories: ['luxury'] },
  { id: 'givenchy', name: 'Givenchy', aliases: ['Givenchy', 'Живанши'], domain: 'www.givenchy.com', categories: ['luxury'] },
  { id: 'burberry', name: 'Burberry', aliases: ['Burberry', 'Барберри'], domain: 'www.burberry.com', categories: ['luxury'] },
  { id: 'versace', name: 'Versace', aliases: ['Versace', 'Версаче'], domain: 'www.versace.com', categories: ['luxury'] },
  { id: 'moncler', name: 'Moncler', aliases: ['Moncler', 'Монклер'], domain: 'www.moncler.com', categories: ['luxury'] },
  { id: 'amiri', name: 'AMIRI', aliases: ['AMIRI', 'Amiri'], domain: 'www.amiri.com', categories: ['luxury', 'designer'] },
  { id: 'rick_owens', name: 'Rick Owens', aliases: ['Rick Owens', 'Рик Оуэнс'], domain: 'www.rickowens.eu', categories: ['designer'] },
  { id: 'maison_margiela', name: 'Maison Margiela', aliases: ['Maison Margiela', 'Margiela', 'MM6'], domain: 'www.maisonmargiela.com', categories: ['designer'] },
  { id: 'chrome_hearts', name: 'Chrome Hearts', aliases: ['Chrome Hearts'], domain: null, categories: ['luxury'], domain_note: 'кандидат' },
  { id: 'acne_studios', name: 'Acne Studios', aliases: ['Acne Studios', 'Acne'], domain: 'www.acnestudios.com', categories: ['designer'] },
  { id: 'alexander_mcqueen', name: 'Alexander McQueen', aliases: ['Alexander McQueen', 'McQueen'], domain: 'www.alexandermcqueen.com', categories: ['luxury'] },
  { id: 'comme_des_garcons', name: 'Comme des Garçons', aliases: ['Comme des Garçons', 'Comme des Garcons', 'CDG'], domain: 'www.comme-des-garcons.com', categories: ['designer'] },
  { id: 'kenzo', name: 'Kenzo', aliases: ['Kenzo', 'Кензо'], domain: 'www.kenzo.com', categories: ['designer'] },
  { id: 'diesel', name: 'Diesel', aliases: ['Diesel', 'Дизель'], domain: 'www.diesel.com', categories: ['denim', 'casual'] },
  { id: 'levis', name: "Levi's", aliases: ["Levi's", 'Levis', 'Левайс'], domain: 'www.levi.com', categories: ['denim'] },
  { id: 'lee', name: 'Lee', aliases: ['Lee'], domain: 'www.lee.com', categories: ['denim'] },
  { id: 'wrangler', name: 'Wrangler', aliases: ['Wrangler'], domain: 'www.wrangler.com', categories: ['denim'] },
  { id: 'polo_ralph_lauren', name: 'Polo Ralph Lauren', aliases: ['Polo Ralph Lauren', 'Ralph Lauren', 'Polo'], domain: 'www.ralphlauren.com', categories: ['casual'] },
  { id: 'lacoste', name: 'Lacoste', aliases: ['Lacoste', 'Лакост'], domain: 'www.lacoste.com', categories: ['casual'] },
  { id: 'tommy_hilfiger', name: 'Tommy Hilfiger', aliases: ['Tommy Hilfiger', 'Tommy'], domain: 'www.tommy.com', categories: ['casual'] },
  { id: 'calvin_klein', name: 'Calvin Klein', aliases: ['Calvin Klein', 'CK'], domain: 'www.calvinklein.com', categories: ['casual'] },
  { id: 'fred_perry', name: 'Fred Perry', aliases: ['Fred Perry'], domain: 'www.fredperry.com', categories: ['casual'] },
  { id: 'g_star', name: 'G-Star RAW', aliases: ['G-Star RAW', 'G-Star', 'G Star'], domain: 'www.g-star.com', categories: ['denim'] },
  { id: 'gosha', name: 'Gosha Rubchinskiy', aliases: ['Gosha Rubchinskiy', 'Гоша Рубчинский', 'Gosha'], domain: null, categories: ['streetwear', 'ru'], domain_note: 'кандидат' },
  { id: 'rassvet', name: 'Rassvet', aliases: ['Rassvet', 'Рассвет'], domain: null, categories: ['streetwear', 'ru'], domain_note: 'кандидат' },
  { id: 'volchok', name: 'Volchok', aliases: ['Volchok', 'Волчок'], domain: null, categories: ['streetwear', 'ru'], domain_note: 'кандидат' },
  { id: 'sputnik1985', name: 'СПУТНИК1985', aliases: ['СПУТНИК1985', 'Sputnik1985', 'Sputnik 1985'], domain: null, categories: ['streetwear', 'ru'], domain_note: 'кандидат' },
  { id: 'anteater', name: 'Anteater', aliases: ['Anteater'], domain: null, categories: ['streetwear', 'ru'], domain_note: 'кандидат' },
  { id: 'outlaw', name: 'Outlaw Moscow', aliases: ['Outlaw Moscow', 'Outlaw'], domain: null, categories: ['streetwear', 'ru'], domain_note: 'кандидат' },
  { id: 'zny', name: 'ZNY', aliases: ['ZNY'], domain: null, categories: ['streetwear', 'ru'], domain_note: 'кандидат' },
  { id: 'shu', name: 'SHU', aliases: ['SHU'], domain: null, categories: ['casual', 'ru'], domain_note: 'кандидат' },
  { id: 'krakatau', name: 'Krakatau', aliases: ['Krakatau', 'Кракау'], domain: null, categories: ['outdoor', 'ru'], domain_note: 'кандидат' },
  { id: 'sela', name: 'Sela', aliases: ['Sela', 'Села'], domain: 'www.sela.ru', categories: ['casual', 'ru'] },
  { id: 'befree', name: 'Befree', aliases: ['Befree', 'Бифри'], domain: 'www.befree.ru', categories: ['casual', 'ru'] },
  { id: 'lime', name: 'LIMÉ', aliases: ['LIMÉ', 'LIME', 'Lime', 'Лайм'], domain: 'limestore.com', categories: ['casual', 'own_brand'], note: 'Собственный бренд магазина LIMÉ' },
  { id: 'maag', name: 'MAAG', aliases: ['MAAG', 'Мааг'], domain: 'maag-fashion.com', categories: ['casual', 'own_brand'], note: 'Собственный бренд магазина MAAG' },
];

const checked = '2026-10-27';
const out = {
  version: 1,
  note: 'Уникальные бренды аудитории VishFind. domain=null если не подтверждён. Магазин ≠ бренд.',
  brands: brands.map((b) => ({
    id: b.id,
    name: b.name,
    aliases: b.aliases,
    domain: b.domain || null,
    categories: b.categories || [],
    related: b.related || [],
    note: b.note || null,
    status: b.domain ? 'identity_checked' : 'candidate',
    checked_at: b.domain ? checked : null,
    identification_basis: b.domain
      ? 'Публичный официальный домен / общеизвестная идентичность бренда'
      : b.domain_note || 'Домен не подтверждён в этой итерации',
  })),
};

fs.writeFileSync(path.join(ROOT, 'data/brand-registry.json'), JSON.stringify(out, null, 2));

const aliases = [];
const seen = new Set();
for (const b of out.brands) {
  for (const a of b.aliases) {
    const k = String(a).toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    aliases.push(a);
  }
}
// Длинные алиасы раньше — для extractBrand
aliases.sort((a, b) => b.length - a.length);
fs.writeFileSync(path.join(ROOT, 'data/brands.json'), JSON.stringify(aliases, null, 2));
console.log('unique_brands=' + out.brands.length + ' aliases=' + aliases.length);
