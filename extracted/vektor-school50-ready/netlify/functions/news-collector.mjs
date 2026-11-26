import { json, cleanText, categoryFor, savePendingMany } from '../lib/news-utils.mjs';

function extractAttr(html, name) {
  const re = new RegExp(`${name}=["']([^"']+)`, 'i');
  return html.match(re)?.[1] || '';
}

export function parseTelegram(html, channel) {
  const chunks = html.split(/<div class="tgme_widget_message_wrap\b/i).slice(1);
  const posts = [];
  for (const chunk of chunks) {
    const id = extractAttr(chunk, 'data-post');
    if (!id) continue;
    const textMatch = chunk.match(/<div class="tgme_widget_message_text[^\"]*"[^>]*>([\s\S]*?)<\/div>/i);
    const content = cleanText(textMatch?.[1] || '');
    if (!content) continue;
    const title = content.split('\n').map(x => x.trim()).find(Boolean)?.slice(0, 160) || `Публикация ${channel}`;
    const time = chunk.match(/<time[^>]*datetime=["']([^"']+)["']/i)?.[1];
    const image = chunk.match(/background-image:url\(['"]?([^'"\)]+)['"]?\)/i)?.[1] || null;
    posts.push({
      source: `telegram:@${channel}`,
      source_id: id,
      category: categoryFor(content, channel === 'vektor_esports' ? 'esports' : 'school'),
      title,
      summary: content.slice(0, 320),
      content,
      url: `https://t.me/${id}`,
      image_url: image,
      published_at: time ? new Date(time).toISOString() : new Date().toISOString()
    });
  }
  return posts;
}

async function collectTelegram(channel) {
  const response = await fetch(`https://t.me/s/${channel}`, { headers: { 'user-agent': 'Mozilla/5.0 VektorNewsBot/1.0' } });
  if (!response.ok) throw new Error(`Telegram @${channel}: HTTP ${response.status}`);
  const html = await response.text();
  const posts = parseTelegram(html, channel);
  const saved = await savePendingMany(posts);
  return { source: `@${channel}`, parsed: posts.length, inserted: saved };
}

export const config = { schedule: '0 6 * * *' };

export default async () => {
  const results = [];
  for (const channel of ['vektor_public', 'vektor_esports']) {
    try { results.push(await collectTelegram(channel)); }
    catch (error) { console.error(error); results.push({ source: `@${channel}`, error: error.message }); }
  }
  console.log('news-collector:', JSON.stringify(results));
  return json(200, { ok: true, results });
};
