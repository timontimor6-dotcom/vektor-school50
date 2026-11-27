const corsHeaders = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, ...headers } });
}
const enc = new TextEncoder();
function b64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function unb64url(value) {
  const s = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = s + "=".repeat((4 - s.length % 4) % 4);
  const raw = atob(padded);
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}
async function sign(payload, secret) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(payload))));
}
async function makeToken(secret) {
  const payload = b64url(enc.encode(JSON.stringify({ exp: Date.now() + 12 * 60 * 60 * 1000 })));
  return payload + "." + await sign(payload, secret);
}
async function validToken(request, secret) {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const [payload, signature] = token.split(".");
  if (!payload || !signature || !secret) return false;
  try {
    const expected = await sign(payload, secret);
    if (expected.length !== signature.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
    if (diff !== 0) return false;
    const data = JSON.parse(new TextDecoder().decode(unb64url(payload)));
    return Number(data.exp) > Date.now();
  } catch { return false; }
}
function requireSupabase(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing Supabase configuration");
}
async function supabase(env, path, options = {}) {
  requireSupabase(env);
  const response = await fetch(env.SUPABASE_URL.replace(/\/$/, "") + "/rest/v1/" + path, {
    ...options,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY,
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  if (!response.ok) throw new Error("Supabase " + response.status);
  return data;
}
function cleanText(value = "") {
  return String(value).replace(/<br\s*\/?\s*>/gi, "\n").replace(/<\/(p|div|li|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/[\t\r ]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}
function categoryFor(value, fallback = "school") {
  const s = String(value).toLowerCase();
  if (/counter.?strike|\bcs2\b|киберспорт|турнир|valorant|dota|команд[аы].{0,20}игр/.test(s)) return "esports";
  if (/егэ|огэ|образован|минпрос|учебник|школ[аы].{0,20}образован|олимпиад|экзамен|учител/.test(s)) return "education";
  return fallback;
}
function telegramPostToNews(post, channel) {
  const content = cleanText(post?.text || post?.caption || "");
  if (!content) return null;
  const title = content.split("\n").map(x => x.trim()).find(Boolean)?.slice(0, 160) || "Публикация";
  const date = post?.date ? new Date(Number(post.date) * 1000).toISOString() : new Date().toISOString();
  const id = post?.message_id || post?.id || String(Date.now());
  return { source: "telegram:@" + channel, source_id: channel + "/" + id, category: categoryFor(content, channel === "vektor_esports" ? "esports" : "school"),
    title, summary: content.slice(0, 320), content, url: "https://t.me/" + channel + "/" + id, image_url: null, published_at: date, status: "pending" };
}
async function adminApi(request, env) {
  if (request.method !== "POST") return json(405, { error: "Method not allowed" }, { allow: "POST" });
  let body;
  try { body = await request.json(); } catch { return json(400, { error: "Некорректный запрос" }); }
  if (body.action === "login") {
    if (!env.NEWS_ADMIN_PASSWORD || !env.NEWS_SESSION_SECRET) return json(503, { error: "В Cloudflare не заданы NEWS_ADMIN_PASSWORD и NEWS_SESSION_SECRET" });
    if (typeof body.password !== "string" || body.password.length > 256 || body.password !== env.NEWS_ADMIN_PASSWORD) return json(401, { error: "Неверный пароль" });
    return json(200, { token: await makeToken(env.NEWS_SESSION_SECRET) });
  }
  if (!await validToken(request, env.NEWS_SESSION_SECRET || "")) return json(401, { error: "Сессия истекла. Войдите снова." });
  try {
    if (body.action === "list") {
      const status = ["pending", "approved", "rejected"].includes(body.status) ? body.status : "pending";
      const posts = await supabase(env, "news_posts?select=*&status=eq." + status + "&order=created_at.desc&limit=100");
      return json(200, { posts });
    }
    if (body.action === "approve" && body.id) {
      const result = await supabase(env, "rpc/approve_news_post", { method: "POST", body: JSON.stringify({ p_id: body.id }) });
      return json(200, { ok: result === true });
    }
    if (body.action === "reject" && body.id) {
      await supabase(env, "news_posts?id=eq." + encodeURIComponent(body.id) + "&status=eq.pending", { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ status: "rejected", reviewed_at: new Date().toISOString() }) });
      return json(200, { ok: true });
    }
    if (body.action === "delete" && body.id) {
      await supabase(env, "news_posts?id=eq." + encodeURIComponent(body.id), { method: "DELETE" });
      return json(200, { ok: true });
    }
    if (body.action === "edit" && body.id) {
      const patch = {};
      for (const key of ["title", "summary", "content", "url", "image_url", "category"]) if (Object.hasOwn(body, key)) patch[key] = body[key];
      if (patch.category && !["school", "esports", "education"].includes(patch.category)) return json(400, { error: "Неверная категория" });
      await supabase(env, "news_posts?id=eq." + encodeURIComponent(body.id), { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(patch) });
      return json(200, { ok: true });
    }
    if (body.action === "setupTelegramWebhook") {
      const token = env.TELEGRAM_BOT_TOKEN;
      const webhookSecret = env.TELEGRAM_WEBHOOK_SECRET;
      if (!token || !webhookSecret) return json(503, { error: "Нужны TELEGRAM_BOT_TOKEN и TELEGRAM_WEBHOOK_SECRET в Cloudflare" });
      const base = new URL(request.url).origin;
      const response = await fetch("https://api.telegram.org/bot" + token + "/setWebhook", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: base + "/api/telegram-webhook", secret_token: webhookSecret, allowed_updates: ["channel_post"] }) });
      const result = await response.json();
      return json(response.ok && result.ok ? 200 : 502, result);
    }
    return json(400, { error: "Неизвестное действие" });
  } catch (error) {
    console.error("admin api:", error);
    return json(500, { error: "Ошибка операции с новостями", detail: error instanceof Error ? error.message : String(error) });
  }
}
async function publicNews(env) {
  try {
    if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return json(503, { error: "Новости временно недоступны" });
    const response = await fetch(env.SUPABASE_URL.replace(/\/$/, "") + "/rest/v1/rpc/get_latest_news", {
      method: "POST", headers: { apikey: env.SUPABASE_ANON_KEY, authorization: "Bearer " + env.SUPABASE_ANON_KEY, "content-type": "application/json" }, body: "{}"
    });
    if (!response.ok) return json(502, { error: "Не удалось загрузить новости" });
    return json(200, await response.json(), { "cache-control": "public, max-age=60, s-maxage=60" });
  } catch (error) { console.error("public news:", error); return json(500, { error: "Ошибка загрузки новостей" }); }
}
async function telegramWebhook(request, env) {
  const expected = env.TELEGRAM_WEBHOOK_SECRET || "";
  if (!expected || request.headers.get("x-telegram-bot-api-secret-token") !== expected) return json(401, { error: "Unauthorized" });
  if (request.method !== "POST") return json(405, { error: "Method not allowed" });
  try {
    const update = await request.json();
    const post = update.channel_post;
    if (!post) return json(200, { ok: true, ignored: true });
    const username = post.chat?.username || "";
    if (!["vektor_esports", "vektor_public"].includes(username)) return json(200, { ok: true, ignored: true });
    const news = telegramPostToNews(post, username);
    if (news) await supabase(env, "news_posts?on_conflict=source,source_id", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=representation" }, body: JSON.stringify([news]) });
    return json(200, { ok: true });
  } catch (error) { console.error("telegram webhook:", error); return json(500, { error: "Webhook processing failed" }); }
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/news") return publicNews(env);
    if (url.pathname === "/api/admin") return adminApi(request, env);
    if (url.pathname === "/api/telegram-webhook") return telegramWebhook(request, env);
    return env.ASSETS.fetch(request);
  }
};
