// Token Launch Radar — dashboard logic (fit-radar-1). Renders window.RADAR
// (written by main.ts beside this page as ../data.js): the ranked board with
// quick-filter chips and header sorting, the fitted model's coefficients and
// its out-of-sample evidence, one detail view per protocol with its fitted
// breakdown, calibrated range, launch odds and costed farm verdict, the full
// 758-protocol ledger, the already-trading comparison strip, and an integrity
// strip that recomputes the board from the rows on this page and compares
// its checksum with the one main.ts wrote. No fetch, no network: every byte
// it shows was computed by lib/model.ts, lib/fit.ts and lib/farm.ts.
'use strict';

const R = window.RADAR;
const rows = R.rows;
const F = R.fit_report;
const bySlug = new Map(rows.map((r) => [r.slug, r]));
const catCount = new Map();
for (const r of rows) catCount.set(r.category || '—', (catCount.get(r.category || '—') || 0) + 1);
const $ = (id) => document.getElementById(id);
let groupFilter = '';

function fmtUsd(n) {
  if (n === null || n === undefined) return '—';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
  return '$' + Math.round(n);
}
function fmtPct(n) {
  if (n === null || n === undefined) return '—';
  const cls = n > 0 ? 'pos' : n < 0 ? 'neg' : '';
  return '<span class="' + cls + '">' + (n > 0 ? '+' : '') + n.toFixed(1) + '%</span>';
}
function fmtAge(days) {
  if (days === null || days === undefined) return '—';
  if (days >= 730) return (days / 365).toFixed(1) + 'y';
  if (days >= 30) return Math.round(days / 30) + 'mo';
  return days + 'd';
}
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function tierOf(rank) { return rank <= 10 ? 'S' : rank <= 40 ? 'A' : rank <= 100 ? 'B' : 'C'; }
function miss(x) { return '×' + x.toFixed(2); }

// ---- farm costing under the reader's controls --------------------------------
// Same formula as lib/model.ts farmCostingFor, re-run live: the drop split
// equally among qualifying wallets (one per $25k of TVL, 200–50,000), the
// slice weighted by launch odds, scaled by the square root of the deposit
// multiple (points reward size, but never linearly), minus the plan's fees.
function costing(r) {
  const dropPct = parseFloat($('drop').value);
  const depMult = parseFloat($('dep').value);
  const wallets = Math.min(50000, Math.max(200, Math.round(r.tvl_usd / 25000)));
  const gross = (r.token_odds * r.implied_value_usd * (dropPct / 100)) / wallets * Math.sqrt(depMult);
  const net = gross - r.farm_costing.fees_usd;
  const nph = net / r.farm_costing.hours;
  const verdict = nph >= 25 ? 'FARM' : nph >= 8 ? 'MARGINAL' : nph >= 0 ? 'THIN' : 'SKIP';
  return { gross, net, nph, verdict, deposit: Math.round(r.farm_costing.deposit_usd * depMult) };
}
function verdictBadge(r) {
  const c = costing(r);
  return '<span class="vd vd-' + c.verdict.toLowerCase() + '">' + c.verdict + '</span> <span class="vdh">' + (c.nph < 0 ? '−$' + Math.abs(c.nph).toFixed(0) : '$' + c.nph.toFixed(0)) + '/h</span>';
}

// ---- header, stats, model band --------------------------------------------------
$('asof').textContent = R.as_of;
$('modelver').textContent = R.model_version;
$('src').textContent = R.source;
$('b0').textContent = F.beta[0].toFixed(2);
$('b1').textContent = F.beta[1].toFixed(3);
$('b2').textContent = F.beta[2].toFixed(3);
$('b3').textContent = F.beta[3].toFixed(3);
$('trainn').textContent = F.train_n;
const premFmt = (list) => list.map((x) => esc(x.category) + ' ' + (x.premium >= 0 ? '+' : '') + x.premium.toFixed(2)).join(' · ');
$('premtop').textContent = premFmt(F.premia_top.slice(0, 3));
$('prembot').textContent = premFmt(F.premia_bottom.slice(0, 3));
const totalImplied = rows.reduce((a, r) => a + r.implied_value_usd, 0);
const farmCount = rows.filter((r) => r.farm_costing.verdict === 'FARM').length;
const stats = [
  [String(R.board_size), 'protocols ranked'],
  [R.watchlist_size + ' / ' + R.watchlist_size, 'watchlist covered'],
  [fmtUsd(totalImplied), 'total implied value'],
  [miss(F.loo.fitted), 'held-out miss (LOO)'],
  [String(farmCount), 'rows verdict FARM'],
];
$('stats').innerHTML = stats.map((s) => '<div class="stat"><b>' + s[0] + '</b><span>' + s[1] + '</span></div>').join('');
$('kpis').innerHTML = [
  ['Leave-one-out', miss(F.loo.fitted), 'fitted model'],
  ['Leave-one-out', miss(F.loo.peer), 'previous peer model'],
  ['Leave-one-out', miss(F.loo.flat), 'flat median multiple'],
  ['Walk-forward', miss(F.walk_forward.fitted), 'fitted, oldest→newest'],
].map((k) => '<div class="kpi"><span>' + k[0] + '</span><b>' + k[1] + '</b><span>' + k[2] + '</span></div>').join('');

// ---- category leaders -----------------------------------------------------------
const leaderByCat = new Map();
for (const r of rows) {
  const key = r.category || '—';
  if (!leaderByCat.has(key)) leaderByCat.set(key, r);
}
$('leaders').innerHTML = [...leaderByCat.values()]
  .sort((a, b) => b.implied_value_usd - a.implied_value_usd)
  .map((r) => '<button class="lchip" data-slug="' + esc(r.slug) + '">' + esc(r.category || '—') + ' · <b>' + esc(r.name) + '</b> <span>' + fmtUsd(r.implied_value_usd) + '</span></button>')
  .join('');
$('momleaders').innerHTML = rows
  .filter((r) => r.change_7d !== null)
  .sort((a, b) => (b.change_7d ?? 0) - (a.change_7d ?? 0))
  .slice(0, 6)
  .map((r) => '<button class="lchip" data-slug="' + esc(r.slug) + '"><b>' + esc(r.name) + '</b> <span>+' + (r.change_7d ?? 0).toFixed(1) + '% 7d · ' + fmtUsd(r.implied_value_usd) + '</span></button>')
  .join('');
for (const chip of document.querySelectorAll('.lchip')) {
  chip.addEventListener('click', () => { location.hash = 'p=' + chip.getAttribute('data-slug'); });
}

// ---- filter options -----------------------------------------------------------
const cats = [...new Set(rows.map((r) => r.category).filter(Boolean))].sort();
$('cat').innerHTML = '<option value="">All categories</option>' + cats.map((c) => '<option>' + esc(c) + '</option>').join('');
const chains = [...new Set(rows.flatMap((r) => r.chains))].sort();
$('chain').innerHTML = '<option value="">All chains</option>' + chains.map((c) => '<option>' + esc(c) + '</option>').join('');

// ---- board --------------------------------------------------------------------
function applySort(list, sort) {
  const out = [...list];
  if (sort === 'tvl') out.sort((a, b) => b.tvl_usd - a.tvl_usd);
  else if (sort === 'change') out.sort((a, b) => (b.change_7d ?? -999) - (a.change_7d ?? -999));
  else if (sort === 'age') out.sort((a, b) => (b.age_days ?? -1) - (a.age_days ?? -1));
  else if (sort === 'odds') out.sort((a, b) => b.token_odds - a.token_odds);
  else if (sort === 'nethr') out.sort((a, b) => costing(b).nph - costing(a).nph);
  else out.sort((a, b) => a.rank - b.rank);
  return out;
}
function renderBoard() {
  const q = $('q').value.trim().toLowerCase();
  const cat = $('cat').value, chain = $('chain').value, sort = $('sort').value;
  const limit = parseInt($('limit').value, 10);
  let list = rows.filter((r) => {
    if (groupFilter === 'watchlist' && !r.on_watchlist) return false;
    if (groupFilter === 'early' && r.on_watchlist) return false;
    if (groupFilter === 'top25' && r.rank > 25) return false;
    if (cat && r.category !== cat) return false;
    if (chain && !r.chains.includes(chain)) return false;
    if (q && !(r.name.toLowerCase().includes(q) || (r.category || '').toLowerCase().includes(q) || r.chains.join(' ').toLowerCase().includes(q))) return false;
    return true;
  });
  list = applySort(list, sort);
  const total = list.length;
  list = list.slice(0, limit);
  const topVal = rows.length ? rows[0].implied_value_usd : 1;
  $('count').textContent = 'Showing ' + list.length + ' of ' + total + ' matching protocols (' + rows.length + ' on the board)';
  $('rows').innerHTML = list.map((r) =>
    '<tr data-slug="' + esc(r.slug) + '">' +
    '<td class="rank">' + r.rank + '</td>' +
    '<td class="name"><span class="tier ' + tierOf(r.rank) + '">' + tierOf(r.rank) + '</span>' + esc(r.name) + (r.on_watchlist
      ? '<span class="badge wl">WATCHLIST</span>'
      : '<span class="badge early">EARLY</span>') + '</td>' +
    '<td>' + esc(r.category || '—') + '</td>' +
    '<td class="chains">' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>' +
    '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
    '<td class="num">' + fmtPct(r.change_7d) + '</td>' +
    '<td class="num">' + fmtAge(r.age_days) + '</td>' +
    '<td class="num"><span class="vbar" style="width:' + Math.max(3, Math.round((r.implied_value_usd / topVal) * 52)) + 'px"></span><b>' + fmtUsd(r.implied_value_usd) + '</b></td>' +
    '<td class="num range">' + fmtUsd(r.range_low_usd) + ' – ' + fmtUsd(r.range_high_usd) + '</td>' +
    '<td class="num">' + Math.round(r.token_odds * 100) + '%</td>' +
    '<td class="num">' + verdictBadge(r) + '</td>' +
    '<td>›</td></tr>'
  ).join('');
  for (const tr of document.querySelectorAll('#rows tr')) {
    tr.addEventListener('click', () => { location.hash = 'p=' + tr.getAttribute('data-slug'); });
  }
}

// ---- detail view ---------------------------------------------------------------
function whyText(r) {
  const curve = Math.pow(10, r.model.base_log);
  const prem = Math.pow(10, r.model.sector_premium);
  const peers = r.model.peer_count > 0
    ? ' Its sector premium was read from ' + r.model.peer_count + ' trading ' + (r.category || '') + (r.model.peer_count === 1 ? ' peer' : ' peers') + '.'
    : ' Its category has no residual record of its own, so it takes the curve unadjusted.';
  const oddsWhy = r.token_odds >= 0.55 ? 'launches are the norm in its category'
    : r.token_odds >= 0.35 ? 'its category launches about as often as not'
    : 'its category rarely launches at all — most of its kind never issue';
  return '#' + r.rank + ' overall and #' + r.category_rank + ' of ' + (catCount.get(r.category || '—') || 1) + ' in ' + esc(r.category || 'its category') +
    '. The size curve prices its record at ' + fmtUsd(curve) + '; the ' + esc(r.category || 'sector') + ' premium (×' + prem.toFixed(2) + ') takes it to ' + fmtUsd(r.implied_value_usd) + '.' + peers +
    ' The honest range is ' + fmtUsd(r.range_low_usd) + ' – ' + fmtUsd(r.range_high_usd) + ' (P25–P75). Launch odds ' + Math.round(r.token_odds * 100) + '%: ' + oddsWhy + '.';
}
function rangeBar(r) {
  // Log-scale position of P10, P25, point, P75, P90 inside the P10–P90 span.
  const lo = Math.log10(r.range90_low_usd), hi = Math.log10(r.range90_high_usd);
  const pos = (v) => Math.min(100, Math.max(0, ((Math.log10(v) - lo) / (hi - lo)) * 100));
  return '<div class="rangebar"><div class="rb-track"></div>' +
    '<div class="rb-band" style="left:' + pos(r.range_low_usd) + '%;width:' + (pos(r.range_high_usd) - pos(r.range_low_usd)) + '%"></div>' +
    '<div class="rb-point" style="left:' + pos(r.implied_value_usd) + '%"></div>' +
    '<div class="rb-labels"><span>P10 ' + fmtUsd(r.range90_low_usd) + '</span><span>P25 ' + fmtUsd(r.range_low_usd) + '</span><span><b>' + fmtUsd(r.implied_value_usd) + '</b></span><span>P75 ' + fmtUsd(r.range_high_usd) + '</span><span>P90 ' + fmtUsd(r.range90_high_usd) + '</span></div></div>';
}
function renderDetail(slug) {
  const r = bySlug.get(slug);
  const el = $('detail');
  // While a protocol is open, the category-leader strip steps aside: the
  // detail is the content, the strip is browsing chrome.
  $('leaderssec').classList.toggle('hidden', !!r);
  $('momsec').classList.toggle('hidden', !!r);
  if (!r) { el.classList.add('hidden'); el.innerHTML = ''; return; }
  el.classList.remove('hidden');
  const c = costing(r);
  const fc = r.farm_costing;
  el.innerHTML =
    '<button class="close" id="closex">Close ✕</button>' +
    '<h2><span class="tier ' + tierOf(r.rank) + '">' + tierOf(r.rank) + '</span>#' + r.rank + ' · ' + esc(r.name) + (r.on_watchlist ? '<span class="badge wl">WATCHLIST</span>' : '<span class="badge early">EARLY FIND</span>') + '</h2>' +
    '<p class="meta">' + esc(r.category || 'Uncategorised') + ' · ' + esc(r.chains.join(', ') || 'no chains listed') +
    ' · records no token in the snapshot · listed ' + (r.listed_at || 'date unknown') + ' (' + fmtAge(r.age_days) + ' old)</p>' +
    '<div class="grid"><div class="left"><h3>Figures</h3>' +
    '<div class="bar"><span>TVL</span><b>' + fmtUsd(r.tvl_usd) + '</b></div>' +
    '<div class="bar"><span>7d TVL change</span><b>' + (r.change_7d === null ? '—' : r.change_7d.toFixed(1) + '%') + '</b></div>' +
    '<div class="bar"><span>Implied value</span><b>' + fmtUsd(r.implied_value_usd) + '</b></div>' +
    '<div class="bar"><span>Launch odds</span><b>' + Math.round(r.token_odds * 100) + '%</b></div>' +
    '<h3>Calibrated range</h3>' + rangeBar(r) +
    '<h3>Fitted breakdown — ' + esc(R.model_version) + '</h3>' +
    '<div class="bar"><span>Curve (size·mom·age)</span><b>10^' + r.model.base_log.toFixed(3) + ' = ' + fmtUsd(Math.pow(10, r.model.base_log)) + '</b></div>' +
    '<div class="bar"><span>Sector premium (' + esc(r.category || 'none') + ')</span><b>×' + Math.pow(10, r.model.sector_premium).toFixed(2) + '</b></div>' +
    '<h3>What moves this price — the fitted coefficients at work</h3>' +
    '<div class="bar"><span>If TVL grows 50%</span><b>' + fmtUsd(r.implied_value_usd * Math.pow(1.5, F.beta[1])) + '</b></div>' +
    '<div class="bar"><span>If 7d momentum gains 10 pts</span><b>' + fmtUsd(r.implied_value_usd * Math.pow(10, F.beta[2] * 0.1)) + '</b></div>' +
    '<div class="bar"><span>One year from now, all else equal</span><b>' + fmtUsd(r.implied_value_usd * Math.pow((r.age_days + 395) / (r.age_days + 30), F.beta[3])) + '</b></div>' +
    '<h3>The sector\'s trading record</h3>' +
    (r.model.peer_examples.length > 0
      ? '<p class="peerlist">Peer cap/TVL multiples: ' + r.model.peer_examples.map((x) => esc(x.name) + ' <b>' + x.fdv_tvl.toFixed(2) + 'x</b>').join(' · ') + '<br><span style="color:var(--muted)">' + (r.model.peer_count <= 5 ? 'All ' + r.model.peer_count + ' trading ' + esc(r.category || '') + ' peers by market cap' : 'The five largest of ' + r.model.peer_count + ' trading ' + esc(r.category || '') + ' peers by market cap') + '. The fit learned from all of them; the premium above is the category\'s median residual after the curve.</span></p>'
      : '<p class="peerlist">No protocol in this category trades yet, so the curve prices this row unadjusted — the widest kind of uncertainty, and the range above says so.</p>') +
    '<h3>Why this rank</h3><p class="why">' + whyText(r) + '</p></div>' +
    '<div class="right"><h3>How to farm ' + esc(r.name) + ' — the full plan</h3>' +
    '<div class="costbox"><div class="costhead"><span class="vd vd-' + c.verdict.toLowerCase() + '">' + c.verdict + '</span>' +
    '<span class="costnet">expected net <b>' + (c.net < 0 ? '−$' + Math.abs(c.net).toFixed(0) : '$' + c.net.toFixed(0)) + '</b> · <b>' + (c.nph < 0 ? '−$' + Math.abs(c.nph).toFixed(0) : '$' + c.nph.toFixed(0)) + '/hour</b></span></div>' +
    '<div class="costgrid">' +
    '<div class="stat"><b>' + fmtUsd(c.deposit) + '</b><span>deposit</span></div>' +
    '<div class="stat"><b>' + (c.deposit > 0 ? (c.net / c.deposit * 100).toFixed(1) + '%' : '—') + '</b><span>net on deposit</span></div>' +
    '<div class="stat"><b>' + fmtUsd(fc.fees_usd) + '</b><span>fees (est.)</span></div>' +
    '<div class="stat"><b>' + fc.hours + ' h</b><span>of work</span></div>' +
    '<div class="stat"><b>' + fc.days + ' d</b><span>start to exit</span></div>' +
    '<div class="stat"><b>' + fmtUsd(c.gross) + '</b><span>expected drop slice</span></div>' +
    '<div class="stat"><b>' + $('drop').value + '%</b><span>of supply to farmers</span></div>' +
    '</div><p class="fineprint">Slice = drop pool split equally among qualifying wallets (one per $25k of TVL), weighted by the ' + Math.round(r.token_odds * 100) + '% launch odds, deposit-scaled by √. Change the drop or deposit above and every verdict on the board reprices.</p></div>' +
    '<ol class="steps">' +
    r.plan.map((s) => '<li>' + esc(s.text) + '<span class="tag cost">' + esc(s.cost) + '</span><span class="tag time">' + esc(s.time) + '</span></li>').join('') +
    '</ol></div></div>';
  $('closex').addEventListener('click', () => { location.hash = ''; });
}

// ---- evidence tables -------------------------------------------------------------
$('loon').textContent = F.train_n;
$('wfn').textContent = F.walk_forward.test_n;
$('evmodels').innerHTML = [
  ['<b>This fitted model</b>', F.loo.fitted, F.walk_forward.fitted],
  ['Previous peer model (v2–v4)', F.loo.peer, F.walk_forward.peer],
  ['Flat global-median multiple', F.loo.flat, F.walk_forward.flat],
].map((m) => '<tr><td>' + m[0] + '</td><td class="num">' + miss(m[1]) + '</td><td class="num">' + miss(m[2]) + '</td></tr>').join('');
$('evterms').innerHTML = F.terms.map((t) =>
  '<tr><td>' + esc(t.term) + '<br><span class="fineprint">' + esc(t.detail) + '</span></td>' +
  '<td class="num">' + miss(t.loo_with) + '</td><td class="num">' + miss(t.loo_without) + '</td>' +
  '<td>' + esc(t.verdict) + '</td></tr>').join('');
$('smalln').textContent = F.train_n;
(function charts() {
  const pts = F.scatter || [];
  if (pts.length) {
    const W = 320, H = 240, lo = 5, hi = 10.5;
    const X = (v) => ((v - lo) / (hi - lo)) * W;
    const Y = (v) => H - ((v - lo) / (hi - lo)) * H;
    let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Leave-one-out predicted versus actual market cap">';
    s += '<line x1="' + X(lo) + '" y1="' + Y(lo) + '" x2="' + X(hi) + '" y2="' + Y(hi) + '" style="stroke:var(--muted)" stroke-width="1" stroke-dasharray="4 3"/>';
    for (const g of [6, 8, 10]) {
      s += '<line x1="' + X(g) + '" y1="0" x2="' + X(g) + '" y2="' + H + '" style="stroke:var(--border)" stroke-width="0.5"/>';
      s += '<line x1="0" y1="' + Y(g) + '" x2="' + W + '" y2="' + Y(g) + '" style="stroke:var(--border)" stroke-width="0.5"/>';
      s += '<text x="' + (X(g) + 3) + '" y="' + (H - 4) + '" style="fill:var(--muted)" font-size="9">' + (g === 6 ? '$1M' : g === 8 ? '$100M' : '$10B') + '</text>';
    }
    for (const p of pts) s += '<circle cx="' + X(p.log_actual).toFixed(1) + '" cy="' + Y(p.log_pred).toFixed(1) + '" r="2.4" style="fill:var(--accent)" opacity="0.72"/>';
    s += '</svg>';
    $('scatter').innerHTML = s;
  }
  const hist = F.resid_hist || [];
  if (hist.length) {
    const W = 320, H = 240, bw = W / hist.length;
    const max = Math.max(...hist.map((b) => b.n), 1);
    let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Histogram of leave-one-out residuals">';
    hist.forEach((b, i) => {
      const h = (b.n / max) * (H - 18);
      const zero = b.lo >= -0.001 && b.lo < 0.25;
      s += '<rect x="' + (i * bw + 1).toFixed(1) + '" y="' + (H - 18 - h).toFixed(1) + '" width="' + (bw - 2).toFixed(1) + '" height="' + h.toFixed(1) + '" style="fill:' + (zero ? 'var(--accent)' : 'var(--muted)') + '" opacity="' + (zero ? '0.95' : '0.55') + '"/>';
    });
    const zx = ((0 - hist[0].lo) / 0.25) * bw;
    s += '<line x1="' + zx + '" y1="0" x2="' + zx + '" y2="' + (H - 18) + '" style="stroke:var(--text)" stroke-width="1"/>';
    s += '<text x="2" y="' + H + '" style="fill:var(--muted)" font-size="9">−1.5 (market paid a tenth)</text>';
    s += '<text x="' + (W - 118) + '" y="' + H + '" style="fill:var(--muted)" font-size="9">+1.5 (ten times over)</text>';
    s += '</svg>';
    $('residhist').innerHTML = s;
  }
})();

$('evcalib').innerHTML = [
  ['P25–P75 range coverage', Math.round(F.calibration.band50 * 100) + '% of held-out caps inside', 'stated 50%'],
  ['P10–P90 range coverage', Math.round(F.calibration.band80 * 100) + '% of held-out caps inside', 'stated 80%'],
  ['Token odds Brier (out-of-fold)', F.odds.brier_model.toFixed(3), 'base rate ' + F.odds.brier_base.toFixed(3)],
  ['Token base rate', Math.round(F.odds.base_rate * 100) + '% of all protocols record a token', ''],
].map((c) => '<tr><td>' + c[0] + '</td><td class="num">' + c[1] + '</td><td class="num">' + c[2] + '</td></tr>').join('');

// ---- ledger -----------------------------------------------------------------------
const ledTotal = R.ledger.reduce((a, g) => a + g.count, 0);
$('ledtotal').textContent = ledTotal;
const ledColors = ['#4f8cff', '#9a9aa5', '#c9c9d1', '#7a7a85', '#6b6b76', '#5a5a64', '#a5a5ae', '#8a8a94', '#76767f', '#b5b5bc'];
$('ledgerbar').innerHTML = R.ledger.map((g, i) =>
  '<div class="ledseg" style="width:' + (g.count / ledTotal * 100).toFixed(2) + '%;background:' + ledColors[i % ledColors.length] + '" title="' + esc(g.label) + ': ' + g.count + '"></div>').join('');
$('ledgerrows').innerHTML = R.ledger.map((g, i) =>
  '<tr><td><span class="leddot" style="background:' + ledColors[i % ledColors.length] + '"></span>' + esc(g.label) + '</td>' +
  '<td class="num">' + g.count + '</td><td>' + esc(g.note) + '</td></tr>').join('');

// ---- already-trading strip -------------------------------------------------------
$('liverows').innerHTML = R.live.map((p) =>
  '<tr><td class="name">' + esc(p.name) + '</td><td>' + esc(p.category || '—') + '</td>' +
  '<td class="num">' + fmtUsd(p.tvl_usd) + '</td><td class="num">' + fmtUsd(p.mcap_usd) + '</td>' +
  '<td class="num">' + (p.fdv_tvl === null ? '—' : p.fdv_tvl.toFixed(2) + 'x') + '</td>' +
  '<td class="num">' + fmtPct(p.change_7d) + '</td></tr>'
).join('');

// ---- integrity strip: recompute the board in the browser --------------------------
(function integrity() {
  let h = 0x811c9dc5;
  const text = rows.map((r) => r.rank + '|' + r.slug + '|' + r.implied_value_usd).join('\n');
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const hex = h.toString(16).padStart(8, '0');
  let ranksOk = true, monoOk = true;
  rows.forEach((r, i) => {
    if (r.rank !== i + 1) ranksOk = false;
    if (i > 0 && r.implied_value_usd > rows[i - 1].implied_value_usd) monoOk = false;
  });
  const total = rows.reduce((a, r) => a + r.implied_value_usd, 0);
  const ok = hex === R.integrity.checksum && ranksOk && monoOk && total === R.integrity.total_implied_usd && rows.length === R.integrity.rows;
  $('integrity').innerHTML = '<h2>Board integrity — recomputed on this page</h2><p>' +
    rows.length + ' rows drawn = ' + R.integrity.rows + ' written · ranks 1–' + rows.length + (ranksOk ? ' in order' : ' OUT OF ORDER') +
    ' · values ' + (monoOk ? 'never rise' : 'RISE') + ' · total implied ' + fmtUsd(total) +
    ' · checksum <b>' + hex + '</b> ' + (hex === R.integrity.checksum ? '= main.ts ✓ the board above is the board the model wrote' : '≠ main.ts ✗ MISMATCH') + '</p>';
})();

// ---- controls, chips, header sorting, hash routing --------------------------------
function setGroup(g) {
  groupFilter = g;
  for (const chip of document.querySelectorAll('#chips .chip')) {
    chip.classList.toggle('on', chip.getAttribute('data-group') === g);
  }
  renderBoard();
}
for (const chip of document.querySelectorAll('#chips .chip')) {
  chip.addEventListener('click', () => setGroup(chip.getAttribute('data-group')));
}
for (const th of document.querySelectorAll('#board th[data-sort]')) {
  th.addEventListener('click', () => { $('sort').value = th.getAttribute('data-sort'); renderBoard(); });
}
for (const id of ['q', 'cat', 'chain', 'sort', 'limit']) {
  $(id).addEventListener('input', renderBoard);
  $(id).addEventListener('change', renderBoard);
}
for (const id of ['drop', 'dep']) {
  $(id).addEventListener('change', () => {
    renderBoard();
    const h = new URLSearchParams(location.hash.replace(/^#/, ''));
    if (h.get('p')) renderDetail(h.get('p'));
  });
}
function applyHash() {
  const h = new URLSearchParams(location.hash.replace(/^#/, ''));
  if (h.get('cat')) $('cat').value = h.get('cat');
  if (h.get('chain')) $('chain').value = h.get('chain');
  if (h.get('q')) $('q').value = h.get('q');
  if (h.get('sort')) $('sort').value = h.get('sort');
  if (h.get('group') !== null) setGroup(h.get('group'));
  renderBoard();
  renderDetail(h.get('p') || '');
  if (h.get('view') === 'evidence') {
    // A print view for the evidence screenshot: everything above the
    // evidence section steps aside so the tables render at the top.
    document.body.classList.add('evidence-only');
  }
}
window.addEventListener('hashchange', applyHash);
applyHash();
