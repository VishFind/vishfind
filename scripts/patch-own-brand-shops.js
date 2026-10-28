'use strict';

/**
 * Расширение реестра own-brand магазинов одежды.
 * Не выдумывает search URL — только проверенные витрины.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TODAY = '2026-10-27';

const shops = [
  {
    id: 'befree',
    name: 'Befree',
    domain: 'www.befree.ru',
    brands: ['Befree', 'Бифри'],
    aliases: ['Befree', 'Бифри'],
    url: 'https://befree.ru/',
    brand_origin: 'RU',
    storefront_region: 'RU',
    note:
      'Собственный бренд Befree (Melon Fashion Group). Витрина befree.ru (200). Search URL как полный фильтр не подтверждён.',
  },
  {
    id: 'sela',
    name: 'Sela',
    domain: 'www.sela.ru',
    brands: ['Sela', 'Села'],
    aliases: ['Sela', 'Села'],
    url: 'https://www.sela.ru/',
    brand_origin: 'RU',
    storefront_region: 'RU',
    note: 'Собственный бренд Sela. Витрина sela.ru (200). Search URL не подтверждён отдельно.',
  },
  {
    id: 'zarina',
    name: 'Zarina',
    domain: 'zarina.ru',
    brands: ['Zarina', 'Зарина'],
    aliases: ['Zarina', 'Зарина'],
    url: 'https://zarina.ru/',
    brand_origin: 'RU',
    storefront_region: 'RU',
    note: 'Собственный бренд Zarina (Melon Fashion Group). Витрина zarina.ru (200).',
  },
  {
    id: 'love_republic',
    name: 'Love Republic',
    domain: 'www.loverepublic.ru',
    brands: ['Love Republic'],
    aliases: ['Love Republic', 'Лав Репаблик'],
    url: 'https://www.loverepublic.ru/',
    brand_origin: 'RU',
    storefront_region: 'RU',
    note: 'Собственный бренд Love Republic. Витрина loverepublic.ru (200).',
  },
  {
    id: 'gloria_jeans',
    name: 'Gloria Jeans',
    domain: 'www.gloria-jeans.ru',
    brands: ['Gloria Jeans', 'Глория Джинс'],
    aliases: ['Gloria Jeans', 'Глория Джинс', 'GloriaJeans'],
    url: 'https://www.gloria-jeans.ru/',
    brand_origin: 'RU',
    storefront_region: 'RU',
    note: 'Собственный бренд Gloria Jeans. Витрина gloria-jeans.ru (200).',
  },
  {
    id: 'gate31',
    name: 'GATE31',
    domain: 'gate31.ru',
    brands: ['GATE31', 'Gate31'],
    aliases: ['GATE31', 'Gate 31', 'Gate31'],
    url: 'https://gate31.ru/',
    brand_origin: 'RU',
    storefront_region: 'RU',
    note: 'Собственный бренд GATE31. Витрина gate31.ru (200).',
  },
  {
    id: 'krakatau',
    name: 'Krakatau',
    domain: 'krakatau.ru',
    brands: ['Krakatau', 'Кракау'],
    aliases: ['Krakatau', 'Кракау'],
    url: 'https://krakatau.ru/',
    brand_origin: 'RU',
    storefront_region: 'RU',
    note:
      'Собственный бренд Krakatau. krakatau.ru (200); krakatauwear.com также отвечает — в выдаче krakatau.ru.',
  },
  {
    id: 'ostin',
    name: "O'STIN",
    domain: 'www.ostin.com',
    brands: ["O'STIN", 'OSTIN', 'Остин'],
    aliases: ["O'STIN", 'OSTIN', 'Ostin', 'Остин'],
    url: 'https://www.ostin.com/',
    brand_origin: 'RU',
    storefront_region: 'RU',
    note:
      "Собственный бренд O'STIN. Автоматический GET вернул 401 — не доказательство запрета; переход без HTML-сбора.",
  },
  {
    id: 'storeez_12',
    name: '12 STOREEZ',
    domain: '12storeez.com',
    brands: ['12 STOREEZ', '12 Storeez'],
    aliases: ['12 STOREEZ', '12 Storeez', '12STOREEZ'],
    url: 'https://12storeez.com/',
    brand_origin: 'RU',
    storefront_region: 'RU',
    note:
      'Собственный бренд 12 STOREEZ. Автоматический доступ 403 — не юр. запрет; витрина без сбора каталога.',
  },
];

function upsertRegistry() {
  const file = path.join(ROOT, 'data/source-registry.json');
  const reg = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const sh of shops) {
    const entry = {
      id: sh.id,
      name: sh.name,
      domain: sh.domain,
      type: 'brand_official',
      region: sh.storefront_region,
      storefront_region: sh.storefront_region,
      brand_origin: sh.brand_origin,
      currency: 'RUB',
      brands: sh.brands,
      own_brand: true,
      categories: ['casual', 'own_brand'],
      delivery_to_ru: 'confirmed',
      data_mode: 'search_link',
      connection_status: 'search_link',
      trust_level: 'official_store',
      trust_basis: sh.note,
      trust_links: ['https://' + sh.domain.replace(/^www\./, '')],
      delivery_note: 'Доставка по РФ — уточнять на сайте магазина.',
      checked_at: TODAY,
      url_template: sh.url,
      link_kind: 'store_entry',
      link_label:
        'Витрина ' + sh.name + ' (поисковый URL не подтверждён как полный фильтр)',
      product_live: 'none',
      product_live_note:
        'Товарный HTML-сбор не подключён. Главная не выдаётся как поиск по всем критериям.',
      usage_policy: {
        html_product_fetch: 'basis_unset',
        outbound_link: 'basis_unset',
        images: 'basis_unset',
        note: 'Own-brand витрина; отдельного API нет.',
        checked_at: TODAY,
      },
      adapter_ref: sh.id,
    };
    const idx = reg.sources.findIndex((s) => s.id === sh.id);
    if (idx >= 0) reg.sources[idx] = { ...reg.sources[idx], ...entry };
    else reg.sources.push(entry);
  }

  // SHU — домен не подтверждён (timeout): только candidate, не в активной квоте.
  if (!reg.sources.some((s) => s.id === 'shu')) {
    reg.sources.push({
      id: 'shu',
      name: 'SHU',
      domain: null,
      type: 'brand_official',
      region: 'RU',
      storefront_region: 'RU',
      brand_origin: 'unknown',
      currency: 'RUB',
      brands: ['SHU'],
      own_brand: true,
      categories: ['casual', 'own_brand'],
      delivery_to_ru: 'unknown',
      data_mode: 'none',
      connection_status: 'candidate',
      trust_level: 'unverified',
      trust_basis: 'Кандидат: shu.ru не ответил в срок проверки; домен/витрина не активированы.',
      checked_at: TODAY,
      url_template: null,
      blocker: 'Таймаут при проверке shu.ru',
      usage_policy: {
        html_product_fetch: 'basis_unset',
        outbound_link: 'basis_unset',
        images: 'basis_unset',
        note: 'Не активирован без подтверждённого домена.',
        checked_at: TODAY,
      },
      adapter_ref: null,
    });
  }

  reg.updated_at = TODAY;
  fs.writeFileSync(file, JSON.stringify(reg, null, 2) + '\n');
  const own = reg.sources.filter(
    (s) => s.own_brand && s.connection_status === 'search_link'
  );
  console.log('registry sources', reg.sources.length, 'own_brand active', own.length);
  console.log(own.map((s) => s.id).join(', '));
}

function upsertAdapters() {
  const file = path.join(ROOT, 'data/sources.json');
  const list = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const sh of shops) {
    const entry = {
      id: sh.id,
      name: sh.name,
      type: 'official_store',
      url_template: sh.url,
      price_currency: 'RUB',
      verified: true,
      price_filter_verified: false,
      price_min_filter_verified: false,
      filter_capabilities: {
        price_min: 'manual',
        price_max: 'manual',
        size: 'in_query_only',
        color: 'in_query_only',
        brand: 'in_query_only',
        features: 'in_query_only',
      },
      verification_note: sh.note,
    };
    const idx = list.findIndex((s) => s.id === sh.id);
    if (idx >= 0) list[idx] = { ...list[idx], ...entry };
    else list.push(entry);
  }
  fs.writeFileSync(file, JSON.stringify(list, null, 2) + '\n');
  console.log('adapters', list.length);
}

function upsertBrands() {
  const file = path.join(ROOT, 'data/brand-registry.json');
  const reg = JSON.parse(fs.readFileSync(file, 'utf8'));
  const brandsFile = path.join(ROOT, 'data/brands.json');
  let aliases = [];
  try {
    aliases = JSON.parse(fs.readFileSync(brandsFile, 'utf8'));
  } catch (_) {
    aliases = [];
  }

  for (const sh of shops) {
    const entry = {
      id: sh.id,
      name: sh.name,
      aliases: sh.aliases,
      domain: sh.domain,
      categories: ['casual', 'own_brand'],
      related: [],
      note: 'Собственный бренд магазина; storefront_region=' + sh.storefront_region,
      brand_origin: sh.brand_origin,
      storefront_region: sh.storefront_region,
      status: 'identity_checked',
      checked_at: TODAY,
      identification_basis: sh.note,
    };
    const idx = (reg.brands || []).findIndex((b) => b.id === sh.id);
    if (idx >= 0) reg.brands[idx] = { ...reg.brands[idx], ...entry };
    else reg.brands.push(entry);

    for (const a of sh.aliases) {
      if (!aliases.includes(a)) aliases.push(a);
    }
  }

  // Обновить sela/befree/lime/maag/krakatau если уже есть
  fs.writeFileSync(file, JSON.stringify(reg, null, 2) + '\n');
  aliases.sort((a, b) => b.length - a.length);
  fs.writeFileSync(brandsFile, JSON.stringify(aliases, null, 2) + '\n');
  console.log('brands', reg.brands.length, 'aliases', aliases.length);
}

upsertRegistry();
upsertAdapters();
upsertBrands();
