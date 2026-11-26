import { json, telegramPostToNews, savePending } from '../lib/news-utils.mjs';

export default async event => {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET || '';
  const received = event.headers?.['x-telegram-bot-api-secret-token'] || event.headers?.['X-Telegram-Bot-Api-Secret-Token'] || '';
  if (!expected || received !== expected) return json(401, { error: 'Unauthorized' });
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  try {
    const update = JSON.parse(event.body || '{}');
    const post = update.channel_post;
    if (!post) return json(200, { ok: true, ignored: true });
    const username = post.chat?.username || '';
    if (!['vektor_esports', 'vektor_public'].includes(username)) return json(200, { ok: true, ignored: true });
    const news = telegramPostToNews(post, username);
    if (news) await savePending(news);
    return json(200, { ok: true });
  } catch (error) {
    console.error('telegram-webhook:', error);
    return json(500, { error: 'Webhook processing failed' });
  }
};
