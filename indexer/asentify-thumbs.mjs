// Asentify picture previews (bundled). Source: Asentifyxx13/asentify- (private), indexer/thumbs.ts, commit 470a7d9. Makes small WebP copies of catalog pictures and uploads them to Cloudflare R2.

// indexer/thumbs.ts
import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

// src/lib/media/cdn.ts
var CDN = (() => {
  const v = (process.env.NEXT_PUBLIC_MEDIA_CDN || "").trim().replace(/\/+$/, "");
  try {
    return v && new URL(v).protocol === "https:" ? v : "";
  } catch {
    return "";
  }
})();
var FORMAT = /^(avif|webp|jpeg)$/.test(process.env.NEXT_PUBLIC_MEDIA_THUMB_FORMAT || "") ? process.env.NEXT_PUBLIC_MEDIA_THUMB_FORMAT : "webp";
var CID = "(?:Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{50,100})";
var CID_IN_URL = new RegExp(`/ipfs/(${CID})(?:/|$|\\?)`);
var REF = new RegExp(`^(?:ipfs://|https://[^/]+/ipfs/)(${CID})((?:/[A-Za-z0-9._-]{1,100}){0,6})/?(?:[?#].*)?$`);
function thumbKey(ref) {
  const m = REF.exec(ref.trim());
  return m ? m[1] + m[2] : null;
}

// indexer/thumbs.ts
var SIZES = [256, 512, 1024];
var MAX_BYTES = 30 * 1024 * 1024;
var sha256hex = (b) => createHash("sha256").update(b).digest("hex");
var hmac = (k, s) => createHmac("sha256", k).update(s).digest();
var enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
function signV4(i) {
  const u = new URL(i.url);
  const path = u.pathname.split("/").map((p) => enc(decodeURIComponent(p))).join("/") || "/";
  const query = [...u.searchParams.entries()].map(([k, v]) => [enc(k), enc(v)]).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1).map(([k, v]) => `${k}=${v}`).join("&");
  const hs = Object.entries(i.headers).map(([k, v]) => [k.toLowerCase(), v.trim().replace(/\s+/g, " ")]).sort((a, b) => a[0] < b[0] ? -1 : 1);
  const signed = hs.map(([k]) => k).join(";");
  const canonical = [i.method, path, query, hs.map(([k, v]) => `${k}:${v}
`).join(""), signed, i.payloadHash].join("\n");
  const day = i.amzDate.slice(0, 8), scope = `${day}/${i.region}/${i.service}/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", i.amzDate, scope, sha256hex(canonical)].join("\n");
  const key = hmac(hmac(hmac(hmac("AWS4" + i.secretKey, day), i.region), i.service), "aws4_request");
  return `AWS4-HMAC-SHA256 Credential=${i.accessKey}/${scope}, SignedHeaders=${signed}, Signature=${createHmac("sha256", key).update(toSign).digest("hex")}`;
}
function r2ConfigFrom(env) {
  const account = (env.R2_ACCOUNT_ID || "").trim(), accessKey = (env.R2_ACCESS_KEY_ID || "").trim(), secretKey = (env.R2_SECRET_ACCESS_KEY || "").trim();
  const bucket = (env.R2_BUCKET || "").trim(), publicUrl = (env.R2_PUBLIC_URL || "").trim().replace(/\/+$/, "");
  if (!/^[0-9a-f]{32}$/.test(account) || !accessKey || !secretKey || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket) || !/^https:\/\/[^\s/]+$/.test(publicUrl)) return null;
  return { account, accessKey, secretKey, bucket, publicUrl };
}
function putRequest(cfg, key, body, contentType, now = /* @__PURE__ */ new Date()) {
  const host = `${cfg.account}.r2.cloudflarestorage.com`;
  const url = `https://${host}/${cfg.bucket}/${key}`;
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const payloadHash = sha256hex(body);
  const headers = { host, "x-amz-date": amzDate, "x-amz-content-sha256": payloadHash, "content-type": contentType, "cache-control": "public, max-age=31536000, immutable" };
  headers.authorization = signV4({ method: "PUT", url, headers, payloadHash, region: "auto", service: "s3", accessKey: cfg.accessKey, secretKey: cfg.secretKey, amzDate });
  return { url, headers };
}
function picturesOf(catalog) {
  const out = /* @__PURE__ */ new Map();
  const add = (ref) => {
    if (!ref) return;
    const k = thumbKey(ref);
    if (k && !out.has(k)) out.set(k, ref);
  };
  for (const c of catalog.collections) {
    for (const t of c.tokens) add(t.image);
    add(c.logo);
    add(c.banner);
  }
  return [...out].map(([key, ref]) => ({ key, ref }));
}
async function fetchBytes(f, url, timeoutMs) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await f(url, { signal: ac.signal });
    if (!r.ok) return null;
    const len = Number(r.headers.get("content-length") || 0);
    if (len > MAX_BYTES) return null;
    const b = new Uint8Array(await r.arrayBuffer());
    return b.length && b.length <= MAX_BYTES ? b : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}
async function makeThumbs(cfg, pictures, gateways, d, budgetMs = 18e4) {
  const end = d.now() + budgetMs;
  let done = 0, had = 0, skipped = 0, i = 0;
  const worker = async () => {
    while (i < pictures.length && d.now() < end) {
      const p = pictures[i++];
      try {
        const head = await d.fetch(`${cfg.publicUrl}/thumbs/${p.key}/1024.webp`, { method: "HEAD" }).catch(() => null);
        if (head?.ok) {
          had++;
          continue;
        }
        const path = p.ref.replace(/^ipfs:\/\//, "");
        let bytes = null;
        for (const g of gateways) {
          bytes = await fetchBytes(d.fetch, `${g}/${path}`, 25e3);
          if (bytes || d.now() > end) break;
        }
        if (!bytes) {
          skipped++;
          continue;
        }
        const outs = [];
        for (const w of SIZES) {
          const o = await d.resize(bytes, w);
          if (!o) break;
          outs.push(o);
        }
        if (outs.length !== SIZES.length) {
          skipped++;
          continue;
        }
        let ok = true;
        for (let k = 0; k < SIZES.length && ok; k++) {
          const rq = putRequest(cfg, `thumbs/${p.key}/${SIZES[k]}.webp`, outs[k], "image/webp");
          const r = await d.fetch(rq.url, { method: "PUT", headers: rq.headers, body: outs[k] }).catch(() => null);
          ok = !!r?.ok;
          if (!ok) d.log(`thumbs: upload refused (${r ? r.status : "no answer"}) for ${p.key}`);
        }
        if (ok) done++;
        else skipped++;
      } catch {
        skipped++;
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  const left = pictures.length - done - had - skipped;
  d.log(`thumbs: ${done} new, ${had} already there, ${skipped} skipped, ${left} left for next run (of ${pictures.length})`);
  return { done, had, skipped, left };
}
async function sharpResize() {
  try {
    const mod = await import(
      /* @vite-ignore */
      "sharp"
    );
    const sharp = mod.default;
    return async (input, width) => {
      try {
        const img = sharp(input, { limitInputPixels: 1e8 });
        const m = await img.metadata();
        if (!m.width || m.pages && m.pages > 1 || m.format === "svg") return null;
        return new Uint8Array(await img.rotate().resize({ width, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer());
      } catch {
        return null;
      }
    };
  } catch {
    return null;
  }
}
async function main(env = process.env) {
  const cfg = r2ConfigFrom(env);
  if (!cfg) {
    console.log("thumbs: R2 not configured (secrets or R2_BUCKET / R2_PUBLIC_URL missing); nothing to do");
    return;
  }
  const resize = await sharpResize();
  if (!resize) {
    console.log("thumbs: sharp is not installed; nothing to do");
    return;
  }
  let catalog;
  try {
    catalog = JSON.parse(readFileSync(env.CATALOG_FILE || "work/api/market/catalog.json", "utf8"));
  } catch {
    console.log("thumbs: no catalog this run");
    return;
  }
  const gateways = (env.IPFS_GATEWAYS || "https://ipfs.io/ipfs,https://dweb.link/ipfs").split(",").map((x) => x.trim().replace(/\/+$/, "")).filter((x) => /^https:\/\//.test(x)).slice(0, 6);
  await makeThumbs(cfg, picturesOf(catalog), gateways, { fetch, resize, log: (s) => console.log(s), now: () => Date.now() }, Number(env.THUMBS_BUDGET_MS) || 18e4);
}
if (process.argv[1] && /(indexer\/thumbs\.ts|asentify-thumbs\.mjs)$/.test(process.argv[1])) main().catch((e) => {
  console.log("thumbs: stopped: " + (e instanceof Error ? e.message : String(e)));
});
export {
  SIZES,
  main,
  makeThumbs,
  picturesOf,
  putRequest,
  r2ConfigFrom,
  sharpResize,
  signV4
};
