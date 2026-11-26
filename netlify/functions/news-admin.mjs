import { createHmac, timingSafeEqual } from 'node:crypto';
import { json, supabase } from '../lib/news-utils.mjs';

const secret = () => process.env.NEWS_SESSION_SECRET || '';
const password = () => process.env.NEWS_ADMIN_PASSWORD || '';
const b64 = value => Buffer.from(value).toString('base64url');

function makeToken() {
  const payload = b64(JSON.stringify({ exp: Date.now() + 12 * 60 * 60 * 1000 }));
  const sig = createHmac('sha256', secret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function validToken(event) {
  const token = event.headers?.authorization?.replace(/^Bearer\s+/i, '') || '';
  const [payload, signature] = token.split('.');
  if (!payload || !signature || !secret()) return false;
  const expected = createHmac('sha256', secret()).update(payload).digest();
  let actual;
  try { actual = Buffer.from(signature, 'base64url'); } catch { return false; }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false;
  try { return JSON.parse(Buffer.from(payload, 'base64url').toString()).exp > Date.now(); } catch { return false; }
}

export default async request => {
  const event = {
    httpMethod: request.method,
    headers: Object.fromEntries(request.headers),
    body: await request.text()
  };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' }, { allow: 'POST' });
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Некорректный запрос' }); }

  if (body.action === 'login') {
    if (!password() || !secret()) return json(503, { error: 'На Netlify не заданы NEWS_ADMIN_PASSWORD и NEWS_SESSION_SECRET' });
    if (typeof body.password !== 'string' || body.password.length > 256 || body.password !== password()) {
      return json(401, { error: 'Неверный пароль' });
    }
    return json(200, { token: makeToken() });
  }
  if (!validToken(event)) return json(401, { error: 'Сессия истекла. Войдите снова.' });

  try {
    if (body.action === 'list') {
      const status = ['pending', 'approved', 'rejected'].includes(body.status) ? body.status : 'pending';
      const rows = await supabase(`news_posts?select=*&status=eq.${status}&order=created_at.desc&limit=100`);
      return json(200, { posts: rows });
    }
    if (body.action === 'approve' && body.id) {
      const result = await supabase('rpc/approve_news_post', { method: 'POST', body: JSON.stringify({ p_id: body.id }) });
      return json(200, { ok: result === true });
    }
    if (body.action === 'reject' && body.id) {
      await supabase(`news_posts?id=eq.${encodeURIComponent(body.id)}&status=eq.pending`, {
        method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: 'rejected', reviewed_at: new Date().toISOString() })
      });
      return json(200, { ok: true });
    }
    if (body.action === 'delete' && body.id) {
      await supabase(`news_posts?id=eq.${encodeURIComponent(body.id)}`, { method: 'DELETE' });
      return json(200, { ok: true });
    }
    if (body.action === 'edit' && body.id) {
      const patch = {};
      for (const key of ['title', 'summary', 'content', 'url', 'image_url', 'category']) {
        if (Object.hasOwn(body, key)) patch[key] = body[key];
      }
      if (patch.category && !['school', 'esports', 'education'].includes(patch.category)) return json(400, { error: 'Неверная категория' });
      await supabase(`news_posts?id=eq.${encodeURIComponent(body.id)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) });
      return json(200, { ok: true });
    }
    if (body.action === 'setupTelegramWebhook') {
      const token = process.env.TELEGRAM_BOT_TOKEN;
      const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
      const siteUrl = process.env.URL;
      if (!token || !webhookSecret || !siteUrl) return json(503, { error: 'Нужны TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET и URL (Netlify задаёт URL автоматически)' });
      const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: `${siteUrl}/.netlify/functions/telegram-webhook`, secret_token: webhookSecret, allowed_updates: ['channel_post'] })
      });
      const result = await response.json();
      return json(response.ok && result.ok ? 200 : 502, result);
    }
    return json(400, { error: 'Неизвестное действие' });
  } catch (error) {
    console.error('news-admin:', error);
    return json(500, { error: 'Ошибка операции с новостями' });
  }
};
