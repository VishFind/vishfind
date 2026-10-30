'use strict';

/**
 * Timeweb AI Gateway — разбор фото (OpenAI-compatible chat/completions).
 * Ключ только на сервере. Без авто-переключения на Ollama.
 */

function toDataUrl(imageB64) {
  if (!imageB64) return null;
  const s = String(imageB64);
  if (/^data:image\/[\w+.-]+;base64,/i.test(s)) return s;
  let mime = 'image/jpeg';
  if (s.startsWith('iVBOR')) mime = 'image/png';
  else if (s.startsWith('R0lG')) mime = 'image/gif';
  else if (s.startsWith('UklG')) mime = 'image/webp';
  else if (s.startsWith('/9j/')) mime = 'image/jpeg';
  return `data:${mime};base64,${s}`;
}

function mapHttpError(status, bodyText) {
  const snippet = String(bodyText || '').slice(0, 200);
  const err = new Error(`Timeweb ${status}: ${snippet}`);
  err.status = status;
  if (status === 401 || status === 403) {
    err.code = 'TIMEWEB_AUTH';
    err.message = 'Timeweb: ошибка авторизации (проверьте TIMEWEB_AI_API_KEY)';
  } else if (status === 429) {
    err.code = 'TIMEWEB_RATE';
    err.message = 'Timeweb: превышен лимит запросов, повторите позже';
  } else if (status >= 500) {
    err.code = 'TIMEWEB_SERVICE';
    err.message = 'Timeweb: сервис временно недоступен';
  } else {
    err.code = 'TIMEWEB_HTTP';
  }
  return err;
}

/**
 * @param {{
 *   url: string,
 *   apiKey: string,
 *   model: string,
 *   prompt: string,
 *   imageB64?: string|null,
 *   timeoutMs: number,
 *   fetchImpl?: typeof fetch,
 * }} opts
 * @returns {Promise<{ content: string, usage: object|null, raw: object }>}
 */
async function chatCompletion(opts) {
  const apiKey = String((opts && opts.apiKey) || '').trim();
  if (!apiKey) {
    const e = new Error('TIMEWEB_AI_API_KEY не задан');
    e.code = 'TIMEWEB_NO_KEY';
    e.name = 'ConfigError';
    throw e;
  }
  const url = String((opts && opts.url) || '').trim();
  if (!url) {
    const e = new Error('TIMEWEB_AI_URL не задан');
    e.code = 'TIMEWEB_NO_URL';
    throw e;
  }
  const model = String((opts && opts.model) || 'openai/gpt-4o-mini');
  const prompt = String((opts && opts.prompt) || '');
  const timeoutMs = Math.max(1000, Number(opts.timeoutMs) || 30000);
  const fetchImpl = (opts && opts.fetchImpl) || fetch;

  const imageB64 = opts && opts.imageB64 ? opts.imageB64 : null;
  let userContent;
  if (imageB64) {
    userContent = [
      { type: 'text', text: prompt },
      { type: 'image_url', image_url: { url: toDataUrl(imageB64) } },
    ];
  } else {
    userContent = prompt;
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: userContent }],
        response_format: { type: 'json_object' },
        temperature: 0,
      }),
      signal: ac.signal,
    });
    const text = await r.text();
    if (!r.ok) throw mapHttpError(r.status, text);
    let raw;
    try {
      raw = JSON.parse(text);
    } catch (_) {
      const e = new Error('Timeweb вернул не-JSON оболочку');
      e.code = 'TIMEWEB_BAD_ENVELOPE';
      throw e;
    }
    const content =
      raw &&
      raw.choices &&
      raw.choices[0] &&
      raw.choices[0].message &&
      raw.choices[0].message.content != null
        ? String(raw.choices[0].message.content)
        : '';
    const usage = raw && raw.usage && typeof raw.usage === 'object' ? raw.usage : null;
    return { content, usage, raw };
  } catch (e) {
    if (e && e.name === 'AbortError') {
      throw Object.assign(new Error(`Модель не ответила за ${Math.round(timeoutMs / 1000)} с`), {
        name: 'TimeoutError',
        code: 'TIMEWEB_TIMEOUT',
      });
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  chatCompletion,
  toDataUrl,
  mapHttpError,
};
