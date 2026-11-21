// Token Launch Radar — valuation model and farm-plan generator.
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
export const MODEL_VERSION = 'peer-radar-2';

/** How many already-trading protocols the dashboard's comparison strip shows. */
export const LIVE_ROWS = 24;

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

/** Peer statistics the model derives from the snapshot itself, once per run. */
export interface PeerStats {
  global_median: number;
  by_category: Map<string, { count: number; multiple: number }>;
}

/**
 * Market-cap-to-TVL ratios of the protocols whose token already trades,
 * grouped by category. Each category's multiple is its peers' median ratio
 * shrunk toward the global median, then clamped, so thin categories inherit
 * the market's general verdict instead of one peer's accident.
 */
export function peerStats(snapshot: Snapshot): PeerStats {
  const all: number[] = [];
  const grouped = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (ratio < RATIO_FLOOR || ratio > RATIO_CAP) continue;
    all.push(ratio);
    if (p.category !== null) {
      const list = grouped.get(p.category) ?? [];
      list.push(ratio);
      grouped.set(p.category, list);
    }
  }
  const globalMedian = all.length > 0 ? median(all) : 0.23;
  const byCategory = new Map<string, { count: number; multiple: number }>();
  for (const [category, ratios] of grouped) {
    const shrunk = (ratios.length * median(ratios) + SHRINK_PEERS * globalMedian) / (ratios.length + SHRINK_PEERS);
    byCategory.set(category, { count: ratios.length, multiple: clamp(shrunk, MULT_FLOOR, MULT_CAP) });
  }
  return { global_median: globalMedian, by_category: byCategory };
}

/** The category multiple one protocol is priced with, and how many peers set it. */
function peerMultiple(p: SnapshotProtocol, stats: PeerStats): { multiple: number; peers: number } {
  if (p.category !== null) {
    const entry = stats.by_category.get(p.category);
    if (entry !== undefined) return { multiple: entry.multiple, peers: entry.count };
  }
  return { multiple: clamp(stats.global_median, MULT_FLOOR, MULT_CAP), peers: 0 };
}

/** One protocol's full model breakdown: every multiplier the dashboard shows. */
export interface Valuation {
  implied: number;
  peer_multiple: number;
  peer_count: number;
  momentum_multiplier: number;
  maturity_multiplier: number;
  reach_multiplier: number;
  age_days: number | null;
}

/** Price one pre-token protocol from its own record and its category's peers. */
export function impliedValue(p: SnapshotProtocol, asOf: string, stats: PeerStats): Valuation {
  const { multiple, peers } = peerMultiple(p, stats);
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
    momentum_multiplier: round4(momentumMult),
    maturity_multiplier: round4(maturityMult),
    reach_multiplier: round4(reachMult),
    age_days: age,
  };
}

// ---------------------------------------------------------------- farm plans

/** Capital one farm position needs, scaled to the protocol's own TVL tier. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 500;
  if (p.tvl_usd >= 250_000_000) return 250;
  if (p.tvl_usd >= 50_000_000) return 100;
  return 50;
}

/** A realistic gas budget for one transaction on the protocol's first chain. */
function gasFor(chain: string): string {
  if (chain === 'Ethereum') return 'about $6 of ETH gas';
  if (chain === 'Solana' || chain === 'Algorand' || chain === 'Stellar' || chain === 'Ripple') return 'under $0.10 of gas';
  if (chain === 'Bitcoin') return 'about $1 of BTC fees';
  if (chain === 'Tron') return 'about $1 of TRX fees';
  return 'about $1 of gas';
}

/** How long a position must be held to count, from the protocol's age. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 540) return 45;
  return 30;
}

/** The category's core farming action, naming the protocol and its first chain. */
function coreAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend')) return `Supply $${capital} of USDC on ${n}'s lending market on ${chain}, then borrow no more than 30% against it so the health factor stays safely above 1.5`;
  if (c.includes('cdp') || c.includes('stablecoin')) return `Deposit $${capital} of collateral in a ${n} vault on ${chain} and mint a small position of its stablecoin against it, keeping the collateral ratio above 200%`;
  if (c.includes('dex') || c.includes('liquidity')) return `Swap $${capital / 2} into the main pair on ${n} and add the full $${capital} as liquidity to its busiest pool on ${chain}`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('collateral')) return `Deposit $${capital} of USDC into a ${n} curated vault on ${chain} and keep the vault shares in the same wallet`;
  if (c.includes('derivative') || c.includes('perpetual')) return `Deposit $${capital} of USDC as margin on ${n} and trade one small perpetual position a week on ${chain}, keeping leverage at 2x or under`;
  if (c.includes('basis')) return `Open the $${capital} basis position ${n} offers on ${chain}: fund the account, take the hedged side it lists, and leave both legs untouched`;
  if (c.includes('rwa')) return `Subscribe $${capital} to ${n}'s tokenised real-world-asset product on ${chain} and hold the issued shares in your wallet`;
  if (c.includes('restak') || c.includes('staking')) return `Stake $${capital} of the network asset through ${n} on ${chain} and keep the staking receipt token in the same wallet`;
  if (c.includes('yield')) return `Deposit $${capital} of USDC into ${n}'s main yield vault on ${chain} and keep the vault shares in the wallet for the full hold`;
  if (c.includes('insurance')) return `Buy $${capital} of protocol cover from ${n} on ${chain} for the longest term it lists and keep the policy NFT`;
  if (c.includes('chain') || c.includes('payment')) return `Bridge $${capital} to ${chain} and make ${n}'s network your active chain: pay fees, transfer and transact there weekly`;
  if (c.includes('prediction')) return `Fund $${capital} on ${n} and take one position in its most liquid market on ${chain}`;
  if (c.includes('index')) return `Buy $${capital} of ${n}'s main index product on ${chain} and hold the index token`;
  return `Deposit $${capital} of USDC into ${n}'s main product on ${chain} and keep the position open and untouched`;
}

/**
 * One protocol's farm plan: six concrete steps, each with its cost and its
 * time, derived from the protocol's own category, chains, TVL and age — the
 * second chain when it has one, a tranche warning when its TVL is falling
 * fast, a testnet step when it is young. No step is shared verbatim between
 * two protocols unless their records match.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const chain2 = p.chains.length > 1 ? p.chains[1]! : null;
  const capital = capitalFor(p);
  const gas = gasFor(chain);
  const hold = holdDaysFor(age);
  const steps: string[] = [
    `Set up a fresh wallet for ${p.name} on ${chain}, fund it with $${capital} plus gas, and keep its seed phrase offline. Cost: ${gas} to fund. Time: 10 minutes.`,
    `${coreAction(p, capital, chain)}. Cost: $${capital} of capital plus ${gas}. Time: 15 minutes to set up.`,
  ];
  if (chain2 !== null) {
    steps.push(
      `Repeat a smaller position on ${chain2}, where ${p.name} also runs: bridge $${Math.round(capital / 2)} over and make the same core action there, so activity exists on two chains. Cost: $${Math.round(capital / 2)} of capital plus about $2 of bridge and gas fees. Time: 20 minutes.`,
    );
  } else if (age !== null && age < 365) {
    steps.push(
      `Join ${p.name}'s testnet or waitlist if it runs one — at ${age} days old it is still early — and complete every task it lists with this same wallet. Cost: testnet funds only, never real capital. Time: 30 minutes.`,
    );
  } else {
    steps.push(
      `Add a second, different action on ${p.name}: a second market, pool or vault beside the first, with $${Math.round(capital / 2)} more, so the wallet shows varied use rather than one deposit. Cost: $${Math.round(capital / 2)} of capital plus ${gas}. Time: 15 minutes.`,
    );
  }
  steps.push(
    `Open ${p.name}'s own points, rewards or quests page and finish what it lists for this wallet; if it runs none yet, join its official community channel and turn on launch announcements instead. Cost: nothing to check, and never pay anyone to claim. Time: 10 minutes a week.`,
  );
  if (p.change_7d !== null && p.change_7d <= -15) {
    steps.push(
      `Size down and stage in: ${p.name}'s TVL fell ${Math.abs(p.change_7d).toFixed(1)}% in seven days, so enter in three weekly tranches and hold the position at least ${hold} days before adding more. Cost: the $${capital} stays in the position. Time: ${hold} days.`,
    );
  } else {
    steps.push(
      `Hold the position at least ${hold} days and make one qualifying action a week — a swap, a borrow, a vote or a top-up — so the wallet appears in more than one weekly snapshot. Cost: about $2 of gas a week. Time: ${hold} days, 10 minutes a week.`,
    );
  }
  steps.push(
    `Log the wallet, the dates and every transaction hash for ${p.name} in a farm log, review it every two weeks, and claim any future distribution only from a link the protocol itself publishes. Cost: nothing. Time: 5 minutes per review.`,
  );
  return steps;
}

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
    momentum_multiplier: number;
    maturity_multiplier: number;
    reach_multiplier: number;
  };
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
  rows: BoardRow[];
  live: LiveRow[];
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
  return scored.map((s, i) => ({
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
      momentum_multiplier: s.v.momentum_multiplier,
      maturity_multiplier: s.v.maturity_multiplier,
      reach_multiplier: s.v.reach_multiplier,
    },
    farm_steps: farmSteps(s.p, s.v.age_days),
  }));
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
    rows: board,
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
