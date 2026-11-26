const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export function json(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extraHeaders },
    body: JSON.stringify(body)
  };
}

export function requireSupabase() {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

export async function supabase(path, options = {}) {
  requireSupabase();
  const response = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SERVICE_KEY,
      authorization: `Bearer ${SERVICE_KEY}`,
      'content-type': 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  return data;
}

export function cleanText(value = '') {
  return String(value)
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/[\t\r ]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

export function categoryFor(text, fallback = 'school') {
  const value = String(text).toLowerCase();
  if (/counter.?strike|\bcs2\b|киберспорт|турнир|valorant|dota|команд[аы].{0,20}игр/.test(value)) return 'esports';
  if (/егэ|огэ|образован|минпрос|учебник|школ[аы].{0,20}образован|олимпиад|экзамен|учител/.test(value)) return 'education';
  return fallback;
}

export async function savePendingMany(posts) {
  if (!Array.isArray(posts) || posts.length === 0) return 0;
  const rows = await supabase('news_posts?on_conflict=source,source_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify(posts.map(post => ({ ...post, status: 'pending' })))
  });
  return Array.isArray(rows) ? rows.length : 0;
}

export async function savePending(post) {
  return savePendingMany([post]);
}

export function telegramPostToNews(post, channel) {
  const message = post?.text || post?.caption || '';
  const text = cleanText(message);
  if (!text) return null;
  const title = text.split('\n').map(x => x.trim()).find(Boolean)?.slice(0, 160) || `Публикация ${channel}`;
  const date = post?.date ? new Date(Number(post.date) * 1000).toISOString() : new Date().toISOString();
  const messageId = post?.message_id || post?.id || `${Date.now()}`;
  const photo = Array.isArray(post?.photo) ? post.photo.at(-1) : null;
  return {
    source: `telegram:@${channel}`,
    source_id: `${channel}/${messageId}`,
    category: categoryFor(text, channel === 'vektor_esports' ? 'esports' : 'school'),
    title,
    summary: text.slice(0, 320),
    content: text,
    url: `https://t.me/${channel}/${messageId}`,
    image_url: photo?.file_id ? null : null,
    published_at: date
  };
}
