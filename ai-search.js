/* iSearch — подключает поле поиска, кнопку фото и выдачу к серверу (/api/find).
   Подключение: добавьте перед </body> в index.html строку
   <script src="ai-search.js"></script>                                           */
(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeUrl = (u) => (/^https?:\/\//i.test(u) ? u : '#');
  const fmt = (n) => Number(n).toLocaleString('ru-RU');

  const css = `
  #ai-results{background:#F5F5F7;padding:48px 0 64px;font-family:Inter,'Open Sans',system-ui,sans-serif;color:#1D1D1F}
  #ai-results .ai-wrap{max-width:1170px;margin:0 auto;padding:0 16px}
  #ai-results h2{font-size:28px;font-weight:600;margin:0 0 6px;letter-spacing:-0.02em}
  #ai-results .ai-sub{color:#86868B;font-size:15px;margin:0 0 20px}
  #ai-results .ai-chips{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 16px}
  #ai-results .ai-chip{background:#fff;border:1px solid #D2D2D7;border-radius:14px;padding:6px 12px;font-size:13px}
  #ai-results .ai-chip b{color:#86868B;font-weight:500;margin-right:4px}
  #ai-results .ai-note{background:#FFF8E1;border:1px solid #FFE08A;border-radius:12px;padding:10px 14px;font-size:14px;margin:0 0 10px}
  #ai-results .ai-error{background:#FFECEC;border:1px solid #F5B5B5;border-radius:12px;padding:14px 16px;font-size:15px}
  #ai-results .ai-h3{font-size:16px;font-weight:600;margin:24px 0 10px}
  #ai-results .ai-links{display:flex;flex-wrap:wrap;gap:10px}
  #ai-results .ai-link{background:#0071E3;color:#fff;border-radius:20px;padding:10px 18px;font-size:14px;font-weight:600;text-decoration:none}
  #ai-results .ai-link:hover{background:#0077ED}
  #ai-results .ai-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:20px}
  #ai-results .ai-card{background:#fff;border-radius:20px;padding:20px;box-shadow:0 8px 30px rgba(0,0,0,.04),0 0 0 1px rgba(0,0,0,.02);display:flex;flex-direction:column;gap:8px;word-break:break-word}
  #ai-results .ai-src{font-size:12px;color:#0071E3;font-weight:600}
  #ai-results .ai-title{font-size:15px;font-weight:600;line-height:1.35;margin:0}
  #ai-results .ai-price{font-size:20px;font-weight:700}
  #ai-results .ai-noprice{font-size:14px;color:#86868B}
  #ai-results .ai-snip{font-size:13px;color:#515154;line-height:1.5;margin:0;flex:1}
  #ai-results .ai-open{display:block;text-align:center;background:#F5F5F7;color:#0071E3;border-radius:10px;padding:10px;font-size:14px;font-weight:600;text-decoration:none}
  #ai-results .ai-loading{font-size:17px;padding:28px 0}
  #ai-photo-chip{display:none;align-items:center;gap:10px;margin:14px 0 0 28px;font-size:13px;color:#515154}
  #ai-photo-chip img{width:44px;height:44px;object-fit:cover;border-radius:8px}
  #ai-photo-chip button{border:none;background:none;color:#0071E3;cursor:pointer;font-size:13px}`;

  function resizeImage(file, max = 600) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width * k));
        c.height = Math.max(1, Math.round(img.height * k));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Не удалось открыть изображение (подойдут JPG, PNG, WebP)')); };
      img.src = url;
    });
  }

  function init() {
    const input = $('.n3K1-input');
    const submitBtn = $('.n3K1-btn-submit');
    const photoBtn = $('.n3K1-btn-photo');
    if (!input || !submitBtn) { console.warn('ai-search: не найдено поле поиска (.n3K1-input) или кнопка (.n3K1-btn-submit)'); return; }

    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    let image = null;
    let busy = false;

    // --- фото ---
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.style.display = 'none';
    document.body.appendChild(fileInput);

    const bar = $('.n3K1-search-container') || input.parentNode;
    const chip = document.createElement('div');
    chip.id = 'ai-photo-chip';
    bar.appendChild(chip);

    function setImage(dataUrl) {
      image = dataUrl;
      if (!dataUrl) { chip.style.display = 'none'; chip.innerHTML = ''; return; }
      chip.style.display = 'flex';
      chip.innerHTML = `<img alt="Загруженное фото" src="${dataUrl}"><span>Фото добавлено</span><button type="button">убрать</button>`;
      chip.querySelector('button').addEventListener('click', () => { fileInput.value = ''; setImage(null); });
    }

    if (photoBtn) {
      photoBtn.addEventListener('click', (e) => { e.preventDefault(); fileInput.click(); });
    }
    fileInput.addEventListener('change', async () => {
      const f = fileInput.files && fileInput.files[0];
      if (!f) return;
      try { setImage(await resizeImage(f)); } catch (err) { alert(err.message); }
    });

    // --- панель результатов ---
    function panel() {
      let p = $('#ai-results');
      if (!p) {
        p = document.createElement('section');
        p.id = 'ai-results';
        p.innerHTML = '<div class="ai-wrap"></div>';
        const hero = $('#hero') || $('.n3K1-hero');
        if (hero && hero.parentNode) hero.parentNode.insertBefore(p, hero.nextSibling);
        else document.body.appendChild(p);
      }
      return p;
    }

    function render(d) {
      const a = d.analysis || {};
      const chips = [
        ['Категория', a.category], ['Цвет', a.color], ['Материал', a.material], ['Стиль', a.style],
        ['Крой', a.fit], ['Размер', a.size], ['Бюджет', a.max_price_rub ? `до ${fmt(a.max_price_rub)} ₽` : null], ['Бренд', a.visible_brand],
      ].filter((x) => x[1]).map((x) => `<span class="ai-chip"><b>${x[0]}:</b>${esc(x[1])}</span>`).join('');

      const notes = (d.warnings || []).map((w) => `<div class="ai-note">${esc(w)}</div>`).join('');
      const links = (d.links || []).map((l) => `<a class="ai-link" target="_blank" rel="noopener noreferrer" href="${esc(safeUrl(l.url))}">Искать на ${esc(l.name)}</a>`).join('');

      let cards = '';
      if ((d.results || []).length) {
        cards = '<div class="ai-h3">Найдено в интернете</div><div class="ai-grid">' + d.results.map((r) => `
          <div class="ai-card">
            <div class="ai-src">${esc(r.source)}</div>
            <p class="ai-title">${esc(r.title)}</p>
            ${r.price ? `<div class="ai-price">${fmt(r.price)} ₽</div>` : '<div class="ai-noprice">цена на сайте площадки</div>'}
            <p class="ai-snip">${esc(r.snippet)}</p>
            <a class="ai-open" target="_blank" rel="noopener noreferrer" href="${esc(safeUrl(r.url))}">Открыть</a>
          </div>`).join('') + '</div>';
      } else if (d.search_provider) {
        cards = '<div class="ai-note">Поиск по интернету ничего не вернул. Попробуйте ссылки на площадки выше.</div>';
      }

      panel().querySelector('.ai-wrap').innerHTML = `
        <h2>Что мы поняли из вашего запроса</h2>
        <p class="ai-sub">${d.movie ? `Образ: ${esc(d.movie)}. ` : ''}Поисковая фраза: «${esc(a.search_phrase)}» · ${d.took_sec} с</p>
        <div class="ai-chips">${chips || '<span class="ai-chip">Характеристики не определены</span>'}</div>
        ${notes}
        <div class="ai-h3">Открыть выдачу на площадках</div>
        <div class="ai-links">${links}</div>
        ${cards}`;
    }

    function showError(msg) {
      panel().querySelector('.ai-wrap').innerHTML = `<div class="ai-error">${esc(msg)}</div>`;
    }

    async function run() {
      const query = input.value.trim();
      if (!query && !image) { input.focus(); return; }
      if (busy) return;
      busy = true;
      submitBtn.style.opacity = '.6';
      const p = panel();
      p.querySelector('.ai-wrap').innerHTML = '<div class="ai-loading" id="ai-timer">Анализирую запрос… 0 с</div><div class="ai-sub">Первый запрос и запросы с фото могут занимать несколько минут на слабом компьютере.</div>';
      p.scrollIntoView({ behavior: 'smooth', block: 'start' });
      const t0 = Date.now();
      const timer = setInterval(() => {
        const el = $('#ai-timer');
        if (el) el.textContent = `Анализирую запрос… ${Math.round((Date.now() - t0) / 1000)} с`;
      }, 1000);
      try {
        const r = await fetch('/api/find', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, image: image || undefined }),
          signal: AbortSignal.timeout(7 * 60 * 1000),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || `Ошибка сервера ${r.status}`);
        render(data);
      } catch (e) {
        showError(e.name === 'TimeoutError' ? 'Сервер слишком долго отвечал. Попробуйте запрос без фото.' : (e.message === 'Failed to fetch' ? 'Нет связи с сервером. Запущен ли «node server.js»?' : e.message));
      } finally {
        clearInterval(timer);
        busy = false;
        submitBtn.style.opacity = '';
      }
    }

    submitBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); run(); }, true);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } });
    document.querySelectorAll('.n3K1-hint-link').forEach((b) => b.addEventListener('click', () => { input.value = b.textContent.trim(); run(); }));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
