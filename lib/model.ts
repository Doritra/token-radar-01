// Token Launch Radar — valuation model (peer-radar-4).
//
// The pricing formula has not changed since version 2 — the ranking was
// never the weak point. Version 3 added a confidence score per row, each
// protocol's rank inside its own category, and eight-step structured farm
// plans. Version 4 names the peers behind each multiple (the five largest
// trading protocols in the category, with their ratios) and passes each
// row's board position into the plan generator, so plans quote the
// protocol's own rank, TVL and listing date instead of reading templated.
//
// The board ranks every protocol in the sealed snapshot that records no token
// and is not a wrapped, staked, bridged or exchange product of one that does:
// the snapshot's 40-name watchlist plus every other rankable pre-token
// protocol the same rule admits, however small. Nothing is hand-picked and no
// protocol name is ever special-cased; one function scores every row.
//
// Implied value — what a launch would be worth if the protocol's record
// stayed as it is — is built only from snapshot figures:
//
//   peers      = protocols in the same category whose token already trades
//   peerMult   = median(mcap / tvl) of those peers, ratios kept in [0.01, 3],
//                shrunk toward the global median by 8 phantom peers so a
//                category with one odd peer cannot set its own price, then
//                clamped to [0.06, 0.65]
//   base       = tvl_usd x peerMult
//   momentum   = 1 + clamp(change_7d, -30, 40) / 100 x 0.5   (null change: 1)
//   maturity   = 0.80 + 0.40 x min(age_days, 1460) / 1460    (unknown age
//                counts as 292 days: a protocol that has run for years with
//                no token has a record a launch can be priced on)
//   reach      = 1 + min(chains - 1, 5) x 0.015               (multi-chain
//                distribution is worth a small premium, never a large one)
//   implied    = round(base x momentum x maturity x reach)
//
// The peer step is the heart of it: a lending market is priced like lending
// markets that already trade, a DEX like DEXes, an RWA platform like RWA
// platforms — the market's own verdict on the category, read off the same
// snapshot, instead of one flat multiple for everything.

/** One protocol exactly as the sealed snapshot carries it (ten fields). */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's version label, named in the dashboard's methodology panel. */
export const MODEL_VERSION = 'peer-radar-4';

/** How many already-trading protocols the dashboard's comparison strip shows. */
export const LIVE_ROWS = 24;

import { farmPlan, planCapitalFor, stepText } from './farm.ts';

const DAY_MS = 86_400_000;
const RATIO_FLOOR = 0.01;
const RATIO_CAP = 3;
const SHRINK_PEERS = 8;
const MULT_FLOOR = 0.06;
const MULT_CAP = 0.65;
const MOMENTUM_FLOOR = -30;
const MOMENTUM_CAP = 40;
const MOMENTUM_WEIGHT = 0.5;
const MATURITY_BASE = 0.8;
const MATURITY_RANGE = 0.4;
const MATURITY_DAYS = 1460;
const UNKNOWN_AGE_DAYS = 292;
const REACH_PER_CHAIN = 0.015;
const REACH_MAX_CHAINS = 5;

/** Categories that are products of another protocol, never a launch of their own. */
const PRODUCT_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Cross Chain Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** A name ending in a version marker is a later pool of an existing protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** Whole words that mark a wrapped or staked product of a token that trades. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
/** Names that begin with an exchange's name are that exchange's product. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** A protocol records no token when all three token fields are null. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** A protocol the board may rank: pre-token and not another protocol's product. */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name) || WRAPPED_WORD.test(p.name) || EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

/** Whole days from `listedAt` to the snapshot's `asOf`, clamped at zero; null when unknown. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a non-empty list, computed on a sorted copy. */
function median(values: number[]): number {
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** One already-trading peer, named so the dashboard can show the multiple's basis. */
export interface PeerExample {
  name: string;
  fdv_tvl: number;
}

/** Peer statistics the model derives from the snapshot itself, once per run. */
export interface PeerStats {
  global_median: number;
  by_category: Map<string, { count: number; multiple: number; top: PeerExample[] }>;
}

/**
 * Market-cap-to-TVL ratios of the protocols whose token already trades,
 * grouped by category. Each category's multiple is its peers' median ratio
 * shrunk toward the global median, then clamped, so thin categories inherit
 * the market's general verdict instead of one peer's accident. Each category
 * also keeps its five largest peers by market cap, named, so a reader can
 * see exactly which trading protocols a row's price was read from.
 */
export function peerStats(snapshot: Snapshot): PeerStats {
  const all: number[] = [];
  const grouped = new Map<string, { ratio: number; name: string; mcap: number }[]>();
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (ratio < RATIO_FLOOR || ratio > RATIO_CAP) continue;
    all.push(ratio);
    if (p.category !== null) {
      const list = grouped.get(p.category) ?? [];
      list.push({ ratio, name: p.name, mcap: p.mcap_usd });
      grouped.set(p.category, list);
    }
  }
  const globalMedian = all.length > 0 ? median(all) : 0.23;
  const byCategory = new Map<string, { count: number; multiple: number; top: PeerExample[] }>();
  for (const [category, entries] of grouped) {
    const ratios = entries.map((e) => e.ratio);
    const shrunk = (ratios.length * median(ratios) + SHRINK_PEERS * globalMedian) / (ratios.length + SHRINK_PEERS);
    const top = [...entries]
      .sort((a, b) => b.mcap - a.mcap || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .slice(0, 5)
      .map((e) => ({ name: e.name, fdv_tvl: round4(e.ratio) }));
    byCategory.set(category, { count: ratios.length, multiple: clamp(shrunk, MULT_FLOOR, MULT_CAP), top });
  }
  return { global_median: globalMedian, by_category: byCategory };
}

/** The category multiple one protocol is priced with, how many peers set it, and the largest of them. */
function peerMultiple(p: SnapshotProtocol, stats: PeerStats): { multiple: number; peers: number; top: PeerExample[] } {
  if (p.category !== null) {
    const entry = stats.by_category.get(p.category);
    if (entry !== undefined) return { multiple: entry.multiple, peers: entry.count, top: entry.top };
  }
  return { multiple: clamp(stats.global_median, MULT_FLOOR, MULT_CAP), peers: 0, top: [] };
}

/** One protocol's full model breakdown: every multiplier the dashboard shows. */
export interface Valuation {
  implied: number;
  peer_multiple: number;
  peer_count: number;
  peer_examples: PeerExample[];
  momentum_multiplier: number;
  maturity_multiplier: number;
  reach_multiplier: number;
  age_days: number | null;
}

/** Price one pre-token protocol from its own record and its category's peers. */
export function impliedValue(p: SnapshotProtocol, asOf: string, stats: PeerStats): Valuation {
  const { multiple, peers, top } = peerMultiple(p, stats);
  const age = ageDays(asOf, p.listed_at);
  const change = p.change_7d === null ? 0 : clamp(p.change_7d, MOMENTUM_FLOOR, MOMENTUM_CAP);
  const momentumMult = 1 + (change / 100) * MOMENTUM_WEIGHT;
  const ageForModel = age ?? UNKNOWN_AGE_DAYS;
  const maturityMult = MATURITY_BASE + (Math.min(ageForModel, MATURITY_DAYS) / MATURITY_DAYS) * MATURITY_RANGE;
  const reachMult = 1 + Math.min(Math.max(p.chains.length - 1, 0), REACH_MAX_CHAINS) * REACH_PER_CHAIN;
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple * momentumMult * maturityMult * reachMult));
  return {
    implied,
    peer_multiple: round4(multiple),
    peer_count: peers,
    peer_examples: top,
    momentum_multiplier: round4(momentumMult),
    maturity_multiplier: round4(maturityMult),
    reach_multiplier: round4(reachMult),
    age_days: age,
  };
}

// ---------------------------------------------------------------- farm plans
// Farm plans live in lib/farm.ts (farmPlan): eight structured steps per
// protocol, rendered by the dashboard as a checklist and written to
// board.json as strings. This file prices; that file plans.

// ---------------------------------------------------------------- board build

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  on_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    peer_multiple: number;
    peer_count: number;
    peer_examples: PeerExample[];
    momentum_multiplier: number;
    maturity_multiplier: number;
    reach_multiplier: number;
  };
  confidence: number;
  category_rank: number;
  farm_capital_usd: number;
  farm_steps: string[];
}

/** A protocol whose token already trades: shown for comparison, never ranked. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  fdv_tvl: number | null;
}

/** A board row plus its structured farm plan, for the dashboard's checklist view. */
export interface DashboardRow extends BoardRow {
  plan: { text: string; cost: string; time: string }[];
}

/** Everything the dashboard renders. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  global_median: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: DashboardRow[];
  live: LiveRow[];
}

/**
 * How much evidence stands behind one row's price, 0 to 100: many trading
 * peers in its category, a long record, a calm week and real scale all raise
 * it; a peerless category or a violent week lowers it. It never moves the
 * ranking — it tells the reader how hard to lean on the number.
 */
export function confidenceScore(p: SnapshotProtocol, v: Valuation): number {
  let score = 25;
  if (v.peer_count >= 6) score += 30;
  else if (v.peer_count >= 3) score += 22;
  else if (v.peer_count >= 1) score += 12;
  if (v.age_days === null) score += 4;
  else if (v.age_days >= 730) score += 16;
  else if (v.age_days >= 365) score += 12;
  else if (v.age_days >= 180) score += 8;
  else score += 2;
  if (p.change_7d === null) score += 6;
  else if (Math.abs(p.change_7d) <= 5) score += 14;
  else if (Math.abs(p.change_7d) <= 15) score += 9;
  else if (Math.abs(p.change_7d) <= 30) score += 4;
  if (p.tvl_usd >= 1_000_000_000) score += 10;
  else if (p.tvl_usd >= 250_000_000) score += 8;
  else if (p.tvl_usd >= 50_000_000) score += 5;
  else score += 2;
  return Math.min(98, Math.max(5, score));
}

/** Build the ranked board: the whole watchlist plus every rankable early protocol. */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const stats = peerStats(snapshot);
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }
  const watchlist = new Set(snapshot.watchlist);
  const scored = [...chosen.values()].map((p) => ({ p, v: impliedValue(p, snapshot.as_of, stats) }));
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const categorySizes = new Map<string, number>();
  for (const s of scored) {
    const key = s.p.category ?? '(none)';
    categorySizes.set(key, (categorySizes.get(key) ?? 0) + 1);
  }
  const categorySeen = new Map<string, number>();
  return scored.map((s, i) => {
    const key = s.p.category ?? '(none)';
    const categoryRank = (categorySeen.get(key) ?? 0) + 1;
    categorySeen.set(key, categoryRank);
    const ctx = {
      rank: i + 1,
      boardSize: scored.length,
      categoryRank,
      categorySize: categorySizes.get(key) ?? 1,
    };
    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      mcap_usd: s.p.mcap_usd,
      listed_at: s.p.listed_at,
      gecko_id: s.p.gecko_id,
      symbol: s.p.symbol,
      token_status: 'pre-token',
      on_watchlist: watchlist.has(s.p.slug),
      age_days: s.v.age_days,
      implied_value_usd: s.v.implied,
      model: {
        peer_multiple: s.v.peer_multiple,
        peer_count: s.v.peer_count,
        peer_examples: s.v.peer_examples,
        momentum_multiplier: s.v.momentum_multiplier,
        maturity_multiplier: s.v.maturity_multiplier,
        reach_multiplier: s.v.reach_multiplier,
      },
      confidence: confidenceScore(s.p, s.v),
      category_rank: categoryRank,
      farm_capital_usd: planCapitalFor(s.p),
      farm_steps: farmPlan(s.p, s.v.age_days, ctx).map(stepText),
    };
  });
}

/** The already-trading comparison set, by market cap. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || (a.slug < b.slug ? -1 : 1))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      fdv_tvl: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** Board plus dashboard data, from one snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot);
  const live = liveRows(snapshot);
  const stats = peerStats(snapshot);
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    global_median: round4(stats.global_median),
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !r.on_watchlist).length,
    live_size: live.length,
    rows: board.map((r) => ({
      ...r,
      plan: farmPlan(index.get(r.slug)!, r.age_days, {
        rank: r.rank,
        boardSize: board.length,
        categoryRank: r.category_rank,
        categorySize: board.filter((x) => (x.category ?? '(none)') === (r.category ?? '(none)')).length,
      }),
    })),
    live,
  };
  return { board, radar };
}

/** Why the snapshot cannot be scored. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

/** Parse and shape-check the snapshot text. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board fails the gate's shape, or null when it passes. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100) return `board holds ${board.length} rows, under the 100-row floor`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return 'every row shares one implied value';
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** The dashboard's dataset as one script: window.RADAR, no fetch, no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
