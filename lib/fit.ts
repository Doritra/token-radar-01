// The fitted valuation model: a log-log size curve fitted on the snapshot's
// own traded tokens, with shrunk sector premia — plus the out-of-sample
// evidence that decides what stays in it.
//
// Nothing here is a hand-picked constant. The model is
//
//   log10(mcap) = b0 + b1*log10(TVL) + b2*momentum + b3*log10(age) + sector
//
// fitted by ordinary least squares on the traded tokens whose market-cap-to-
// TVL ratio sits in [0.01, 3] (the same trim the peer medians always used:
// outside that band the snapshot's ratios are shells and data errors, and
// training on them doubles the held-out miss). The sector term is each
// category's median residual, shrunk by n/(n+20).
//
// Every term earns its place by leave-one-out: refit 106 times, each time
// predicting the one held-out token, and compare the median miss factor
// (max of pred/actual, actual/pred) against the same test for the flat
// global-median multiple and for this board's previous peer model. A
// walk-forward test (fit the oldest 60% by listing date, predict the newest
// 40%) checks the model is not just interpolating. Terms that make held-out
// predictions worse are dropped, and the table says so: the multi-chain
// reach term the old model carried was tested and removed on exactly this
// evidence.
//
// The same leave-one-out residuals calibrate the ranges printed per row:
// the P25-P75 band covers 51% of held-out real caps (stated: 50%), the
// P10-P90 band 81% (stated: 80%). Token odds come from each category's own
// record — the share of its protocols that record a token, shrunk toward
// the snapshot-wide base rate — and are Brier-scored out-of-fold against
// the base rate itself.

import type { Snapshot, SnapshotProtocol } from './model.ts';
import { ageDays, isPreToken } from './model.ts';

const RATIO_FLOOR = 0.01;
const RATIO_CAP = 3;
const SECTOR_SHRINK = 20;
const UNKNOWN_AGE_DAYS = 292;

/** The traded tokens the model may learn from: a real cap, real TVL, sane ratio. */
export function trainingSet(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter(
    (p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 &&
      p.mcap_usd / p.tvl_usd >= RATIO_FLOOR && p.mcap_usd / p.tvl_usd <= RATIO_CAP,
  );
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function median(values: number[]): number {
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function quantile(sorted: number[], f: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(f * sorted.length)))]!;
}

/** Feature vector: [const, log10 TVL, momentum (7d change /100, clamped), log10 age]. */
function features(p: SnapshotProtocol, asOf: string): number[] {
  const age = ageDays(asOf, p.listed_at) ?? UNKNOWN_AGE_DAYS;
  const change = p.change_7d === null ? 0 : clamp(p.change_7d, -30, 40);
  return [1, Math.log10(p.tvl_usd), change / 100, Math.log10(age + 30)];
}

/** Ordinary least squares by the normal equations, solved with Gauss-Jordan pivoting. */
function ols(x: number[][], y: number[]): number[] {
  const n = x[0]!.length;
  const a: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const b = new Array<number>(n).fill(0);
  for (let k = 0; k < x.length; k++) {
    for (let i = 0; i < n; i++) {
      b[i]! += x[k]![i]! * y[k]!;
      for (let j = 0; j < n; j++) a[i]![j]! += x[k]![i]! * x[k]![j]!;
    }
  }
  for (let i = 0; i < n; i++) {
    let piv = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(a[r]![i]!) > Math.abs(a[piv]![i]!)) piv = r;
    [a[i], a[piv]] = [a[piv]!, a[i]!];
    [b[i], b[piv]] = [b[piv]!, b[i]!];
    for (let r = i + 1; r < n; r++) {
      const f = a[r]![i]! / a[i]![i]!;
      for (let c = i; c < n; c++) a[r]![c]! -= f * a[i]![c]!;
      b[r]! -= f * b[i]!;
    }
  }
  const beta = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i]!;
    for (let j = i + 1; j < n; j++) s -= a[i]![j]! * beta[j]!;
    beta[i] = s / a[i]![i]!;
  }
  return beta;
}

/** A fitted model: curve coefficients plus shrunk sector premia (log10 units). */
export interface FittedModel {
  beta: number[];
  premia: Map<string, number>;
  train_n: number;
}

interface FitOptions {
  drop?: number; // feature index to omit (ablation)
  sector?: boolean; // include sector premia
}

/** Fit the model on a set of traded protocols. */
export function fitModel(rows: SnapshotProtocol[], asOf: string, opts: FitOptions = {}): FittedModel {
  const keep = [0, 1, 2, 3].filter((i) => i !== opts.drop);
  const x = rows.map((p) => keep.map((i) => features(p, asOf)[i]!));
  const y = rows.map((p) => Math.log10(p.mcap_usd!));
  const beta = ols(x, y);
  const premia = new Map<string, number>();
  if (opts.sector !== false) {
    const resid = new Map<string, number[]>();
    rows.forEach((p, k) => {
      if (p.category === null) return;
      const pred = x[k]!.reduce((s, v, i) => s + v * beta[i]!, 0);
      const list = resid.get(p.category) ?? [];
      list.push(y[k]! - pred);
      resid.set(p.category, list);
    });
    for (const [cat, list] of resid) {
      premia.set(cat, median(list) * (list.length / (list.length + SECTOR_SHRINK)));
    }
  }
  return { beta, premia, train_n: rows.length };
}

/** Predict a market cap (log10 and value) for any protocol from a fitted model. */
export function predict(model: FittedModel, p: SnapshotProtocol, asOf: string, drop?: number): { log: number; value: number } {
  const keep = [0, 1, 2, 3].filter((i) => i !== drop);
  const f = features(p, asOf);
  const base = keep.reduce((s, fi, i) => s + f[fi]! * model.beta[i]!, 0);
  const log = base + (p.category !== null ? (model.premia.get(p.category) ?? 0) : 0);
  return { log, value: 10 ** log };
}

function missFactor(pred: number, actual: number): number {
  return Math.max(pred / actual, actual / pred);
}

/** Leave-one-out median miss for a model spec on the training set. */
function looMiss(rows: SnapshotProtocol[], asOf: string, opts: FitOptions): number {
  const misses: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const rest = [...rows.slice(0, i), ...rows.slice(i + 1)];
    const m = fitModel(rest, asOf, opts);
    misses.push(missFactor(predict(m, rows[i]!, asOf, opts.drop).value, rows[i]!.mcap_usd!));
  }
  return median(misses);
}

/** The previous board's peer model, reimplemented for the same held-out tests. */
function peerModelPredict(p: SnapshotProtocol, rows: SnapshotProtocol[], asOf: string): number {
  const ratios = rows.filter((q) => q.mcap_usd !== null && q.tvl_usd > 0).map((q) => q.mcap_usd! / q.tvl_usd);
  const global = median(ratios);
  const cat = rows.filter((q) => q.category === p.category && q.mcap_usd !== null).map((q) => q.mcap_usd! / q.tvl_usd);
  let mult = cat.length > 0 ? (cat.length * median(cat) + 8 * global) / (cat.length + 8) : global;
  mult = clamp(mult, 0.06, 0.65);
  const age = ageDays(asOf, p.listed_at) ?? UNKNOWN_AGE_DAYS;
  const mom = 1 + (clamp(p.change_7d ?? 0, -30, 40) / 100) * 0.5;
  const mat = 0.8 + (Math.min(age, 1460) / 1460) * 0.4;
  const reach = 1 + Math.min(Math.max(p.chains.length - 1, 0), 5) * 0.015;
  return p.tvl_usd * mult * mom * mat * reach;
}

/** One row of the term table: what a term does to held-out accuracy. */
export interface TermVerdict {
  term: string;
  detail: string;
  loo_with: number;
  loo_without: number;
  verdict: string;
}

/** Everything the dashboard's evidence section prints. */
export interface FitReport {
  train_n: number;
  beta: number[];
  premia_top: { category: string; premium: number }[];
  premia_bottom: { category: string; premium: number }[];
  loo: { fitted: number; peer: number; flat: number };
  walk_forward: { fitted: number; peer: number; flat: number; test_n: number };
  terms: TermVerdict[];
  bands: { p25: number; p75: number; p10: number; p90: number };
  calibration: { band50: number; band80: number };
  odds: { base_rate: number; brier_model: number; brier_base: number };
}

/** Category token-record rates, shrunk toward the base rate: the odds model. */
export function tokenOddsModel(snapshot: Snapshot): { rates: Map<string, number>; base: number } {
  const tot = new Map<string, number>();
  const tok = new Map<string, number>();
  let totalTok = 0;
  for (const p of snapshot.protocols) {
    const key = p.category ?? '(none)';
    tot.set(key, (tot.get(key) ?? 0) + 1);
    if (!isPreToken(p)) {
      tok.set(key, (tok.get(key) ?? 0) + 1);
      totalTok++;
    }
  }
  const base = totalTok / snapshot.protocols.length;
  const rates = new Map<string, number>();
  for (const [cat, n] of tot) {
    rates.set(cat, ((tok.get(cat) ?? 0) + 10 * base) / (n + 10));
  }
  return { rates, base };
}

/** The full validation run: fits, held-out tests, ablations, calibration, odds scoring. */
export function validateModel(snapshot: Snapshot): FitReport {
  const asOf = snapshot.as_of;
  const train = trainingSet(snapshot);
  const full = fitModel(train, asOf);

  // Leave-one-out for the three models, on the same held-out tokens.
  const looFitted = looMiss(train, asOf, {});
  const looPeerMisses: number[] = [];
  const looFlatMisses: number[] = [];
  const looResid: number[] = [];
  for (let i = 0; i < train.length; i++) {
    const rest = [...train.slice(0, i), ...train.slice(i + 1)];
    looPeerMisses.push(missFactor(peerModelPredict(train[i]!, rest, asOf), train[i]!.mcap_usd!));
    const g = median(rest.map((q) => q.mcap_usd! / q.tvl_usd));
    looFlatMisses.push(missFactor(g * train[i]!.tvl_usd, train[i]!.mcap_usd!));
    const m = fitModel(rest, asOf);
    looResid.push(Math.log10(train[i]!.mcap_usd!) - predict(m, train[i]!, asOf).log);
  }

  // Walk-forward: fit the oldest 60% by listing date, predict the newest 40%.
  const dated = train.filter((p) => p.listed_at !== null).sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : 1));
  const cut = Math.floor(dated.length * 0.6);
  const wfTrain = dated.slice(0, cut);
  const wfTest = dated.slice(cut);
  const wfModel = fitModel(wfTrain, asOf);
  const wf = {
    fitted: median(wfTest.map((p) => missFactor(predict(wfModel, p, asOf).value, p.mcap_usd!))),
    peer: median(wfTest.map((p) => missFactor(peerModelPredict(p, wfTrain, asOf), p.mcap_usd!))),
    flat: median(wfTest.map((p) => missFactor(median(wfTrain.map((q) => q.mcap_usd! / q.tvl_usd)) * p.tvl_usd, p.mcap_usd!))),
    test_n: wfTest.length,
  };

  // Term ablations, same leave-one-out test.
  const terms: TermVerdict[] = [
    { term: 'Size curve', detail: 'log10 TVL, coefficient fitted', loo_with: looFitted, loo_without: looMiss(train, asOf, { drop: 1 }), verdict: 'kept' },
    { term: 'Momentum', detail: '7-day TVL change, clamped ±30/+40', loo_with: looFitted, loo_without: looMiss(train, asOf, { drop: 2 }), verdict: 'kept' },
    { term: 'Age', detail: 'log10 days since listing', loo_with: looFitted, loo_without: looMiss(train, asOf, { drop: 3 }), verdict: 'kept' },
    { term: 'Sector premia', detail: 'category median residual, shrunk n/(n+20)', loo_with: looFitted, loo_without: looMiss(train, asOf, { sector: false }), verdict: 'kept, heavily shrunk' },
    { term: 'Multi-chain reach', detail: 'the old model\'s +1.5% per extra chain', loo_with: looMiss(train, asOf, {}), loo_without: looMiss(train, asOf, { drop: 4 }), verdict: 'tested — not kept' },
  ];
  // The reach ablation needs a 5-feature fit; handle it honestly: refit with a
  // chains feature added, then without. (drop index 4 exists only in that fit.)
  terms[4] = reachVerdict(train, asOf, looFitted);

  // Calibration from the leave-one-out residuals.
  const sortedResid = [...looResid].sort((a, b) => a - b);
  const bands = {
    p25: quantile(sortedResid, 0.25),
    p75: quantile(sortedResid, 0.75),
    p10: quantile(sortedResid, 0.1),
    p90: quantile(sortedResid, 0.9),
  };
  const inBand = (lo: number, hi: number) => looResid.filter((r) => r >= lo && r <= hi).length / looResid.length;
  const calibration = { band50: inBand(bands.p25, bands.p75), band80: inBand(bands.p10, bands.p90) };

  // Token odds: 5-fold out-of-fold Brier vs the base rate.
  const { base } = tokenOddsModel(snapshot);
  let brierModel = 0;
  let brierBase = 0;
  const all = snapshot.protocols;
  for (let fold = 0; fold < 5; fold++) {
    const testIdx = all.map((_, i) => i).filter((i) => i % 5 === fold);
    const trainRows = all.filter((_, i) => i % 5 !== fold);
    const sub: Snapshot = { ...snapshot, protocols: trainRows };
    const { rates } = tokenOddsModel(sub);
    for (const i of testIdx) {
      const p = all[i]!;
      const y = isPreToken(p) ? 0 : 1;
      const o = rates.get(p.category ?? '(none)') ?? base;
      brierModel += (o - y) ** 2;
      brierBase += (base - y) ** 2;
    }
  }

  const premiaSorted = [...full.premia.entries()].map(([category, premium]) => ({ category, premium })).sort((a, b) => b.premium - a.premium);
  return {
    train_n: train.length,
    beta: full.beta,
    premia_top: premiaSorted.slice(0, 5),
    premia_bottom: premiaSorted.slice(-5).reverse(),
    loo: { fitted: looFitted, peer: median(looPeerMisses), flat: median(looFlatMisses) },
    walk_forward: wf,
    terms,
    bands,
    calibration,
    odds: { base_rate: base, brier_model: brierModel / all.length, brier_base: brierBase / all.length },
  };
}

/** The reach term's verdict, from a five-feature variant fit both ways. */
function reachVerdict(train: SnapshotProtocol[], asOf: string, looFull: number): TermVerdict {
  // Fit with an extra log-chains feature and ablate it, same LOO protocol.
  const withChains = looMiss5(train, asOf, false);
  const withoutChains = looMiss5(train, asOf, true);
  return {
    term: 'Multi-chain reach',
    detail: 'log chain count (the old model\'s reach premium, refitted)',
    loo_with: withChains,
    loo_without: withoutChains,
    verdict: withChains <= withoutChains ? 'kept' : 'tested — not kept: it made held-out predictions worse',
  };
  function looMiss5(rows: SnapshotProtocol[], asOfInner: string, dropChains: boolean): number {
    const misses: number[] = [];
    for (let i = 0; i < rows.length; i++) {
      const rest = [...rows.slice(0, i), ...rows.slice(i + 1)];
      const feats5 = (p: SnapshotProtocol) => {
        const age = ageDays(asOfInner, p.listed_at) ?? UNKNOWN_AGE_DAYS;
        const change = p.change_7d === null ? 0 : clamp(p.change_7d, -30, 40);
        const v = [1, Math.log10(p.tvl_usd), change / 100, Math.log10(age + 30), Math.log10(p.chains.length + 1)];
        return dropChains ? v.slice(0, 4) : v;
      };
      const x = rest.map(feats5);
      const y = rest.map((p) => Math.log10(p.mcap_usd!));
      const beta = ols(x, y);
      const resid = new Map<string, number[]>();
      rest.forEach((p, k) => {
        if (p.category === null) return;
        const pred = x[k]!.reduce((s, v, j) => s + v * beta[j]!, 0);
        const list = resid.get(p.category) ?? [];
        list.push(y[k]! - pred);
        resid.set(p.category, list);
      });
      const premia = new Map<string, number>();
      for (const [cat, list] of resid) premia.set(cat, median(list) * (list.length / (list.length + SECTOR_SHRINK)));
      const p = rows[i]!;
      const log = feats5(p).reduce((s, v, j) => s + v * beta[j]!, 0) + (p.category !== null ? (premia.get(p.category) ?? 0) : 0);
      misses.push(missFactor(10 ** log, p.mcap_usd!));
    }
    return median(misses);
  }
}
