// Asentify market-data indexer (bundled). Source: Asentifyxx13/asentify- (private), branch main, commit 8369a46. Reads the Asentum testnet only; sends no transactions; needs no keys.

// indexer/worker.ts
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// src/lib/indexer/blake3.ts
var IV = [1779033703, 3144134277, 1013904242, 2773480762, 1359893119, 2600822924, 528734635, 1541459225];
var PERM = [2, 6, 3, 10, 7, 0, 4, 13, 1, 11, 12, 5, 9, 14, 15, 8];
var CHUNK_START = 1;
var CHUNK_END = 2;
var PARENT = 4;
var ROOT = 8;
var CHUNK_LEN = 1024;
var BLOCK_LEN = 64;
var rotr = (x, n) => (x >>> n | x << 32 - n) >>> 0;
function g(s2, a, b, c, d, x, y) {
  s2[a] = s2[a] + s2[b] + x >>> 0;
  s2[d] = rotr(s2[d] ^ s2[a], 16);
  s2[c] = s2[c] + s2[d] >>> 0;
  s2[b] = rotr(s2[b] ^ s2[c], 12);
  s2[a] = s2[a] + s2[b] + y >>> 0;
  s2[d] = rotr(s2[d] ^ s2[a], 8);
  s2[c] = s2[c] + s2[d] >>> 0;
  s2[b] = rotr(s2[b] ^ s2[c], 7);
}
function compress(cv, m, counter, len, flags) {
  const s2 = new Uint32Array([
    cv[0],
    cv[1],
    cv[2],
    cv[3],
    cv[4],
    cv[5],
    cv[6],
    cv[7],
    IV[0],
    IV[1],
    IV[2],
    IV[3],
    counter >>> 0,
    Math.floor(counter / 4294967296) >>> 0,
    len,
    flags
  ]);
  let w = Uint32Array.from(m);
  for (let r = 0; r < 7; r++) {
    g(s2, 0, 4, 8, 12, w[0], w[1]);
    g(s2, 1, 5, 9, 13, w[2], w[3]);
    g(s2, 2, 6, 10, 14, w[4], w[5]);
    g(s2, 3, 7, 11, 15, w[6], w[7]);
    g(s2, 0, 5, 10, 15, w[8], w[9]);
    g(s2, 1, 6, 11, 12, w[10], w[11]);
    g(s2, 2, 7, 8, 13, w[12], w[13]);
    g(s2, 3, 4, 9, 14, w[14], w[15]);
    if (r < 6) w = Uint32Array.from(PERM, (i) => w[i]);
  }
  for (let i = 0; i < 8; i++) {
    s2[i] ^= s2[i + 8];
    s2[i + 8] ^= cv[i];
  }
  return s2;
}
function words(block) {
  const w = new Uint32Array(16);
  for (let i = 0; i < 16; i++) w[i] = (block[4 * i] | block[4 * i + 1] << 8 | block[4 * i + 2] << 16 | block[4 * i + 3] << 24) >>> 0;
  return w;
}
function chunkOutput(chunk, counter) {
  let cv = Uint32Array.from(IV);
  const nBlocks = Math.max(1, Math.ceil(chunk.length / BLOCK_LEN));
  for (let i = 0; i < nBlocks - 1; i++) {
    const flags = i === 0 ? CHUNK_START : 0;
    cv = compress(cv, words(chunk.subarray(i * BLOCK_LEN, (i + 1) * BLOCK_LEN)), counter, BLOCK_LEN, flags).slice(0, 8);
  }
  const last = new Uint8Array(BLOCK_LEN);
  const tail = chunk.subarray((nBlocks - 1) * BLOCK_LEN);
  last.set(tail);
  return { cv, block: words(last), counter, len: tail.length, flags: (nBlocks === 1 ? CHUNK_START : 0) | CHUNK_END };
}
var chainingValue = (o) => compress(o.cv, o.block, o.counter, o.len, o.flags).slice(0, 8);
function parentOutput(l, r) {
  const m = new Uint32Array(16);
  m.set(l, 0);
  m.set(r, 8);
  return { cv: Uint32Array.from(IV), block: m, counter: 0, len: BLOCK_LEN, flags: PARENT };
}
function blake3(input) {
  const nChunks = Math.max(1, Math.ceil(input.length / CHUNK_LEN));
  const stack = [];
  let out = chunkOutput(input.subarray(0, CHUNK_LEN), 0);
  for (let i = 1; i < nChunks; i++) {
    let cv = chainingValue(out);
    let total = i;
    while ((total & 1) === 0) {
      cv = chainingValue(parentOutput(stack.pop(), cv));
      total >>= 1;
    }
    stack.push(cv);
    out = chunkOutput(input.subarray(i * CHUNK_LEN, (i + 1) * CHUNK_LEN), i);
  }
  while (stack.length) out = parentOutput(stack.pop(), chainingValue(out));
  const s2 = compress(out.cv, out.block, out.counter, out.len, out.flags | ROOT);
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 8; i++) {
    bytes[4 * i] = s2[i] & 255;
    bytes[4 * i + 1] = s2[i] >>> 8 & 255;
    bytes[4 * i + 2] = s2[i] >>> 16 & 255;
    bytes[4 * i + 3] = s2[i] >>> 24 & 255;
  }
  return bytes;
}
function blake3Hex(text) {
  return "0x" + Array.from(blake3(new TextEncoder().encode(text)), (b) => b.toString(16).padStart(2, "0")).join("");
}

// src/lib/chain/bech32.ts
var CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
var GEN = [996825010, 642813549, 513874426, 1027748829, 705979059];
function polymod(values) {
  let chk = 1;
  for (const v of values) {
    const b = chk >>> 25;
    chk = (chk & 33554431) << 5 ^ v;
    for (let i = 0; i < 5; i++) if (b >>> i & 1) chk ^= GEN[i];
  }
  return chk >>> 0;
}
var hrpExpand = (hrp) => [...Array.from(hrp, (c) => c.charCodeAt(0) >> 5), 0, ...Array.from(hrp, (c) => c.charCodeAt(0) & 31)];
function bech32Constant(s2) {
  if (s2 !== s2.toLowerCase() && s2 !== s2.toUpperCase()) return null;
  const str2 = s2.toLowerCase();
  const pos = str2.lastIndexOf("1");
  if (pos < 1 || pos + 7 > str2.length || str2.length > 90) return null;
  const hrp = str2.slice(0, pos);
  const data = [];
  for (const c of str2.slice(pos + 1)) {
    const d = CHARSET.indexOf(c);
    if (d < 0) return null;
    data.push(d);
  }
  return polymod([...hrpExpand(hrp), ...data]);
}
function ase1ToHex(addr) {
  const s2 = addr.trim();
  if (bech32Constant(s2) !== 1) throw new Error("invalid ase1 address checksum");
  const str2 = s2.toLowerCase();
  const pos = str2.lastIndexOf("1");
  if (str2.slice(0, pos) !== "ase") throw new Error("not an ase1 address");
  const data = Array.from(str2.slice(pos + 1, -6), (c) => CHARSET.indexOf(c));
  let acc = 0, bits = 0;
  const out = [];
  for (const v of data) {
    acc = acc << 5 | v;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      out.push(acc >> bits & 255);
    }
  }
  if (bits >= 5 || acc << 8 - bits & 255) throw new Error("invalid ase1 padding");
  if (out.length !== 20) throw new Error("ase1 address must be 20 bytes");
  return "0x" + out.map((b) => b.toString(16).padStart(2, "0")).join("");
}
function toHexAddress(a) {
  const s2 = a.trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(s2)) return s2.toLowerCase();
  return ase1ToHex(s2);
}

// src/lib/indexer/events.ts
var EVENT_NAMES = ["Transfer", "Approval", "ApprovalForAll", "Listed", "ListingCancelled", "Sold", "OfferMade", "OfferCancelled", "OfferAccepted", "Paused", "Initialised"];
var TOPICS = Object.fromEntries(EVENT_NAMES.map((n) => [blake3Hex(n), n]));
var HEXQ = /^0x[0-9a-fA-F]{1,16}$/;
function hexToUtf8(h) {
  if (!/^0x([0-9a-fA-F]{2})*$/.test(h) || h.length > 2 + 2 * 32 * 1024) throw new Error("bad data");
  const bytes = new Uint8Array((h.length - 2) / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(h.substr(2 + 2 * i, 2), 16);
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
var lowerAddr = (v) => {
  try {
    return toHexAddress(String(v));
  } catch {
    return null;
  }
};
function decodeLog(raw) {
  if (!raw || raw.removed) return null;
  const name = raw.topics && TOPICS[String(raw.topics[0]).toLowerCase()];
  if (!name) return null;
  if (!HEXQ.test(raw.blockNumber) || !HEXQ.test(raw.logIndex) || !/^0x[0-9a-fA-F]{64}$/.test(raw.transactionHash)) return null;
  const contract = lowerAddr(raw.address);
  if (!contract) return null;
  let data;
  try {
    data = JSON.parse(hexToUtf8(raw.data));
  } catch {
    return null;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const d = data;
  for (const k of ["from", "to", "owner", "approved", "operator", "collection", "seller", "buyer", "bidder", "feeRecipient", "admin", "by"]) {
    if (typeof d[k] === "string" && d[k].length >= 40) {
      const a = lowerAddr(d[k]);
      if (a) d[k] = a;
    }
  }
  const tx = raw.transactionHash.toLowerCase();
  const li = parseInt(raw.logIndex, 16);
  return { key: tx + ":" + li, block: parseInt(raw.blockNumber, 16), logIndex: li, txHash: tx, contract, name, data: d };
}

// src/lib/indexer/ingest.ts
var MAX_RANGE = 1e4;
var MIN_RANGE = 625;
var HttpRpc = class {
  constructor(url, fetchFn = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), maxRetries = 6) {
    this.url = url;
    this.fetchFn = fetchFn;
    this.sleep = sleep;
    this.maxRetries = maxRetries;
  }
  async call(method, params) {
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await this.fetchFn(this.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
      } catch (e) {
        if (attempt >= this.maxRetries) throw new Error(`${method}: ${e instanceof Error ? e.message : String(e)}`);
        await this.sleep(Math.min(3e4, 500 * 2 ** attempt));
        continue;
      }
      if (res.status === 429 || res.status >= 500) {
        if (attempt >= this.maxRetries) throw new Error(`${method}: HTTP ${res.status} after ${attempt + 1} attempts`);
        const ra = Number(res.headers.get("retry-after"));
        await this.sleep(Number.isFinite(ra) && ra > 0 ? ra * 1e3 : Math.min(3e4, 1e3 * 2 ** attempt));
        continue;
      }
      const body = await res.json();
      if (body.error) throw new Error(`${method}: ${body.error.code} ${body.error.message}`);
      return body.result;
    }
  }
  async finalizedHeight() {
    let first = "";
    try {
      const res = await this.fetchFn(this.url + "/chain", { method: "GET" });
      const b = await res.json();
      const h = typeof b?.height === "string" || typeof b?.height === "number" ? Number(b.height) : NaN;
      if (res.ok && Number.isSafeInteger(h) && h >= 0) return h;
      first = `/chain: HTTP ${res.status}`;
    } catch (e) {
      first = `/chain: ${e instanceof Error ? e.message : String(e)}`;
    }
    try {
      const r = await this.call("eth_blockNumber", []);
      if (typeof r !== "string" || !/^0x[0-9a-f]+$/i.test(r)) throw new Error("eth_blockNumber: bad result");
      return parseInt(r, 16);
    } catch (e) {
      throw new Error(`${first}; ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  async getLogs(address, from, to) {
    const r = await this.call("eth_getLogs", [{ address, fromBlock: "0x" + from.toString(16), toBlock: "0x" + to.toString(16) }]);
    if (!Array.isArray(r)) throw new Error("eth_getLogs: bad result");
    return r;
  }
};
async function syncOnce(rpc, store, opts = {}) {
  const finalized = await rpc.finalizedHeight();
  const maxRanges = opts.maxRanges ?? 200;
  const maxRange = Math.max(1, opts.maxRange ?? MAX_RANGE), minRange = Math.max(1, Math.min(maxRange, opts.minRange ?? MIN_RANGE));
  let ranges = 0, newEvents = 0, complete = true;
  for (const [address, cp] of Object.entries(store.checkpoints())) {
    let from = Math.max(cp.indexedTo + 1, cp.startBlock);
    while (from <= finalized) {
      if (ranges >= maxRanges) {
        complete = false;
        break;
      }
      let size = maxRange, logs = null, to = from;
      for (; ; ) {
        to = Math.min(finalized, from + size - 1);
        try {
          logs = await rpc.getLogs(address, from, to);
          break;
        } catch (e) {
          if (size <= minRange) throw new Error(`blocks ${from}\u2013${to}: ${e instanceof Error ? e.message : String(e)}`);
          size = Math.max(minRange, Math.floor(size / 2));
        }
      }
      const decoded = logs.map(decodeLog).filter((e) => !!e && e.contract === toHexAddress(address) && e.block >= from && e.block <= to);
      newEvents += store.add(decoded);
      store.setCheckpoint(address, to);
      ranges++;
      from = to + 1;
    }
    if (!complete) break;
  }
  store.setMeta({ lastRunAt: (opts.now || Date.now)(), finalizedSeen: finalized });
  return { finalized, newEvents, ranges, complete };
}

// src/lib/indexer/stats.ts
var ZERO = "0x0000000000000000000000000000000000000000";
var DAY_MS = 864e5;
var big = (v) => typeof v === "string" && /^(0|[1-9][0-9]{0,40})$/.test(v) ? BigInt(v) : null;
var num = (v) => {
  const b = big(v);
  return b === null ? null : Number(b);
};
function collectionStats(i) {
  const staleAfter = i.staleAfterMs ?? 3e5, maxLag = i.maxLagBlocks ?? 150;
  const asOfBlock = Math.min(i.marketIndexedTo, i.collectionIndexedTo);
  const lag = i.finalizedSeen === null ? Infinity : i.finalizedSeen - asOfBlock;
  const stale = i.lastRunAt === null || i.nowMs - i.lastRunAt > staleAfter || lag > maxLag;
  const base = (scope, needsCollectionHistory) => {
    if (i.lastRunAt === null) return { status: "unavailable", reason: "The indexer hasn't run yet.", asOfBlock: null, asOfMs: null, scope };
    if (stale) return { status: "stale", reason: `Last indexed ${Math.round((i.nowMs - i.lastRunAt) / 6e4)} min ago, ${Number.isFinite(lag) ? lag : "?"} blocks behind.`, asOfBlock, asOfMs: i.lastRunAt, scope };
    if (needsCollectionHistory && !i.collectionComplete) return { status: "partial", reason: "The collection's full history isn't indexed, so ownership-based checks may be incomplete.", asOfBlock, asOfMs: i.lastRunAt, scope };
    return { status: "indexed", reason: null, asOfBlock, asOfMs: i.lastRunAt, scope };
  };
  const MKT = "Asentify marketplace only";
  const COL = "This collection's contract";
  const owner = /* @__PURE__ */ new Map();
  const opApproved = /* @__PURE__ */ new Map();
  const tokenApproved = /* @__PURE__ */ new Map();
  const listings = /* @__PURE__ */ new Map();
  const offers = /* @__PURE__ */ new Map();
  const sales = [];
  const activity = [];
  let minted = 0, burned = 0;
  for (const e of i.events) {
    const d = e.data;
    if (e.contract === i.collection) {
      if (e.name === "Transfer") {
        const t = String(d.tokenId), from = String(d.from), to = String(d.to);
        if (from === ZERO) minted++;
        if (to === ZERO) burned++;
        if (to === ZERO) owner.delete(t);
        else owner.set(t, to);
        tokenApproved.delete(t);
        activity.push({ kind: from === ZERO ? "mint" : to === ZERO ? "burn" : "transfer", tokenId: t, from, to, price: null, at: null, block: e.block, txHash: e.txHash });
      } else if (e.name === "ApprovalForAll" && d.operator === i.market) {
        opApproved.set(String(d.owner), d.approved === true);
      } else if (e.name === "Approval") {
        tokenApproved.set(String(d.tokenId), String(d.approved));
      }
    } else if (e.contract === i.market && (d.collection === i.collection || e.name === "OfferCancelled")) {
      const at = num(d.at);
      if (e.name === "Listed") {
        const p = big(d.price), exp = num(d.expiresAt);
        if (p !== null && exp !== null) listings.set(String(d.tokenId), { seller: String(d.seller), price: p, expiresAt: exp, listingId: String(d.listingId) });
        activity.push({ kind: "listing", tokenId: String(d.tokenId), from: String(d.seller), to: null, price: p, at, block: e.block, txHash: e.txHash });
      } else if (e.name === "ListingCancelled") {
        listings.delete(String(d.tokenId));
        activity.push({ kind: "listing_cancelled", tokenId: String(d.tokenId), from: String(d.by), to: null, price: null, at, block: e.block, txHash: e.txHash });
      } else if (e.name === "Sold" || e.name === "OfferAccepted") {
        const p = big(d.price);
        listings.delete(String(d.tokenId));
        if (e.name === "OfferAccepted") offers.delete(String(d.id));
        if (p !== null && at !== null) sales.push({ tokenId: String(d.tokenId), price: p, at, seller: String(d.seller), buyer: String(d.buyer), via: e.name === "Sold" ? "listing" : "offer", block: e.block, txHash: e.txHash });
        activity.push({ kind: e.name === "Sold" ? "sale" : "offer_accepted", tokenId: String(d.tokenId), from: String(d.seller), to: String(d.buyer), price: p, at, block: e.block, txHash: e.txHash });
      } else if (e.name === "OfferMade") {
        const a = big(d.amount), exp = num(d.expiresAt);
        if (a !== null && exp !== null) offers.set(String(d.id), { tokenId: String(d.tokenId), amount: a, expiresAt: exp, bidder: String(d.bidder) });
        activity.push({ kind: "offer", tokenId: String(d.tokenId), from: String(d.bidder), to: null, price: a, at, block: e.block, txHash: e.txHash });
      } else if (e.name === "OfferCancelled" && offers.has(String(d.id))) {
        const o = offers.get(String(d.id));
        offers.delete(String(d.id));
        activity.push({ kind: "offer_cancelled", tokenId: o.tokenId, from: o.bidder, to: null, price: o.amount, at, block: e.block, txHash: e.txHash });
      }
    }
  }
  const valid = (tokenId, l) => l.expiresAt > i.nowMs && (!i.collectionComplete || owner.get(tokenId) === l.seller && (opApproved.get(l.seller) === true || tokenApproved.get(tokenId) === i.market));
  const live = Array.from(listings).filter(([t, l]) => valid(t, l));
  const floor = live.length ? live.reduce((m, [, l]) => l.price < m ? l.price : m, live[0][1].price) : null;
  const openOffers = Array.from(offers.values()).filter((o) => o.expiresAt > i.nowMs);
  const maxOf = (xs) => xs.length ? xs.reduce((m, x) => x > m ? x : m) : null;
  const window = (ms) => {
    const s2 = sales.filter((x) => x.at > i.nowMs - ms);
    return { count: s2.length, volume: s2.reduce((a, x) => a + x.price, BigInt(0)) };
  };
  return {
    floor: { value: floor, prov: base(MKT, true) },
    listedCount: { value: live.length, prov: base(MKT, true) },
    topCollectionOffer: { value: maxOf(openOffers.filter((o) => o.tokenId === "*").map((o) => o.amount)), prov: base(MKT, false) },
    topItemOffer: { value: maxOf(openOffers.filter((o) => o.tokenId !== "*").map((o) => o.amount)), prov: base(MKT, false) },
    traitOffers: { value: null, prov: { status: "unavailable", reason: "Trait offers aren't supported: traits live off-chain and can't be verified by a contract.", asOfBlock: null, asOfMs: null, scope: MKT } },
    sales24h: { value: window(DAY_MS), prov: base(MKT, false) },
    sales7d: { value: window(7 * DAY_MS), prov: base(MKT, false) },
    sales30d: { value: window(30 * DAY_MS), prov: base(MKT, false) },
    salesAll: { value: window(Number.MAX_SAFE_INTEGER), prov: base(MKT, false) },
    supply: { value: i.collectionComplete ? minted - burned : null, prov: i.collectionComplete ? base(COL, true) : { ...base(COL, true), status: i.lastRunAt === null ? "unavailable" : "partial", reason: "Needs the collection's full history from its first block." } },
    owners: { value: i.collectionComplete ? new Set(owner.values()).size : null, prov: i.collectionComplete ? base(COL, true) : { ...base(COL, true), status: i.lastRunAt === null ? "unavailable" : "partial", reason: "Needs the collection's full history from its first block." } },
    sales: sales.slice().sort((a, b) => b.at - a.at),
    activity: activity.sort((a, b) => b.block - a.block),
    openOffers
  };
}
function dailySeries(sales, nowMs, days) {
  const out = [];
  const today = Math.floor(nowMs / DAY_MS);
  for (let d = today - days + 1; d <= today; d++) {
    const ps = sales.filter((s2) => Math.floor(s2.at / DAY_MS) === d).map((s2) => s2.price).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
    const mid = ps.length ? ps.length % 2 ? ps[(ps.length - 1) / 2] : (ps[ps.length / 2 - 1] + ps[ps.length / 2]) / BigInt(2) : null;
    out.push({ day: new Date(d * DAY_MS).toISOString().slice(0, 10), sales: ps.length, volume: ps.reduce((a, x) => a + x, BigInt(0)), min: ps[0] ?? null, median: mid, max: ps.length ? ps[ps.length - 1] : null });
  }
  return out;
}

// src/lib/indexer/snapshot.ts
var SNAPSHOT_VERSION = 1;
function staleAfterMs(raw) {
  const n = Number((raw ?? "").trim());
  return Number.isFinite(n) && n >= 1 && n <= 240 ? Math.round(n * 6e4) : 5 * 6e4;
}
var STALE_AFTER_MS = staleAfterMs(typeof process !== "undefined" ? process.env.NEXT_PUBLIC_MARKET_STALE_MINUTES : void 0);
var s = (v) => v === null ? null : v.toString();
function buildSnapshot(input, lastError = null) {
  const st = collectionStats(input);
  const win = (w) => ({ value: w.value && { count: w.value.count, volume: w.value.volume.toString() }, prov: w.prov });
  return {
    version: SNAPSHOT_VERSION,
    collection: input.collection,
    market: input.market,
    generatedAt: input.nowMs,
    meta: { lastRunAt: input.lastRunAt, finalizedSeen: input.finalizedSeen, indexedTo: Math.min(input.marketIndexedTo, input.collectionIndexedTo), collectionComplete: input.collectionComplete, lastError },
    stats: {
      floor: { value: s(st.floor.value), prov: st.floor.prov },
      listedCount: st.listedCount,
      topCollectionOffer: { value: s(st.topCollectionOffer.value), prov: st.topCollectionOffer.prov },
      topItemOffer: { value: s(st.topItemOffer.value), prov: st.topItemOffer.prov },
      traitOffers: { value: null, prov: st.traitOffers.prov },
      sales24h: win(st.sales24h),
      sales7d: win(st.sales7d),
      sales30d: win(st.sales30d),
      salesAll: win(st.salesAll),
      supply: st.supply,
      owners: st.owners
    },
    series30d: dailySeries(st.sales, input.nowMs, 30).map((p) => ({ day: p.day, sales: p.sales, volume: p.volume.toString(), min: s(p.min), median: s(p.median), max: s(p.max) })),
    activity: st.activity.slice(0, 50).map((a) => ({ ...a, price: s(a.price) }))
  };
}

// indexer/sqliteStore.ts
import { DatabaseSync } from "node:sqlite";
var SqliteStore = class {
  constructor(path) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS events (key TEXT PRIMARY KEY, block INTEGER NOT NULL, log_index INTEGER NOT NULL,
        tx TEXT NOT NULL, contract TEXT NOT NULL, name TEXT NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS events_contract_block ON events (contract, block, log_index);
      CREATE TABLE IF NOT EXISTS checkpoints (address TEXT PRIMARY KEY, start_block INTEGER NOT NULL, indexed_to INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS token_owners (collection TEXT NOT NULL, token_id TEXT NOT NULL, owner TEXT,
        checked_block INTEGER NOT NULL, checked_at INTEGER NOT NULL, PRIMARY KEY (collection, token_id));`);
  }
  watch(address, startBlock) {
    this.db.prepare("INSERT OR IGNORE INTO checkpoints (address, start_block, indexed_to) VALUES (?, ?, ?)").run(toHexAddress(address), startBlock, startBlock - 1);
  }
  checkpoints() {
    const out = {};
    for (const r of this.db.prepare("SELECT address, start_block, indexed_to FROM checkpoints").all())
      out[r.address] = { startBlock: r.start_block, indexedTo: r.indexed_to };
    return out;
  }
  setCheckpoint(address, indexedTo) {
    this.db.prepare("UPDATE checkpoints SET indexed_to = ? WHERE address = ?").run(indexedTo, address);
  }
  insert(events) {
    const ins = this.db.prepare("INSERT OR IGNORE INTO events (key, block, log_index, tx, contract, name, data) VALUES (?, ?, ?, ?, ?, ?, ?)");
    let n = 0;
    for (const e of events) n += Number(ins.run(e.key, e.block, e.logIndex, e.txHash, e.contract, e.name, JSON.stringify(e.data)).changes);
    return n;
  }
  tx(fn) {
    this.db.exec("BEGIN");
    try {
      const r = fn();
      this.db.exec("COMMIT");
      return r;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }
  add(events) {
    return this.tx(() => this.insert(events));
  }
  /**
   * Receipt path: events, the checkpoints of `addresses` and the chain cursor (last block number + hash, used for
   * the parentHash continuity check) are written in ONE transaction, so a crash can't leave them out of step.
   * Checkpoints only ever move forward.
   */
  commitRange(events, addresses, to, cursor) {
    return this.tx(() => {
      const n = this.insert(events);
      const up = this.db.prepare("UPDATE checkpoints SET indexed_to = ? WHERE address = ? AND indexed_to < ?");
      for (const a of addresses) up.run(to, a, to);
      if (cursor) {
        const kv = this.db.prepare("INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v");
        kv.run("cursorNumber", String(cursor.number));
        kv.run("cursorHash", cursor.hash);
      }
      return n;
    });
  }
  cursor() {
    const g2 = (k) => this.db.prepare("SELECT v FROM meta WHERE k = ?").get(k)?.v;
    const n = Number(g2("cursorNumber")), h = g2("cursorHash");
    return Number.isSafeInteger(n) && h ? { number: n, hash: h } : null;
  }
  events(contracts) {
    const rows = contracts && contracts.length ? this.db.prepare(`SELECT * FROM events WHERE contract IN (${contracts.map(() => "?").join(",")}) ORDER BY block, log_index`).all(...contracts) : this.db.prepare("SELECT * FROM events ORDER BY block, log_index").all();
    return rows.map((r) => ({ key: r.key, block: r.block, logIndex: r.log_index, txHash: r.tx, contract: r.contract, name: r.name, data: JSON.parse(r.data) }));
  }
  meta() {
    const g2 = (k) => {
      const r = this.db.prepare("SELECT v FROM meta WHERE k = ?").get(k);
      return r ? Number(r.v) : null;
    };
    return { lastRunAt: g2("lastRunAt"), finalizedSeen: g2("finalizedSeen") };
  }
  setMeta(m) {
    const up = this.db.prepare("INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v");
    up.run("lastRunAt", String(m.lastRunAt));
    up.run("finalizedSeen", String(m.finalizedSeen));
  }
  /** Owners read from the chain (ownerOf) by the verification step. owner null = token doesn't exist. */
  verifiedOwners(collection) {
    return this.db.prepare("SELECT token_id, owner, checked_block FROM token_owners WHERE collection = ?").all(collection).map((r) => ({ tokenId: r.token_id, owner: r.owner, checkedBlock: r.checked_block }));
  }
  setVerifiedOwners(collection, rows, at) {
    this.tx(() => {
      const up = this.db.prepare(`INSERT INTO token_owners (collection, token_id, owner, checked_block, checked_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(collection, token_id) DO UPDATE SET owner = excluded.owner, checked_block = excluded.checked_block, checked_at = excluded.checked_at`);
      for (const r of rows) up.run(collection, r.tokenId, r.owner, r.checkedBlock, at);
    });
  }
  getKV(k) {
    return this.db.prepare("SELECT v FROM meta WHERE k = ?").get(k)?.v ?? null;
  }
  setKV(k, v) {
    this.db.prepare("INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").run(k, v);
  }
  close() {
    this.db.close();
  }
};

// indexer/chainRpc.ts
var RpcError = class extends Error {
  constructor(message, retryable, timedOut = false) {
    super(message);
    this.retryable = retryable;
    this.timedOut = timedOut;
  }
};
var ChainRpc = class {
  constructor(url, opts = {}) {
    this.url = url;
    this.last = 0;
    this.nextId = 1;
    /** Requests made (for logging / tests). */
    this.requests = 0;
    this.timeoutMs = opts.timeoutMs ?? 35e3;
    this.maxRetries = opts.maxRetries ?? 5;
    this.minIntervalMs = opts.minIntervalMs ?? 100;
    this.maxBatch = Math.max(1, opts.maxBatch ?? 20);
    this.batchCap = this.maxBatch;
    this.batchCeil = this.maxBatch;
    this.f = opts.fetchFn ?? ((u, init) => fetch(u, init));
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }
  /** One HTTP POST with timeout + retries. The timeout covers the WHOLE request, body included. */
  async post(body, label, maxRetries = this.maxRetries, path = "") {
    for (let attempt = 0; ; attempt++) {
      const wait = this.last + this.minIntervalMs - Date.now();
      if (wait > 0) await this.sleep(wait);
      this.last = Date.now();
      this.requests++;
      let status = 0, text = "", retryAfter = null;
      try {
        const res = await this.f(this.url + path, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.timeoutMs)
        });
        status = res.status;
        retryAfter = res.headers.get("retry-after");
        text = await res.text();
      } catch (e) {
        const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
        const msg = timedOut ? `timeout after ${this.timeoutMs} ms` : String(e instanceof Error ? e.message : e);
        if (attempt >= maxRetries) throw new RpcError(`${label}: ${msg} (after ${attempt + 1} attempt${attempt ? "s" : ""})`, true, timedOut);
        await this.sleep(this.backoff(attempt));
        continue;
      }
      if (status === 429 || status >= 500) {
        if (attempt >= maxRetries) throw new RpcError(`${label}: HTTP ${status} after ${attempt + 1} attempts`, true, status >= 500);
        const ra = Number(retryAfter);
        await this.sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra, 120) * 1e3 : this.backoff(attempt));
        continue;
      }
      try {
        return JSON.parse(text);
      } catch {
        throw new RpcError(`${label}: HTTP ${status}, not JSON: ${text.slice(0, 80)}`, false);
      }
    }
  }
  backoff(attempt) {
    return Math.min(3e4, 1e3 * 2 ** attempt) * (0.75 + Math.random() * 0.5);
  }
  async call(method, params) {
    const body = await this.post({ jsonrpc: "2.0", id: this.nextId++, method, params }, method);
    if (body && body.error) throw new RpcError(`${method}: ${body.error.code} ${body.error.message}`, false);
    if (!body || !("result" in body)) throw new RpcError(`${method}: response without result`, false);
    return body.result;
  }
  /**
   * Batch call. Results come back in request order, matched by id. Entries the server dropped or answered with an
   * error are retried ONE BY ONE; if any still fails, the whole batch throws (the caller retries the range later).
   *
   * Adaptive size: the gateway answers a batch only when all of it is done, so a big batch on a busy chain can pass
   * the timeout or overload the gateway (HTTP 502/503/504 seen on the testnet). Such a batch is split in half and
   * retried, down to single calls (which get the full retries), and later batches never grow back to a failed size.
   */
  async batch(calls, label = "batch") {
    const out = [];
    for (let i = 0; i < calls.length; ) {
      const size = Math.max(1, Math.min(this.batchCap, calls.length - i));
      const part = calls.slice(i, i + size);
      try {
        out.push(...await this.batchOnce(part, label));
        i += size;
        if (this.batchCap < this.batchCeil) this.batchCap = Math.min(this.batchCeil, this.batchCap + 1);
      } catch (e) {
        if (e instanceof RpcError && e.timedOut && size > 1) {
          this.batchCeil = Math.max(1, Math.min(this.batchCeil, size - 1));
          this.batchCap = Math.max(1, Math.floor(size / 2));
          this.onEvent?.(`${label}: ${size} calls in one request failed (${e.message.replace(/^.*?: /, "")}); retrying in batches of ${this.batchCap}`);
          continue;
        }
        throw e;
      }
    }
    return out;
  }
  async batchOnce(calls, label) {
    if (!calls.length) return [];
    if (calls.length === 1) return [await this.call(calls[0].method, calls[0].params)];
    const base = this.nextId;
    this.nextId += calls.length;
    const body = await this.post(calls.map((c, i) => ({ jsonrpc: "2.0", id: base + i, method: c.method, params: c.params })), `${label} x${calls.length}`, Math.min(1, this.maxRetries));
    const byId = /* @__PURE__ */ new Map();
    if (Array.isArray(body)) {
      for (const r of body) if (r && typeof r.id === "number") byId.set(r.id, r);
    }
    const out = new Array(calls.length);
    for (let i = 0; i < calls.length; i++) {
      const r = byId.get(base + i);
      if (r && !r.error && "result" in r) out[i] = r.result;
      else out[i] = await this.call(calls[i].method, calls[i].params);
    }
    return out;
  }
  /**
   * Read-only contract call through the gateway's REST POST /view, exactly as the official @asentum/connect client
   * does: body {contract (hex), method, args}, answer {ok, returnValue} or {ok:false, reason}.
   */
  async view(contract, method, args) {
    const body = await this.post({ contract, method, args }, `view ${method}`, this.maxRetries, "/view");
    if (body && body.ok === true) return { ok: true, value: body.returnValue };
    return { ok: false, reason: String(body?.reason ?? body?.error ?? "view failed").slice(0, 200) };
  }
  /** Current owner (lowercase hex), null if the token doesn't exist (burned / never minted), undefined if unknown. */
  async ownerOf(collection, tokenId) {
    const r = await this.view(collection, "ownerOf", [tokenId]);
    if (r.ok) {
      const v = typeof r.value === "string" ? r.value.trim().toLowerCase() : "";
      if (/^0x[0-9a-f]{40}$/.test(v)) return v;
      try {
        return toHexAddress(v);
      } catch {
        return void 0;
      }
    }
    const ex = await this.view(collection, "exists", [tokenId]);
    return ex.ok && ex.value === false ? null : void 0;
  }
  /** Finalized height: the "finalized" tag (verified on testnet), falling back to eth_blockNumber. */
  async finalizedHeight() {
    try {
      const b = await this.call("eth_getBlockByNumber", ["finalized", false]);
      const n = b ? parseQuantity(b.number) : null;
      if (n !== null) return n;
    } catch {
    }
    const h = parseQuantity(await this.call("eth_blockNumber", []));
    if (h === null) throw new RpcError("eth_blockNumber: bad result", false);
    return h;
  }
  async getLogs(address, from, to) {
    const r = await this.call("eth_getLogs", [{ address, fromBlock: hex(from), toBlock: hex(to) }]);
    if (!Array.isArray(r)) throw new RpcError("eth_getLogs: bad result", false);
    return r;
  }
  /** Blocks [from..to] with transaction hashes. A null block (not served by this node) is returned as null. */
  getBlocks(from, to) {
    const calls = [];
    for (let n = from; n <= to; n++) calls.push({ method: "eth_getBlockByNumber", params: [hex(n), false] });
    return this.batch(calls, `blocks ${from}-${to}`);
  }
  getReceipts(hashes) {
    return this.batch(hashes.map((h) => ({ method: "eth_getTransactionReceipt", params: [h] })), "receipts");
  }
};
var hex = (n) => "0x" + n.toString(16);
function parseQuantity(v) {
  if (typeof v !== "string" || !/^0x[0-9a-f]{1,14}$/i.test(v)) return null;
  const n = parseInt(v, 16);
  return Number.isSafeInteger(n) ? n : null;
}

// indexer/receiptSync.ts
var IntegrityError = class extends Error {
};
async function scanRange(src, from, to, watched, opts = {}) {
  const blocks = await src.getBlocks(from, to);
  if (blocks.length !== to - from + 1) throw new IntegrityError(`blocks ${from}-${to}: got ${blocks.length} results`);
  const txs = [];
  let prev = opts.expectParent ?? null;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i], want = from + i;
    if (!b) throw new IntegrityError(`block ${want} is not served by this node (history may start later)`);
    const n = parseQuantity(b.number);
    if (n !== want) throw new IntegrityError(`asked for block ${want}, got ${b.number}`);
    if (!isHash(b.hash)) throw new IntegrityError(`block ${want}: bad hash`);
    if (prev && prev.number === want - 1 && b.parentHash && b.parentHash.toLowerCase() !== prev.hash.toLowerCase())
      throw new IntegrityError(`block ${want}: parentHash ${short(b.parentHash)} \u2260 hash of block ${want - 1} ${short(prev.hash)} \u2014 chain changed, refusing to continue`);
    prev = { number: want, hash: b.hash.toLowerCase() };
    for (const t of b.transactions || []) {
      const h = typeof t === "string" ? t : t?.hash;
      if (!isHash(h)) throw new IntegrityError(`block ${want}: bad transaction hash`);
      txs.push({ hash: h.toLowerCase(), block: b, n: want });
    }
  }
  const size = Math.max(1, opts.receiptsPerBatch ?? 50);
  const events = [];
  let receipts = 0;
  for (let i = 0; i < txs.length; i += size) {
    const part = txs.slice(i, i + size);
    const rs = await src.getReceipts(part.map((t) => t.hash));
    if (rs.length !== part.length) throw new IntegrityError(`receipts: asked ${part.length}, got ${rs.length}`);
    for (let j = 0; j < part.length; j++) {
      const r = rs[j], t = part[j];
      if (!r) throw new IntegrityError(`tx ${short(t.hash)} in block ${t.n}: no receipt`);
      if (String(r.transactionHash).toLowerCase() !== t.hash) throw new IntegrityError(`tx ${short(t.hash)}: receipt is for ${short(r.transactionHash)}`);
      if (parseQuantity(r.blockNumber) !== t.n) throw new IntegrityError(`tx ${short(t.hash)}: receipt says block ${r.blockNumber}, block list says ${t.n}`);
      if (r.blockHash && r.blockHash.toLowerCase() !== t.block.hash.toLowerCase()) throw new IntegrityError(`tx ${short(t.hash)}: receipt blockHash differs from block ${t.n}`);
      receipts++;
      for (const l of r.logs || []) {
        let addr;
        try {
          addr = toHexAddress(String(l.address));
        } catch {
          continue;
        }
        if (!watched.has(addr)) continue;
        if (l.logIndex === void 0 || l.logIndex === null) throw new IntegrityError(`tx ${short(t.hash)}: log without logIndex \u2014 duplicate protection needs it`);
        const li = typeof l.logIndex === "number" ? "0x" + l.logIndex.toString(16) : String(l.logIndex);
        const raw = { address: l.address, topics: l.topics, data: l.data, blockNumber: l.blockNumber || t.block.number, transactionHash: l.transactionHash || t.hash, logIndex: li, removed: l.removed };
        const e = decodeLog(raw);
        if (e) events.push(e);
      }
    }
  }
  return { events, last: prev, receipts, txs: txs.length };
}
async function syncReceipts(src, store, opts = {}) {
  const finalized = await src.finalizedHeight();
  const per = Math.max(1, Math.min(100, opts.blocksPerBatch ?? 20));
  const maxBlocks = Math.max(per, opts.maxBlocks ?? 5e3);
  const cps = store.checkpoints();
  const next = {};
  for (const [a, cp] of Object.entries(cps)) next[a] = Math.max(cp.indexedTo + 1, cp.startBlock);
  const pending = () => Object.values(next).filter((n) => n <= finalized);
  let newEvents = 0, blocks = 0, receipts = 0, first = null, lastTo = null;
  let cursor = store.cursor();
  while (pending().length) {
    if (blocks >= maxBlocks) break;
    const from = Math.min(...pending());
    const to = Math.min(finalized, from + per - 1);
    const active = Object.keys(next).filter((a) => next[a] <= from);
    const expectParent = cursor && cursor.number === from - 1 ? cursor : null;
    const r = await scanRange(src, from, to, new Set(active), { receiptsPerBatch: opts.receiptsPerBatch, expectParent });
    newEvents += store.commitRange(r.events.filter((e) => e.block >= from && e.block <= to), active, to, r.last);
    for (const a of active) next[a] = to + 1;
    cursor = r.last;
    blocks += to - from + 1;
    receipts += r.receipts;
    if (first === null) first = from;
    lastTo = to;
  }
  store.setMeta({ lastRunAt: (opts.now || Date.now)(), finalizedSeen: finalized });
  const complete = pending().length === 0;
  opts.log?.(`receipts: blocks ${first ?? "-"}\u2013${lastTo ?? "-"} (${blocks}), ${receipts} receipts, +${newEvents} events${complete ? "" : " (catching up)"}`);
  return { finalized, newEvents, blocks, receipts, complete, from: first, to: lastTo };
}
var isHash = (h) => typeof h === "string" && /^0x[0-9a-fA-F]{64}$/.test(h);
var short = (h) => typeof h === "string" ? h.slice(0, 10) + "\u2026" : String(h);

// indexer/logSync.ts
var LOGS_MAX_RANGE = 500;
var LOGS_MIN_RANGE = 50;
async function syncLogs(rpc, store, opts = {}) {
  const finalized = await rpc.finalizedHeight();
  const maxRange = Math.max(1, opts.maxRange ?? LOGS_MAX_RANGE);
  const minRange = Math.max(1, Math.min(maxRange, opts.minRange ?? LOGS_MIN_RANGE));
  const maxRanges = opts.maxRanges ?? 400;
  let ranges = 0, newEvents = 0, fallbacks = 0, complete = true;
  for (const [address, cp] of Object.entries(store.checkpoints())) {
    let from = Math.max(cp.indexedTo + 1, cp.startBlock);
    let size = maxRange;
    const first = from, started = Date.now();
    let found = 0, sinceLog = 0;
    if (from <= finalized) opts.log?.(`logs: ${address.slice(0, 10)}\u2026 blocks ${from}-${finalized} (${finalized - from + 1} to read)`);
    while (from <= finalized) {
      if (ranges >= maxRanges || opts.deadline && (opts.clock ?? Date.now)() > opts.deadline) {
        complete = false;
        break;
      }
      const to = Math.min(finalized, from + size - 1);
      let events;
      try {
        const logs = await rpc.getLogs(address, from, to);
        events = logs.map((l) => decodeLog(l)).filter((e) => !!e && e.contract === toHexAddress(address) && e.block >= from && e.block <= to);
        if (size < maxRange) size = Math.min(maxRange, size * 2);
      } catch (e) {
        if (size > minRange) {
          size = Math.max(minRange, Math.floor(size / 2));
          continue;
        }
        if (!opts.fallback) throw new Error(`eth_getLogs blocks ${from}-${to}: ${e instanceof Error ? e.message : String(e)}`);
        if (opts.deadline && (opts.clock ?? Date.now)() > opts.deadline) {
          complete = false;
          break;
        }
        opts.log?.(`eth_getLogs failed for ${address} ${from}-${to}; reading these blocks from receipts instead`);
        events = (await scanRange(opts.fallback, from, to, /* @__PURE__ */ new Set([toHexAddress(address)]))).events;
        fallbacks++;
      }
      const added = store.add(events);
      newEvents += added;
      found += added;
      store.setCheckpoint(address, to);
      ranges++;
      from = to + 1;
      if (++sinceLog >= 20 || from > finalized) {
        sinceLog = 0;
        const pct = Math.floor((to - first + 1) / Math.max(1, finalized - first + 1) * 100);
        opts.log?.(`logs: ${address.slice(0, 10)}\u2026 up to block ${to} (${pct}%), +${found} events, ${Math.round((Date.now() - started) / 1e3)} s`);
      }
    }
    if (!complete) break;
  }
  store.setMeta({ lastRunAt: (opts.now || Date.now)(), finalizedSeen: finalized });
  return { finalized, newEvents, ranges, fallbacks, complete };
}

// src/lib/indexer/attribution.ts
var NFT_EVENTS = /* @__PURE__ */ new Set(["Transfer", "Approval", "ApprovalForAll"]);
function isNftShaped(e) {
  const d = e.data;
  if (!NFT_EVENTS.has(e.name) || typeof d.collection !== "string") return false;
  return e.name === "ApprovalForAll" ? typeof d.operator === "string" : d.tokenId !== void 0 && d.tokenId !== null;
}
function attributeEvents(events, market, collections) {
  if (!market) return events;
  return events.map((e) => {
    if (e.contract !== market || !isNftShaped(e)) return e;
    const c = String(e.data.collection).toLowerCase();
    return collections.has(c) ? { ...e, contract: c } : e;
  });
}

// indexer/ownership.ts
var ZERO2 = "0x0000000000000000000000000000000000000000";
var SYNTHETIC_TX = "0x" + "0".repeat(64);
function replayOwners(events, collection) {
  const owner = /* @__PURE__ */ new Map(), lastBlock = /* @__PURE__ */ new Map();
  for (const e of events) {
    if (e.contract !== collection || e.name !== "Transfer" || e.data.tokenId === void 0) continue;
    const t = String(e.data.tokenId), to = String(e.data.to).toLowerCase();
    if (to === ZERO2) owner.delete(t);
    else owner.set(t, to);
    lastBlock.set(t, e.block);
  }
  return { owner, lastBlock };
}
function corrections(events, collection, verified, atBlock) {
  const { owner, lastBlock } = replayOwners(events, collection);
  const fixes = [], mismatches = [];
  let i = 0;
  for (const v of verified) {
    if (v.checkedBlock < (lastBlock.get(v.tokenId) ?? -1)) continue;
    const fromEvents = owner.get(v.tokenId) ?? null, onChain = v.owner;
    if (fromEvents === onChain) continue;
    mismatches.push(`token ${v.tokenId}: events say ${fromEvents ?? "none"}, chain says ${onChain ?? "none"}`);
    fixes.push({
      key: `verify:${collection}:${v.tokenId}`,
      block: atBlock,
      logIndex: 1e9 + i++,
      txHash: SYNTHETIC_TX,
      contract: collection,
      name: "Transfer",
      data: { from: fromEvents ?? ZERO2, to: onChain ?? ZERO2, tokenId: v.tokenId, collection, synthetic: true }
    });
  }
  return { fixes, mismatches };
}
function tokensToVerify(events, collection, verified, rotateFrom, opts = {}) {
  const { owner, lastBlock } = replayOwners(events, collection);
  const all = [.../* @__PURE__ */ new Set([...lastBlock.keys(), ...verified.keys()])].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0);
  const max = opts.max ?? 100, sample = opts.sample ?? 25;
  const changed = all.filter((t) => (verified.get(t) ?? -1) < (lastBlock.get(t) ?? -1)).slice(0, max);
  const rest = all.filter((t) => !changed.includes(t));
  const start = rotateFrom === null ? 0 : Math.max(0, rest.findIndex((t) => BigInt(t) > BigInt(rotateFrom)));
  const rotated = [...rest.slice(start), ...rest.slice(0, start)].slice(0, Math.max(0, Math.min(sample, max - changed.length)));
  void owner;
  return { tokens: [...changed, ...rotated], next: rotated.length ? rotated[rotated.length - 1] : rotateFrom };
}

// indexer/catalog.ts
var PER_COLLECTION = 24;
var TOTAL_TOKENS = 96;
var GATEWAYS = ["https://ipfs.io/ipfs", "https://dweb.link/ipfs", "https://w3s.link/ipfs", "https://gateway.pinata.cloud/ipfs"];
function gatewaysFrom(raw) {
  const l = (raw || "").split(",").map((x) => x.trim().replace(/\/+$/, "")).filter((x) => /^https:\/\/[^\s"'<>]{1,200}$/.test(x));
  return l.length ? l.slice(0, 6) : GATEWAYS;
}
var IPFS = /^ipfs:\/\/([A-Za-z0-9]{20,100}(?:\/[A-Za-z0-9._\-\/]{0,200})?)$/;
var HTTPS = /^https:\/\/[^\s"'<>]{1,400}$/;
var HEX = /^0x[0-9a-f]{40}$/;
var WEI = /^[0-9]{1,40}$/;
var str = (v, max) => typeof v === "string" ? v.slice(0, max) : "";
function safeUri(v) {
  const s2 = typeof v === "string" ? v.trim() : "";
  return IPFS.test(s2) || HTTPS.test(s2) ? s2 : void 0;
}
var hexOf = (v) => {
  const s2 = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (HEX.test(s2)) return s2;
  try {
    return toHexAddress(s2);
  } catch {
    return null;
  }
};
function pickIds(listed, supply, cap = PER_COLLECTION) {
  const ids = [], seen = /* @__PURE__ */ new Set();
  for (const id of listed) if (!seen.has(id)) {
    seen.add(id);
    ids.push(id);
  }
  for (let i = supply; i >= 1 && ids.length < Math.max(cap, listed.length); i--) {
    const id = String(i);
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return { ids, more: supply > ids.length };
}
async function fetchThrough(uri, fetchText, gateways = GATEWAYS, timeoutMs = 1e4) {
  const m = IPFS.exec(uri);
  const urls = m ? gateways.map((g2) => `${g2}/${m[1]}`) : HTTPS.test(uri) ? [uri] : [];
  if (!urls.length) return null;
  return new Promise((resolve) => {
    let left = urls.length;
    for (const u of urls) {
      fetchText(u, timeoutMs).catch(() => null).then((t) => {
        if (t) resolve(t);
        else if (--left === 0) resolve(null);
      });
    }
  });
}
function parseJson(t) {
  if (!t || t.length > 2e5) return null;
  try {
    const v = JSON.parse(t);
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}
function attrs(v) {
  if (!Array.isArray(v)) return void 0;
  const out = [];
  for (const a of v.slice(0, 30)) {
    if (!a || typeof a !== "object") continue;
    const t = str(a.trait_type, 60), x = a.value;
    if (t && typeof x === "string") out.push({ trait_type: t, value: x.slice(0, 120) });
    else if (t && typeof x === "number" && Number.isFinite(x)) out.push({ trait_type: t, value: x });
  }
  return out.length ? out : void 0;
}
async function pool(items, size, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) {
      const x = items[i++];
      try {
        await fn(x);
      } catch {
      }
    }
  }));
}
async function buildCatalog(o) {
  const now = o.now ?? Date.now, started = now(), deadline = started + (o.deadlineMs ?? 12e4);
  const out = [];
  let budget = TOTAL_TOKENS;
  const stat = { uris: 0, metaOk: 0, noUri: 0, unreadable: 0, sample: "" };
  const val = async (c, m, a) => {
    const r = await o.view(c, m, a).catch(() => null);
    return r && r.ok ? r.value : void 0;
  };
  for (const src of o.collections) {
    if (now() > deadline) {
      o.log?.("catalog: time budget reached, remaining collections left out");
      break;
    }
    let hex2;
    try {
      hex2 = toHexAddress(src.address);
    } catch {
      continue;
    }
    const [name, symbol, total, curi, minted] = await Promise.all([val(hex2, "name", []), val(hex2, "symbol", []), val(hex2, "totalSupply", []), val(hex2, "collectionURI", []), val(hex2, "totalMinted", [])]);
    if (typeof name !== "string" || !/^[0-9]{1,15}$/.test(String(total))) continue;
    const supply = Number(total);
    const top = /^[0-9]{1,15}$/.test(String(minted)) && Number(minted) > supply ? Number(minted) : supply;
    const listed = /* @__PURE__ */ new Map();
    for (let page = 0; page < 10; page++) {
      const r = await val(o.market, "listingsOf", [hex2, String(page * 100), "100"]);
      if (!r || !Array.isArray(r.items)) break;
      for (const it of r.items) {
        const l = it || {};
        const id = String(l.tokenId ?? ""), price = String(l.price ?? ""), exp = Number(l.expiresAt);
        if (/^[1-9][0-9]{0,29}$/.test(id) && WEI.test(price) && !(Number.isFinite(exp) && exp <= now())) listed.set(id, { price, listingId: String(l.listingId ?? "") });
      }
      if ((page + 1) * 100 >= Number(r.total ?? 0)) break;
    }
    const col = { address: hex2, name: str(name, 64), symbol: str(symbol, 16), supply, unverified: src.unverified, listedCount: listed.size, floor: null, tokens: [], moreTokens: false };
    const prices = [...listed.values()].map((l) => BigInt(l.price));
    if (prices.length) col.floor = prices.reduce((m, p) => p < m ? p : m).toString();
    if (typeof curi === "string" && curi.trim()) {
      const j = parseJson(await fetchThrough(curi.trim(), o.fetchText, o.gateways));
      if (j) {
        col.logo = safeUri(j.image);
        col.banner = safeUri(j.banner_image);
      }
    }
    const pick = pickIds([...listed.keys()], top);
    col.moreTokens = pick.more;
    const take = pick.ids.slice(0, Math.max(0, Math.min(pick.ids.length, budget)));
    budget -= take.length;
    const toks = /* @__PURE__ */ new Map();
    await pool(take, 6, async (id) => {
      if (now() > deadline) return;
      const [ownerRaw, uri] = await Promise.all([val(hex2, "ownerOf", [id]), val(hex2, "tokenURI", [id])]);
      if (ownerRaw === void 0 && await val(hex2, "exists", [id]) === false) return;
      const l = listed.get(id);
      const t = { id, name: `${col.name} #${id}`, owner: hexOf(ownerRaw), ...l ? { price: l.price, listingId: l.listingId } : {} };
      if (typeof uri === "string" && uri.trim()) {
        stat.uris++;
        const j = parseJson(await fetchThrough(uri.trim(), o.fetchText, o.gateways));
        if (!j) {
          stat.unreadable++;
          if (!stat.sample) stat.sample = uri.trim().slice(0, 80);
          const su = safeUri(uri);
          if (su) t.uri = su;
        }
        if (j) {
          stat.metaOk++;
          const n = str(j.name, 200).trim();
          if (n) t.name = n;
          t.image = safeUri(j.image);
          t.preview = safeUri(j.image_preview);
          t.attributes = attrs(j.attributes);
          if (!t.image) delete t.image;
          if (!t.preview) delete t.preview;
          if (!t.attributes) delete t.attributes;
        }
      }
      toks.set(id, t);
    });
    col.tokens = take.map((id) => toks.get(id)).filter((t) => !!t);
    out.push(col);
  }
  o.log?.(`catalog: metadata read for ${stat.metaOk} of ${stat.uris} NFTs with a tokenURI${stat.unreadable ? ` (${stat.unreadable} unreadable, e.g. ${stat.sample})` : ""}`);
  return { version: 1, generatedAt: now(), market: o.market, collections: out };
}
var nodeFetchText = async (url, timeoutMs) => {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal, redirect: "follow", headers: { accept: "application/json,text/plain" } });
    if (!r.ok) return null;
    const len = Number(r.headers.get("content-length") || 0);
    if (len > 3e5) return null;
    return (await r.text()).slice(0, 3e5);
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
};

// indexer/worker.ts
var canReadOwners = (r) => !!r && typeof r.ownerOf === "function";
var byOrder = (a, b) => a.block - b.block || a.logIndex - b.logIndex;
async function verifyOwners(rpc, store, market, collection, collections, atBlock, opts = {}) {
  const events = attributeEvents(store.events([market, collection]), market, collections);
  const known = new Map(store.verifiedOwners(collection).map((v) => [v.tokenId, v.checkedBlock]));
  const rotKey = "verifyRotate:" + collection;
  const { tokens, next } = tokensToVerify(events, collection, known, store.getKV(rotKey), opts);
  const rows = [];
  let unknown = 0;
  for (const t of tokens) {
    let o;
    try {
      o = await rpc.ownerOf(collection, t);
    } catch {
      o = void 0;
    }
    if (o === void 0) {
      unknown++;
      continue;
    }
    rows.push({ tokenId: t, owner: o, checkedBlock: atBlock });
  }
  store.setVerifiedOwners(collection, rows, Date.now());
  if (next !== null) store.setKV(rotKey, next);
  if (tokens.length) opts.log?.(`owners: checked ${rows.length}/${tokens.length} tokens of ${collection.slice(0, 10)}\u2026 on chain${unknown ? ` (${unknown} unreadable, kept previous)` : ""}`);
  return { checked: rows.length, unknown };
}
var DISCOVER_LOOKBACK = 4e4;
var DISCOVER_MAX = 50;
var MARKET_KINDS = /* @__PURE__ */ new Set(["Listed", "Sold", "OfferMade", "OfferAccepted", "ListingCancelled"]);
var HEX40 = /^0x[0-9a-f]{40}$/;
function discoverCollections(store, market, known, marketStart, opts = {}) {
  const lookback = opts.lookback ?? DISCOVER_LOOKBACK, max = opts.max ?? DISCOVER_MAX;
  let all = [];
  try {
    const v = JSON.parse(store.getKV("discovered") || "[]");
    if (Array.isArray(v)) all = v.filter((d) => d && HEX40.test(d.address) && Number.isInteger(d.start) && Number.isInteger(d.firstSeen));
  } catch {
    all = [];
  }
  const have = /* @__PURE__ */ new Set([...known, ...all.map((d) => d.address), market]);
  const added = [];
  for (const e of store.events([market])) {
    if (all.length + added.length >= max) break;
    if (!MARKET_KINDS.has(e.name)) continue;
    const c = typeof e.data.collection === "string" ? e.data.collection.toLowerCase() : "";
    if (!HEX40.test(c) || have.has(c)) continue;
    have.add(c);
    added.push({ address: c, firstSeen: e.block, start: Math.max(marketStart, e.block - lookback) });
  }
  if (added.length) {
    all = [...all, ...added];
    store.setKV("discovered", JSON.stringify(all));
  }
  return { all, added };
}
function parseSource(v) {
  const s2 = (v || "logs").trim().toLowerCase();
  if (s2 === "logs" || s2 === "receipts" || s2 === "legacy") return s2;
  throw new Error(`SOURCE must be logs, receipts or legacy (got ${JSON.stringify(v)})`);
}
var isBlockSource = (r) => !!r && typeof r.getBlocks === "function" && typeof r.getReceipts === "function";
function parseCollections(s2) {
  return s2.split(",").map((x) => x.trim()).filter(Boolean).map((x) => {
    const [a, b, c] = x.split(":");
    const start = Number(b);
    if (!Number.isInteger(start) || start < 0) throw new Error(`bad start block in COLLECTIONS: ${x}`);
    return { address: toHexAddress(a), start, complete: c === "complete" };
  });
}
function writeAtomic(file, data) {
  const tmp = file + ".tmp";
  writeFileSync(tmp, data);
  renameSync(tmp, file);
}
async function runCycle(rpc, store, cfg, now = Date.now) {
  const market = toHexAddress(cfg.market);
  store.watch(market, cfg.marketStart);
  for (const c of cfg.collections) store.watch(c.address, c.start);
  const dOpts = typeof cfg.discover === "object" ? cfg.discover : {};
  const listed = new Set(cfg.collections.map((c) => c.address));
  const known = () => cfg.discover ? discoverCollections(store, market, listed, cfg.marketStart, dOpts) : { all: [], added: [] };
  for (const d of known().all) store.watch(d.address, d.start);
  let lastError = null, result = null;
  const cycleStart = Date.now();
  const deadline = () => cycleStart + (cfg.syncBudgetMs ?? 15 * 6e4);
  const sync = async () => {
    const source = cfg.source || "legacy";
    if (source === "receipts") {
      if (!isBlockSource(rpc)) throw new Error("SOURCE=receipts needs an RPC client that can read blocks and receipts");
      const r = await syncReceipts(rpc, store, { now, maxBlocks: cfg.maxBlocks });
      result = { finalized: r.finalized, newEvents: r.newEvents, ranges: r.blocks, complete: r.complete };
    } else if (source === "logs") {
      const r = await syncLogs(rpc, store, { now, fallback: isBlockSource(rpc) ? rpc : null, log: (m) => console.log((/* @__PURE__ */ new Date()).toISOString(), m), deadline: deadline() });
      result = { finalized: r.finalized, newEvents: r.newEvents, ranges: r.ranges, complete: r.complete };
    } else {
      result = await syncOnce(rpc, store, { now });
    }
  };
  let discovered = [];
  try {
    await sync();
    const k = known();
    discovered = k.all;
    if (k.added.length) {
      for (const d of k.added) {
        store.watch(d.address, d.start);
        console.log((/* @__PURE__ */ new Date()).toISOString(), `discovered collection ${d.address} (first marketplace event at block ${d.firstSeen}); reading from block ${d.start}`);
      }
      await sync();
    }
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
  }
  const all = [...cfg.collections, ...discovered.filter((d) => !listed.has(d.address)).map((d) => ({ address: d.address, start: d.start, complete: false }))];
  const collections = new Set(all.map((c) => c.address));
  const log = (m) => console.log((/* @__PURE__ */ new Date()).toISOString(), m);
  if (!lastError && cfg.verifyOwners !== false && canReadOwners(rpc) && Date.now() < deadline()) {
    const at = store.meta().finalizedSeen ?? 0;
    for (const c of all) {
      if (Date.now() > deadline()) {
        log("owners: out of time this cycle; checked again next cycle");
        break;
      }
      try {
        await verifyOwners(rpc, store, market, c.address, collections, at, { log });
      } catch (e) {
        log(`owners: verification skipped for ${c.address.slice(0, 10)}\u2026: ${e instanceof Error ? e.message : e}`);
      }
    }
  }
  mkdirSync(cfg.outDir, { recursive: true });
  const cps = store.checkpoints(), meta = store.meta();
  for (const c of all) {
    if (!cps[c.address]) continue;
    const attributed = attributeEvents(store.events([market, c.address]), market, collections);
    const { fixes, mismatches } = corrections(attributed, c.address, store.verifiedOwners(c.address), cps[c.address].indexedTo);
    for (const m of mismatches) log(`owners: ${c.address.slice(0, 10)}\u2026 ${m} (chain value used)`);
    const snap = buildSnapshot({
      events: fixes.length ? [...attributed, ...fixes].sort(byOrder) : attributed,
      collection: c.address,
      market,
      nowMs: now(),
      marketIndexedTo: cps[market].indexedTo,
      collectionIndexedTo: cps[c.address].indexedTo,
      finalizedSeen: meta.finalizedSeen,
      lastRunAt: meta.lastRunAt,
      collectionComplete: c.complete
    }, lastError);
    if (fixes.length) snap.activity = snap.activity.filter((a) => a.txHash !== SYNTHETIC_TX);
    writeAtomic(join(cfg.outDir, c.address + ".json"), JSON.stringify(snap));
  }
  writeAtomic(join(cfg.outDir, "collections.json"), JSON.stringify({
    verified: cfg.collections.map((c) => c.address),
    discovered: discovered.filter((d) => !listed.has(d.address)).map((d) => ({ address: d.address, firstSeen: d.firstSeen }))
  }));
  if (cfg.catalog) {
    try {
      const cat = await buildCatalog({ market, collections: all.map((c) => ({ address: c.address, unverified: !listed.has(c.address) })), view: cfg.catalog.view, fetchText: cfg.catalog.fetchText, gateways: cfg.catalog.gateways, deadlineMs: cfg.catalog.deadlineMs, now, log });
      writeAtomic(join(cfg.outDir, "catalog.json"), JSON.stringify(cat));
      log(`catalog: ${cat.collections.length} collections, ${cat.collections.reduce((n, c) => n + c.tokens.length, 0)} NFTs`);
    } catch (e) {
      log(`catalog: skipped: ${e instanceof Error ? e.message : e}`);
    }
  }
  if (lastError) throw new Error(lastError);
  return result;
}
async function main() {
  const need = (k) => {
    const v = process.env[k];
    if (!v) {
      console.error(`Missing ${k}`);
      process.exit(1);
    }
    return v;
  };
  const cfg = {
    market: need("MARKET"),
    marketStart: Number(need("MARKET_START_BLOCK")),
    collections: parseCollections(need("COLLECTIONS")),
    dbPath: process.env.DB_PATH || "./data/indexer.sqlite",
    outDir: process.env.OUT_DIR || "./data/market",
    source: parseSource(process.env.SOURCE),
    maxBlocks: Number(process.env.MAX_BLOCKS) || void 0,
    discover: (process.env.DISCOVER || "").trim().toLowerCase() === "on",
    syncBudgetMs: Number(process.env.SYNC_BUDGET_MS) || void 0
  };
  mkdirSync(join(cfg.dbPath, ".."), { recursive: true });
  const catalogOn = (process.env.CATALOG || "on").trim().toLowerCase() !== "off";
  const store = new SqliteStore(cfg.dbPath);
  const url = process.env.ASENTUM_RPC || "https://testnet.asentum.com";
  const chain = new ChainRpc(url, { timeoutMs: Number(process.env.RPC_TIMEOUT_MS) || 35e3 });
  chain.onEvent = (m) => console.log((/* @__PURE__ */ new Date()).toISOString(), "note:", m);
  const rpc = cfg.source === "legacy" ? new HttpRpc(url) : chain;
  if (catalogOn) cfg.catalog = { view: (c, m, a) => chain.view(c, m, a), fetchText: nodeFetchText, gateways: gatewaysFrom(process.env.IPFS_GATEWAYS), deadlineMs: Number(process.env.CATALOG_BUDGET_MS) || 12e4 };
  console.log((/* @__PURE__ */ new Date()).toISOString(), `indexer starting: source=${cfg.source}, rpc=${url}, db=${cfg.dbPath}`);
  const interval = Number(process.env.INTERVAL_MS || 1e4);
  let stopping = false;
  process.on("SIGINT", () => {
    stopping = true;
  });
  process.on("SIGTERM", () => {
    stopping = true;
  });
  do {
    let catchingUp = false;
    try {
      const r = await runCycle(rpc, store, cfg);
      catchingUp = !!r && !r.complete;
      console.log((/* @__PURE__ */ new Date()).toISOString(), `finalized ${r?.finalized} +${r?.newEvents} events${catchingUp ? " (catching up)" : ""}`);
    } catch (e) {
      console.error((/* @__PURE__ */ new Date()).toISOString(), "cycle failed:", e instanceof Error ? e.message : e);
    }
    if (process.env.ONCE === "1") break;
    if (!catchingUp) await new Promise((r) => setTimeout(r, interval));
  } while (!stopping);
  store.close();
}
if (process.argv[1] && /(^|[\\/])(worker\.ts|asentify-indexer\.mjs)$/.test(process.argv[1])) main();
export {
  DISCOVER_LOOKBACK,
  DISCOVER_MAX,
  discoverCollections,
  parseCollections,
  parseSource,
  runCycle,
  verifyOwners
};
