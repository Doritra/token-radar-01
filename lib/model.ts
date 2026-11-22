// Token Launch Radar — fitted valuation model (fit-radar-1).
//
// Versions 2-4 priced each protocol from its category's median peer
// multiple, with hand-set momentum, maturity and reach multipliers. That
// model was honest but hand-made, and its own audit showed the ceiling:
// on the full dev board it sat mid-pack. This version replaces every
// hand-set constant with a fit, and publishes the evidence on the page:
//
//   implied = 10^( b0 + b1*log10(TVL) + b2*momentum + b3*log10(age)
//                  + sector premium )
//
// fitted by least squares on the snapshot's traded tokens (lib/fit.ts),
// with per-row P25-P75 and P10-P90 ranges calibrated on leave-one-out
// residuals, a token-odds estimate per row Brier-scored against the base
// rate, a full 758-protocol ledger, and a costed farm verdict per row.
// Terms that made held-out predictions worse — the old multi-chain reach
// premium among them — were tested and dropped, and the evidence section
// of the dashboard prints the numbers either way.

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
export const MODEL_VERSION = 'fit-radar-1';

/** How many already-trading protocols the dashboard's comparison strip shows. */
export const LIVE_ROWS = 24;

import { farmPlan, planCapitalFor, planCosting, stepText } from './farm.ts';
import { fitModel, predict, tokenOddsModel, trainingSet, validateModel } from './fit.ts';
import type { FitReport } from './fit.ts';

const DAY_MS = 86_400_000;
const RATIO_FLOOR = 0.01;
const RATIO_CAP = 3;
const SHRINK_PEERS = 8;
const MULT_FLOOR = 0.06;
const MULT_CAP = 0.65;

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

// ---------------------------------------------------------------- farm plans
// Farm plans live in lib/farm.ts (farmPlan): eight structured steps per
// protocol, rendered by the dashboard as a checklist and written to
// board.json as strings. This file prices; that file plans.

// ---------------------------------------------------------------- board build

/** A row's farm economics at the stated assumptions (5% of supply to farmers). */
export interface FarmCosting {
  deposit_usd: number;
  fees_usd: number;
  hours: number;
  days: number;
  drop_share_pct: number;
  gross_usd: number;
  net_usd: number;
  net_per_hour: number;
  verdict: string;
}

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
    base_log: number;
    sector_premium: number;
    peer_count: number;
    peer_examples: PeerExample[];
  };
  range_low_usd: number;
  range_high_usd: number;
  range90_low_usd: number;
  range90_high_usd: number;
  token_odds: number;
  farm_costing: FarmCosting;
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
  fit_report: FitReport;
  ledger: { label: string; count: number; note: string }[];
  integrity: { rows: number; total_implied_usd: number; checksum: string };
}

/** The farm verdict for one row at the dashboard's stated assumptions. */
export function farmVerdict(netPerHour: number): string {
  if (netPerHour >= 25) return 'FARM';
  if (netPerHour >= 8) return 'MARGINAL';
  if (netPerHour >= 0) return 'THIN';
  return 'SKIP';
}

/** Price one row's farm: expected drop slice, net of fees, per hour of work. */
function farmCostingFor(p: SnapshotProtocol, age: number | null, implied: number, odds: number): FarmCosting {
  const cost = planCosting(p, age);
  const deposit = planCapitalFor(p);
  const dropShare = 0.05;
  // The drop is split equally among qualifying wallets — the way points
  // programs actually pay — with the wallet count assumed at one qualifying
  // wallet per $25k of TVL, floored at 200 and capped at 50,000. The slice
  // is weighted by the chance a token launches at all. (A pure pro-rata-by-
  // TVL split was costed first and rejected: it prices a $750 wallet's
  // slice of a large protocol at literal cents, which is not how any real
  // distribution has ever paid.)
  const wallets = Math.min(50_000, Math.max(200, Math.round(p.tvl_usd / 25_000)));
  const gross = (odds * implied * dropShare) / wallets;
  const net = gross - cost.fees_usd;
  const netPerHour = net / cost.hours;
  return {
    deposit_usd: deposit,
    fees_usd: cost.fees_usd,
    hours: cost.hours,
    days: cost.days,
    drop_share_pct: 5,
    gross_usd: Math.round(gross * 100) / 100,
    net_usd: Math.round(net * 100) / 100,
    net_per_hour: Math.round(netPerHour * 100) / 100,
    verdict: farmVerdict(netPerHour),
  };
}

/** Build the ranked board: the whole watchlist plus every rankable early protocol. */
export function buildBoard(snapshot: Snapshot, report?: FitReport): BoardRow[] {
  const stats = peerStats(snapshot);
  const fit = fitModel(trainingSet(snapshot), snapshot.as_of);
  const rep = report ?? validateModel(snapshot);
  const oddsModel = tokenOddsModel(snapshot);
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
  const scored = [...chosen.values()].map((p) => {
    const pr = predict(fit, p, snapshot.as_of);
    const premium = p.category !== null ? (fit.premia.get(p.category) ?? 0) : 0;
    const entry = p.category !== null ? stats.by_category.get(p.category) : undefined;
    return {
      p,
      implied: Math.max(1, Math.round(pr.value)),
      base_log: round4(pr.log - premium),
      sector_premium: round4(premium),
      peer_count: entry?.count ?? 0,
      peer_examples: entry?.top ?? [],
      odds: oddsModel.rates.get(p.category ?? '(none)') ?? oddsModel.base,
      age: ageDays(snapshot.as_of, p.listed_at),
    };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
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
      age_days: s.age,
      implied_value_usd: s.implied,
      model: {
        base_log: s.base_log,
        sector_premium: s.sector_premium,
        peer_count: s.peer_count,
        peer_examples: s.peer_examples,
      },
      range_low_usd: Math.max(1, Math.round(s.implied * 10 ** rep.bands.p25)),
      range_high_usd: Math.round(s.implied * 10 ** rep.bands.p75),
      range90_low_usd: Math.max(1, Math.round(s.implied * 10 ** rep.bands.p10)),
      range90_high_usd: Math.round(s.implied * 10 ** rep.bands.p90),
      token_odds: Math.round(s.odds * 1000) / 1000,
      farm_costing: farmCostingFor(s.p, s.age, s.implied, s.odds),
      category_rank: categoryRank,
      farm_capital_usd: planCapitalFor(s.p),
      farm_steps: farmPlan(s.p, s.age, ctx).map(stepText),
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

/**
 * The full ledger: every protocol in the snapshot in exactly one group, so
 * the board's exclusions are accounted for instead of invisible. Groups are
 * tested in order; the first that applies owns the protocol.
 */
export function classifyLedger(snapshot: Snapshot, board: BoardRow[]): { label: string; count: number; note: string }[] {
  const onBoard = new Set(board.map((r) => r.slug));
  const groups: { label: string; note: string; test: (p: SnapshotProtocol) => boolean }[] = [
    { label: 'Ranked on the board', note: 'pre-token and a launch candidate in its own right', test: (p) => onBoard.has(p.slug) },
    { label: 'Token trades', note: 'a market cap is recorded; these are the model\'s teachers', test: (p) => p.mcap_usd !== null && p.mcap_usd > 0 },
    { label: 'Token on record, no live cap', note: 'a token exists but no usable market cap is recorded', test: (p) => !isPreToken(p) },
    { label: 'Bridge product', note: 'a bridge moves other protocols\' tokens; it is not a launch candidate', test: (p) => p.category !== null && (p.category === 'Bridge' || p.category === 'Canonical Bridge' || p.category === 'Cross Chain Bridge') },
    { label: 'Liquid staking / restaking', note: 'the product is a claim on a staked position that already has a token', test: (p) => p.category === 'Liquid Staking' || p.category === 'Liquid Restaking' || p.category === 'Restaked BTC' },
    { label: 'Exchange custody', note: 'an exchange\'s own product, priced by the exchange, not a launch', test: (p) => p.category === 'CEX' },
    { label: 'Versioned pool', note: 'a later version of a protocol that already launched', test: (p) => VERSIONED.test(p.name) },
    { label: 'Wrapped / staked product', note: 'the name itself marks a wrapped or staked claim on another token', test: (p) => WRAPPED_WORD.test(p.name) },
    { label: 'Exchange-branded product', note: 'carries an exchange\'s name; the exchange is the issuer', test: (p) => EXCHANGE_PREFIX.test(p.name) },
    { label: 'Other pre-token', note: 'pre-token, but its category is itself a token product (restaking, indexes, staking pools)', test: () => true },
  ];
  const counts = groups.map(() => 0);
  for (const p of snapshot.protocols) {
    for (let g = 0; g < groups.length; g++) {
      if (groups[g]!.test(p)) {
        counts[g]!++;
        break;
      }
    }
  }
  return groups.map((g, i) => ({ label: g.label, count: counts[i]!, note: g.note })).filter((g) => g.count > 0);
}

/** FNV-1a checksum over the board's canonical lines: rank, slug, implied value. */
export function boardChecksum(board: BoardRow[]): string {
  let h = 0x811c9dc5;
  const text = board.map((r) => `${r.rank}|${r.slug}|${r.implied_value_usd}`).join('\n');
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Board plus dashboard data, from one snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const report = validateModel(snapshot);
  const board = buildBoard(snapshot, report);
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
    fit_report: report,
    ledger: classifyLedger(snapshot, board),
    integrity: {
      rows: board.length,
      total_implied_usd: board.reduce((s, r) => s + r.implied_value_usd, 0),
      checksum: boardChecksum(board),
    },
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
