import { json } from '../lib/news-utils.mjs';

export default async () => {
  try {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_ANON_KEY;
    if (!url || !key) return json(503, { error: 'Новости временно недоступны' });
    const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/get_latest_news`, {
      method: 'POST',
      headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: '{}'
    });
    if (!response.ok) return json(502, { error: 'Не удалось загрузить новости' });
    return json(200, await response.json(), { 'cache-control': 'public, max-age=60, s-maxage=60' });
  } catch (error) {
    console.error('news-public:', error);
    return json(500, { error: 'Ошибка загрузки новостей' });
  }
};
