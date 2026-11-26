'use strict';

/**
 * Импорт локальных Admitad YML/XML → data/admitad-feeds/catalog.json
 * в схеме, совместимой с takprodam-catalog (выдача / need-match / сравнение).
 *
 * Источник: data/admitad-feeds/urls.local.json + raw/*.xml
 * Секреты/фиды не коммитятся (.gitignore).
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const {
  normalizeEntry,
  migrateCatalogToV2,
  SCHEMA_VERSION,
} = require('../lib/takprodam-schema');
const {
  mapRawProduct,
  validateForPublic,
  stripPrivate,
  isFashionRelevantTitle,
} = require('../lib/takprodam-catalog');

const ROOT = path.join(__dirname, '..');
const FEEDS_DIR = path.join(ROOT, 'data', 'admitad-feeds');
const MANIFEST = path.join(FEEDS_DIR, 'urls.local.json');
const OUT = path.join(FEEDS_DIR, 'catalog.json');
const MAX_PER_FEED = Number(process.env.ADMITAD_MAX_PER_FEED || 2500);
const ASSUMED_CURRENCY = 'RUB';

function tag(text, name) {
  const re = new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + name + '>', 'i');
  const m = text.match(re);
  return m ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim() : '';
}

function attr(text, name) {
  const re = new RegExp('\\b' + name + '\\s*=\\s*"([^"]*)"', 'i');
  const m = text.match(re);
  return m ? m[1] : '';
}

function firstPicture(offerXml) {
  const pics = [...offerXml.matchAll(/<picture(?:\s[^>]*)?>([\s\S]*?)<\/picture>/gi)].map((m) =>
    m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim()
  );
  return pics.find((u) => /^https?:\/\//i.test(u)) || '';
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

async function* iterOffers(filePath) {
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let buf = '';
  let inOffer = false;
  for await (const line of rl) {
    if (!inOffer) {
      const start = line.indexOf('<offer');
      if (start === -1) continue;
      inOffer = true;
      buf = line.slice(start);
      if (buf.includes('</offer>')) {
        const end = buf.indexOf('</offer>') + 8;
        yield buf.slice(0, end);
        buf = '';
        inOffer = false;
      }
      continue;
    }
    buf += '\n' + line;
    const end = buf.indexOf('</offer>');
    if (end !== -1) {
      yield buf.slice(0, end + 8);
      buf = '';
      inOffer = false;
    }
    if (buf.length > 2_000_000) {
      buf = '';
      inOffer = false;
    }
  }
}

function offerToRaw(offerXml, feed) {
  const id = attr(offerXml, 'id') || tag(offerXml, 'vendorCode') || null;
  const name = decodeEntities(tag(offerXml, 'name') || tag(offerXml, 'model'));
  const price = Number(String(tag(offerXml, 'price') || '').replace(/\s/g, '').replace(',', '.'));
  const currency = (tag(offerXml, 'currencyId') || ASSUMED_CURRENCY).toUpperCase();
  const url = decodeEntities(tag(offerXml, 'url'));
  const picture = decodeEntities(firstPicture(offerXml));
  const vendor = decodeEntities(tag(offerXml, 'vendor'));
  const categoryId = tag(offerXml, 'categoryId') || null;
  const available = attr(offerXml, 'available');
  if (available && /^false$/i.test(available)) return null;
  if (!name || !url || !picture) return null;
  if (!Number.isFinite(price)) return null;

  return {
    id: id != null ? String(id) : null,
    product_id: id != null ? String(id) : null,
    title: name,
    price,
    currency_id: currency,
    image_url: picture,
    tracking_link: url,
    external_link: url,
    legal_text: feed.legal_text,
    marketplace_title: feed.brand,
    store_title: vendor || feed.brand,
    category_title: null,
    category_id: categoryId,
  };
}

function isClothingOrFashion(title, categoryTitle) {
  if (isFashionRelevantTitle(title, categoryTitle)) return true;
  const hay = String(title || '') + ' ' + String(categoryTitle || '');
  return /плать|юбк|брюк|джинс|куртк|пальто|плащ|ветровк|пуховик|свитер|кардиган|футболк|майк|рубашк|блуз|пиджак|костюм|комбинезон|худи|толстов|свитшот|леггинс|шорт|сарафан|жилет|боди|белье|бель[её]|обув|кроссов|кед[ыа]|ботин|туфл|сапог|босонож|лофер|мокасин|слипон|одежд|верхн\w*\s+одежд|женск|мужск|детск/i.test(
    hay
  );
}

async function importFeed(feed, fetchedAt) {
  const fileRel = feed.file;
  const filePath = path.isAbsolute(fileRel) ? fileRel : path.join(FEEDS_DIR, fileRel);
  if (!fs.existsSync(filePath)) {
    return { brand: feed.brand, ok: false, error: 'file_missing', path: filePath, kept: 0 };
  }

  const kept = [];
  let seen = 0;
  let skipped = 0;
  for await (const offerXml of iterOffers(filePath)) {
    seen += 1;
    const raw = offerToRaw(offerXml, feed);
    if (!raw) {
      skipped += 1;
      continue;
    }
    if (!isClothingOrFashion(raw.title, raw.category_title)) {
      skipped += 1;
      continue;
    }
    const mapped = mapRawProduct(raw, {
      sourceId: 0,
      fetchedAt,
      assumedCurrency: ASSUMED_CURRENCY,
      assumedCurrencyBasis: 'admitad_feed_rub',
      categoryTitle: raw.category_title,
    });
    mapped.source = 'admitad';
    const entry = normalizeEntry(mapped, { marketplaceSlug: feed.brand });
    entry.provider = 'admitad';
    entry.source = 'admitad';
    entry.field_origin = {
      ...(entry.field_origin || {}),
      legal_text: 'admitad_manifest.legal_text',
      tracking_link: 'admitad_yml.offer.url',
      marketplace_title: 'admitad_manifest.brand',
    };

    // Для публичной выдачи: одежда/обувь допускаем даже если старый fashion-фильтр узкий.
    const v = validateForPublic(entry);
    const onlyFashionBlock =
      v.reasons && v.reasons.length === 1 && v.reasons[0] === 'not_fashion_relevant';
    if (!v.ok && !onlyFashionBlock) {
      skipped += 1;
      continue;
    }
    kept.push(stripPrivate(entry));
    if (kept.length >= MAX_PER_FEED) break;
  }

  return {
    brand: feed.brand,
    ok: true,
    path: filePath,
    seen,
    skipped,
    kept: kept.length,
    items: kept,
  };
}

async function main() {
  if (!fs.existsSync(MANIFEST)) {
    console.error('missing', MANIFEST);
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const feeds = Array.isArray(manifest.feeds) ? manifest.feeds : [];
  if (!feeds.length) {
    console.error('no feeds in manifest');
    process.exit(1);
  }

  const fetchedAt = new Date().toISOString();
  const all = [];
  const report = [];
  for (const feed of feeds) {
    if (!feed || !feed.file || !feed.legal_text) {
      report.push({ brand: feed && feed.brand, ok: false, error: 'incomplete_manifest' });
      continue;
    }
    console.log('import', feed.brand, '...');
    const res = await importFeed(feed, fetchedAt);
    report.push({
      brand: res.brand,
      ok: res.ok,
      error: res.error || null,
      seen: res.seen,
      skipped: res.skipped,
      kept: res.kept,
    });
    if (res.ok && res.items) all.push(...res.items);
  }

  const catalog = {
    schema_version: SCHEMA_VERSION,
    provider: 'admitad',
    source_id: 0,
    generated_at: fetchedAt,
    fetched_at: fetchedAt,
    item_count: all.length,
    items: all,
    marketplaces: {},
  };
  const migrated = migrateCatalogToV2(catalog);
  fs.mkdirSync(FEEDS_DIR, { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(migrated.catalog), 'utf8');

  console.log(JSON.stringify({ out: OUT, total: all.length, report }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
