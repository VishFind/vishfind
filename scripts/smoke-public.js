'use strict';
(async () => {
  const base = process.env.BASE || 'http://127.0.0.1:3001';
  const envStatus = (await fetch(base + '/.env')).status;
  const html = await (await fetch(base + '/')).text();
  console.log('DOTENV', envStatus);
  console.log('BTN_HIDDEN', /id="btn-photo"[^>]*\bhidden\b/.test(html));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
