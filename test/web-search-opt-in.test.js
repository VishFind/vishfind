'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const serverSrc = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const js = fs.readFileSync(path.join(root, 'js/search.js'), 'utf8');
const about = fs.readFileSync(path.join(root, 'about.html'), 'utf8');
const ollama = fs.readFileSync(path.join(root, 'lib/ollama-web.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('клиент: переключатель по умолчанию и payload только при opt-in', () => {
  assert.match(indexHtml, /id="opt-web-search"/);
  assert.match(indexHtml, /Дополнить поиск ссылками из интернета/);
  assert.match(indexHtml, /внешнему сервису Ollama/);
  assert.match(js, /userWantsWebSearch/);
  assert.match(js, /payload\.web_search = true/);
  assert.match(js, /webSearchServerEnabled/);
  // Без галочки флаг не ставится автоматически из-за ключа.
  assert.doesNotMatch(js, /payload\.web_search\s*=\s*webSearchServerEnabled/);
});

test('клиент: компактное пояснение под результатами', () => {
  assert.match(js, /renderResultsDisclaimer/);
  assert.match(js, /VishFind подбирает ссылки на сторонние сайты/);
  assert.match(js, /проверяйте у продавца/);
  assert.match(js, /Что распозналось/);
});

test('сервер: web enrich только при явном web_search boolean true', () => {
  // Opt-in через validateSearchBody (webSearch === true) → userWantsWeb.
  assert.match(serverSrc, /validateSearchBody/);
  assert.match(serverSrc, /userWantsWeb\s*=\s*checked\.value\.webSearch/);
  assert.match(serverSrc, /reason:\s*'user_opt_out'/);
  assert.match(serverSrc, /user_requested:\s*userWantsWeb/);
  const reqLib = fs.readFileSync(path.join(root, 'lib/search-request.js'), 'utf8');
  assert.match(reqLib, /webSearch\s*=\s*body\.web_search\s*===\s*true/);
  // В Ollama уходит урезанный объект, не полный parsed с image.
  assert.match(
    serverSrc,
    /enrichBrandSearch\(\s*\{\s*brand:[\s\S]*?search_phrase:[\s\S]*?\},\s*domains\s*\)/
  );
});

test('ollama-web: в API только query + max_results; fetch отдельно', () => {
  assert.match(ollama, /JSON\.stringify\(\{\s*query:\s*q,\s*max_results:/);
  assert.match(ollama, /OLLAMA_WEB_FETCH/);
  assert.match(ollama, /без фото, истории, избранного/);
});

test('about: переходы, без оплаты/партнёрства/гарантий подлинности', () => {
  assert.match(about, /не подтверждённый каталог/);
  assert.match(about, /Не продаёт товары и не принимает оплату/);
  assert.match(about, /Не является партнёром/);
  assert.match(about, /Не подтверждает подлинность/);
  assert.doesNotMatch(about, /мы ни за что не отвечаем|не несём ответственности/i);
});

test('config: WEB_SEARCH не auto-on от одного ключа', () => {
  const config = fs.readFileSync(path.join(root, 'lib/config.js'), 'utf8');
  assert.match(config, /WEB_SEARCH_ENABLED/);
  assert.match(config, /bool\(process\.env\.WEB_SEARCH_ENABLED,\s*false\)/);
});
