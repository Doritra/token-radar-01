// Token Launch Radar — dashboard logic (v2 page). Renders window.RADAR
// (written by main.ts beside this page as ../data.js): the ranked board with
// quick-filter chips and header sorting, one detail view per protocol with
// its model breakdown, a plain-language "why this rank", a confidence meter
// and the eight-step farm plan as a checklist with cost and time chips, plus
// the already-trading comparison strip. No fetch, no network: every byte it
// shows was computed by lib/model.ts and lib/farm.ts.
'use strict';

const R = window.RADAR;
const rows = R.rows;
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
  return '$' + n;
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
function confClass(c) { return c >= 70 ? 'hi' : c >= 50 ? 'mid' : 'lo'; }

// ---- header and stats -------------------------------------------------------
$('asof').textContent = R.as_of;
$('modelver').textContent = R.model_version;
$('globalmed').textContent = R.global_median.toFixed(3);
$('src').textContent = R.source;
const totalImplied = rows.reduce((a, r) => a + r.implied_value_usd, 0);
const stats = [
  [String(R.board_size), 'protocols ranked'],
  [R.watchlist_size + ' / ' + R.watchlist_size, 'watchlist covered'],
  [String(R.early_size), 'early finds'],
  [fmtUsd(totalImplied), 'total implied value'],
  [fmtUsd(rows.length ? rows[0].implied_value_usd : 0), 'top implied value'],
];
$('stats').innerHTML = stats.map((s) => '<div class="stat"><b>' + s[0] + '</b><span>' + s[1] + '</span></div>').join('');

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
  else if (sort === 'ratio') out.sort((a, b) => b.implied_value_usd / b.tvl_usd - a.implied_value_usd / a.tvl_usd);
  else if (sort === 'confidence') out.sort((a, b) => b.confidence - a.confidence);
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
    '<td class="num">' + (r.implied_value_usd / r.tvl_usd).toFixed(2) + 'x</td>' +
    '<td class="num conf ' + confClass(r.confidence) + '">' + r.confidence + '</td>' +
    '<td>›</td></tr>'
  ).join('');
  for (const tr of document.querySelectorAll('#rows tr')) {
    tr.addEventListener('click', () => { location.hash = 'p=' + tr.getAttribute('data-slug'); });
  }
}

// ---- detail view ---------------------------------------------------------------
function bar(label, value, max) {
  const w = Math.max(2, Math.round((value / max) * 130));
  return '<div class="bar"><span>' + label + '</span><i style="width:' + w + 'px"></i><b>' + value.toFixed(3) + 'x</b></div>';
}
function whyText(r) {
  const peers = r.model.peer_count > 0
    ? 'the shrunk median of ' + r.model.peer_count + ' already-trading ' + (r.category || '') + (r.model.peer_count === 1 ? ' peer' : ' peers')
    : 'the global median, because no ' + (r.category || '') + ' peer trades yet';
  const age = r.age_days === null ? 'an unknown listing date' : fmtAge(r.age_days) + ' of recorded history';
  const move = r.change_7d === null ? 'unreported 7-day TVL movement' : (r.change_7d >= 0 ? 'TVL up ' : 'TVL down ') + Math.abs(r.change_7d).toFixed(1) + '% in seven days';
  const confWhy = r.confidence >= 70 && r.model.peer_count >= 3 ? 'a deep peer set and a steady record make this one of the board\'s firmer prices'
    : r.confidence >= 70 ? 'a thin peer set, steadied by its age, its scale and a calm week — this multiple leans on the global median more than most'
    : r.confidence >= 50 ? 'the evidence is decent, with at least one thin spot — peer depth, age or stability'
    : 'treat this price as a rough sketch: the peer set, the record or the week behind it is thin';
  return '#' + r.rank + ' overall and #' + r.category_rank + ' of ' + (catCount.get(r.category || '—') || 1) + ' in ' + esc(r.category || 'its category') +
    '. Priced at ' + r.model.peer_multiple.toFixed(2) + 'x TVL — ' + peers + ' — then adjusted for ' + move + ' and ' +
    age + '. Confidence ' + r.confidence + '/100: ' + confWhy + '.';
}
function renderDetail(slug) {
  const r = bySlug.get(slug);
  const el = $('detail');
  if (!r) { el.classList.add('hidden'); el.innerHTML = ''; return; }
  el.classList.remove('hidden');
  el.innerHTML =
    '<button class="close" id="closex">Close ✕</button>' +
    '<h2><span class="tier ' + tierOf(r.rank) + '">' + tierOf(r.rank) + '</span>#' + r.rank + ' · ' + esc(r.name) + (r.on_watchlist ? '<span class="badge wl">WATCHLIST</span>' : '<span class="badge early">EARLY FIND</span>') + '</h2>' +
    '<p class="meta">' + esc(r.category || 'Uncategorised') + ' · ' + esc(r.chains.join(', ') || 'no chains listed') +
    ' · records no token in the snapshot · listed ' + (r.listed_at || 'date unknown') + ' (' + fmtAge(r.age_days) + ' old)</p>' +
    '<div class="grid"><div class="left"><h3>Figures</h3>' +
    '<div class="bar"><span>TVL</span><b>' + fmtUsd(r.tvl_usd) + '</b></div>' +
    '<div class="bar"><span>7d TVL change</span><b>' + (r.change_7d === null ? '—' : r.change_7d.toFixed(1) + '%') + '</b></div>' +
    '<div class="bar"><span>Implied value</span><b>' + fmtUsd(r.implied_value_usd) + '</b></div>' +
    '<div class="bar"><span>Implied / TVL</span><b>' + (r.implied_value_usd / r.tvl_usd).toFixed(2) + 'x</b></div>' +
    '<div class="bar confbar"><span>Confidence</span><i style="width:' + Math.round(r.confidence * 1.3) + 'px"></i><b>' + r.confidence + '/100</b></div>' +
    '<h3>Model breakdown — ' + esc(R.model_version) + '</h3>' +
    bar('Peer multiple', r.model.peer_multiple, 0.65) +
    bar('Momentum', r.model.momentum_multiplier, 1.2) +
    bar('Maturity', r.model.maturity_multiplier, 1.2) +
    bar('Reach', r.model.reach_multiplier, 1.08) +
    '<h3>Why this rank</h3><p class="why">' + whyText(r) + '</p></div>' +
    '<div class="right"><h3>How to farm ' + esc(r.name) + ' — the full plan</h3>' +
    '<div class="planstats">' +
    '<div class="stat"><b>' + fmtUsd(r.farm_capital_usd) + '</b><span>total capital</span></div>' +
    '<div class="stat"><b>' + r.plan.length + ' steps</b><span>setup to exit</span></div>' +
    '<div class="stat"><b>' + r.chains.length + '</b><span>chain' + (r.chains.length === 1 ? '' : 's') + '</span></div>' +
    '<div class="stat"><b>#' + r.category_rank + '</b><span>in category</span></div></div>' +
    '<ol class="steps">' +
    r.plan.map((s) => '<li>' + esc(s.text) + '<span class="tag cost">' + esc(s.cost) + '</span><span class="tag time">' + esc(s.time) + '</span></li>').join('') +
    '</ol></div></div>';
  $('closex').addEventListener('click', () => { location.hash = ''; });
}

// ---- already-trading strip -------------------------------------------------------
$('liverows').innerHTML = R.live.map((p) =>
  '<tr><td class="name">' + esc(p.name) + '</td><td>' + esc(p.category || '—') + '</td>' +
  '<td class="num">' + fmtUsd(p.tvl_usd) + '</td><td class="num">' + fmtUsd(p.mcap_usd) + '</td>' +
  '<td class="num">' + (p.fdv_tvl === null ? '—' : p.fdv_tvl.toFixed(2) + 'x') + '</td>' +
  '<td class="num">' + fmtPct(p.change_7d) + '</td></tr>'
).join('');

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
function applyHash() {
  const h = new URLSearchParams(location.hash.replace(/^#/, ''));
  if (h.get('cat')) $('cat').value = h.get('cat');
  if (h.get('chain')) $('chain').value = h.get('chain');
  if (h.get('q')) $('q').value = h.get('q');
  if (h.get('group') !== null) setGroup(h.get('group'));
  renderBoard();
  renderDetail(h.get('p') || '');
}
window.addEventListener('hashchange', applyHash);
applyHash();
