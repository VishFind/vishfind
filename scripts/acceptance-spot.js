'use strict';

const { parseQuery } = require('../lib/parse-query');
const brands = require('../lib/brands').aliasList();
const { selectSources, registrySummary } = require('../lib/source-registry');
const brandsApi = require('../lib/brands');

function show(q) {
  const p = parseQuery(q, { brands });
  const s = selectSources(p, { maxSources: 8 });
  console.log('Q:', q);
  console.log(
    ' brands:',
    p.brands,
    'budget',
    p.budget_min,
    p.budget_max,
    'features',
    p.features
  );
  console.log(' sel:', s.selected.map((x) => x.id).join(', '));
  console.log(
    ' off:',
    (s.officialExtras || []).map((x) => x.id + ':' + x.domain).join(', ')
  );
}

console.log('brands', brandsApi.summary());
console.log('sources', registrySummary());
[
  'Nike худи',
  'Dior сумка',
  'Louis Vuitton сумка',
  'AMIRI джинсы',
  'Rick Owens куртка',
  "винтажные Levi's джинсы",
  'от трёх до восьми тысяч куртка',
  'LIMÉ платье',
  'MAAG футболка',
  'Jordan кроссовки',
].forEach(show);
