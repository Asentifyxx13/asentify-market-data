// Asentify Telegram announcements (bundled). Source: Asentifyxx13/asentify- (private), indexer/announce.ts, commit 2af150d. Posts new listings and sales; needs TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID secrets.

// indexer/announce.ts
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// src/lib/telegram/bot.ts
var esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
function ase(wei) {
  if (!wei || !/^[0-9]{1,40}$/.test(wei)) return "\u2014";
  const n = Number(BigInt(wei) / BigInt(1e12)) / 1e6;
  return n.toLocaleString("en-US", { maximumFractionDigits: 4 }) + " ASE";
}

// indexer/announce.ts
var MAX_POSTS = 8;
function newPosts(snaps, names, since, site) {
  const seen = /* @__PURE__ */ new Set(), out = [];
  for (const s of snaps) for (const a of s.activity) {
    if (a.block <= since || !a.tokenId || !["sale", "offer_accepted", "listing"].includes(a.kind)) continue;
    const k = `${a.txHash}:${a.kind}:${a.tokenId}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const name = names.get(s.collection.toLowerCase()) ?? "NFT", url = `${site}/nfts/${s.collection}/${a.tokenId}`;
    const text = a.kind === "listing" ? `\u{1F3F7} <b>New listing</b>
<a href="${url}">${esc(name)} #${esc(a.tokenId)}</a> for <b>${ase(a.price)}</b>` : `\u{1F4B8} <b>Sold</b>
<a href="${url}">${esc(name)} #${esc(a.tokenId)}</a> for <b>${ase(a.price)}</b>`;
    out.push({ block: a.block, text, url, k });
  }
  return out.sort((x, y) => x.block - y.block).slice(-MAX_POSTS).map((p) => ({ block: p.block, text: p.text, url: p.url }));
}
async function main(env = process.env, f = fetch) {
  const token = (env.TELEGRAM_BOT_TOKEN || "").trim(), chat = (env.TELEGRAM_CHAT_ID || "").trim();
  if (!token || !chat) {
    console.log("announce: Telegram not configured; nothing to do");
    return;
  }
  const dir = env.OUT_DIR || "work/api/market", stateFile = env.ANNOUNCE_STATE || "work/data/announced.json", site = (env.SITE_URL || "https://asentify.app").replace(/\/+$/, "");
  let snaps = [];
  try {
    snaps = readdirSync(dir).filter((x) => /^0x[0-9a-f]{40}\.json$/.test(x)).map((x) => JSON.parse(readFileSync(join(dir, x), "utf8"))).filter((s) => Array.isArray(s?.activity));
  } catch {
  }
  const names = /* @__PURE__ */ new Map();
  try {
    for (const c of JSON.parse(readFileSync(join(dir, "catalog.json"), "utf8")).collections ?? []) names.set(String(c.address).toLowerCase(), String(c.name));
  } catch {
  }
  const top = Math.max(0, ...snaps.flatMap((s) => s.activity.map((a) => a.block)));
  let since = null;
  try {
    since = Number(JSON.parse(readFileSync(stateFile, "utf8")).lastBlock);
    if (!Number.isFinite(since)) since = null;
  } catch {
    since = null;
  }
  if (since === null) {
    writeFileSync(stateFile, JSON.stringify({ lastBlock: top }));
    console.log(`announce: first run, starting after block ${top}`);
    return;
  }
  const posts = newPosts(snaps, names, since, site);
  let last = since;
  for (const p of posts) {
    try {
      const r = await f(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chat, text: p.text, parse_mode: "HTML", link_preview_options: { is_disabled: true }, reply_markup: { inline_keyboard: [[{ text: "View on Asentify", url: p.url }]] } })
      });
      const j = await r.json().catch(() => ({}));
      if (!j.ok) {
        console.log(`announce: Telegram refused (${j.description ?? r.status}); will retry next run`);
        break;
      }
      last = Math.max(last, p.block);
    } catch {
      console.log("announce: Telegram not reachable; will retry next run");
      break;
    }
  }
  if (!posts.length) last = Math.max(last, top);
  writeFileSync(stateFile, JSON.stringify({ lastBlock: last }));
  console.log(`announce: ${posts.length} new, posted up to block ${last}`);
}
if (process.argv[1] && /(indexer\/announce\.ts|asentify-announce\.mjs)$/.test(process.argv[1])) main().catch((e) => console.log("announce: stopped: " + (e instanceof Error ? e.message : e)));
export {
  main,
  newPosts
};
