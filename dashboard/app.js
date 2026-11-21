// Token Launch Radar — dashboard logic. Renders window.RADAR (written by
// main.ts beside this page as ../data.js): the ranked board, one detail view
// per protocol with its model breakdown and farm plan, filters, sorting, and
// the already-trading comparison strip. No fetch, no network: every byte it
// shows was computed by the model in lib/model.ts.
'use strict';

const R = window.RADAR;
const rows = R.rows;
const bySlug = new Map(rows.map((r) => [r.slug, r]));
const $ = (id) => document.getElementById(id);

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
function currentFilters() {
  return { q: $('q').value.trim().toLowerCase(), cat: $('cat').value, chain: $('chain').value, group: $('group').value, sort: $('sort').value };
}
function applySort(list, sort) {
  const out = [...list];
  if (sort === 'tvl') out.sort((a, b) => b.tvl_usd - a.tvl_usd);
  else if (sort === 'change') out.sort((a, b) => (b.change_7d ?? -999) - (a.change_7d ?? -999));
  else if (sort === 'age') out.sort((a, b) => (b.age_days ?? -1) - (a.age_days ?? -1));
  else if (sort === 'ratio') out.sort((a, b) => b.implied_value_usd / b.tvl_usd - a.implied_value_usd / a.tvl_usd);
  else out.sort((a, b) => a.rank - b.rank);
  return out;
}
function renderBoard() {
  const f = currentFilters();
  let list = rows.filter((r) => {
    if (f.cat && r.category !== f.cat) return false;
    if (f.chain && !r.chains.includes(f.chain)) return false;
    if (f.group === 'watchlist' && !r.on_watchlist) return false;
    if (f.group === 'early' && r.on_watchlist) return false;
    if (f.q && !(r.name.toLowerCase().includes(f.q) || (r.category || '').toLowerCase().includes(f.q) || r.chains.join(' ').toLowerCase().includes(f.q))) return false;
    return true;
  });
  list = applySort(list, f.sort);
  $('count').textContent = 'Showing ' + list.length + ' of ' + rows.length + ' protocols';
  $('rows').innerHTML = list.map((r) =>
    '<tr data-slug="' + esc(r.slug) + '">' +
    '<td class="rank">' + r.rank + '</td>' +
    '<td class="name">' + esc(r.name) + (r.on_watchlist
      ? '<span class="badge wl">WATCHLIST</span>'
      : '<span class="badge early">EARLY</span>') + '</td>' +
    '<td>' + esc(r.category || '—') + '</td>' +
    '<td class="chains">' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>' +
    '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
    '<td class="num">' + fmtPct(r.change_7d) + '</td>' +
    '<td class="num">' + fmtAge(r.age_days) + '</td>' +
    '<td class="num"><b>' + fmtUsd(r.implied_value_usd) + '</b></td>' +
    '<td class="num">' + (r.implied_value_usd / r.tvl_usd).toFixed(2) + 'x</td>' +
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
function renderDetail(slug) {
  const r = bySlug.get(slug);
  const el = $('detail');
  if (!r) { el.classList.add('hidden'); el.innerHTML = ''; return; }
  el.classList.remove('hidden');
  el.innerHTML =
    '<button class="close" id="closex">Close ✕</button>' +
    '<h2>#' + r.rank + ' · ' + esc(r.name) + (r.on_watchlist ? '<span class="badge wl">WATCHLIST</span>' : '<span class="badge early">EARLY FIND</span>') + '</h2>' +
    '<p class="meta">' + esc(r.category || 'Uncategorised') + ' · ' + esc(r.chains.join(', ') || 'no chains listed') +
    ' · records no token in the snapshot · listed ' + (r.listed_at || 'date unknown') + ' (' + fmtAge(r.age_days) + ' old)</p>' +
    '<div class="grid"><div class="box"><h3>Figures</h3>' +
    '<div class="bar"><span>TVL</span><b>' + fmtUsd(r.tvl_usd) + '</b></div>' +
    '<div class="bar"><span>7d TVL change</span><b>' + (r.change_7d === null ? '—' : r.change_7d.toFixed(1) + '%') + '</b></div>' +
    '<div class="bar"><span>Implied value</span><b>' + fmtUsd(r.implied_value_usd) + '</b></div>' +
    '<div class="bar"><span>Implied / TVL</span><b>' + (r.implied_value_usd / r.tvl_usd).toFixed(2) + 'x</b></div></div>' +
    '<div class="box"><h3>Model breakdown — ' + esc(R.model_version) + '</h3>' +
    bar('Peer multiple', r.model.peer_multiple, 0.65) +
    bar('Momentum', r.model.momentum_multiplier, 1.2) +
    bar('Maturity', r.model.maturity_multiplier, 1.2) +
    bar('Reach', r.model.reach_multiplier, 1.08) +
    '<p class="meta">Peer multiple: ' + (r.model.peer_count > 0
      ? 'median market-cap/TVL of ' + r.model.peer_count + ' already-trading ' + esc(r.category || '') + ' peers, shrunk toward the global median.'
      : 'no already-trading ' + esc(r.category || '') + ' peer in the snapshot, so the global median multiple applies.') + '</p></div></div>' +
    '<h3>How to farm ' + esc(r.name) + '</h3><ol class="steps">' +
    r.farm_steps.map((s) => '<li>' + esc(s) + '</li>').join('') + '</ol>';
  $('closex').addEventListener('click', () => { location.hash = ''; });
}

// ---- already-trading strip -------------------------------------------------------
$('liverows').innerHTML = R.live.map((p) =>
  '<tr><td class="name">' + esc(p.name) + '</td><td>' + esc(p.category || '—') + '</td>' +
  '<td class="num">' + fmtUsd(p.tvl_usd) + '</td><td class="num">' + fmtUsd(p.mcap_usd) + '</td>' +
  '<td class="num">' + (p.fdv_tvl === null ? '—' : p.fdv_tvl.toFixed(2) + 'x') + '</td>' +
  '<td class="num">' + fmtPct(p.change_7d) + '</td></tr>'
).join('');

// ---- hash routing: #p=slug detail, #cat=X / #chain=X / #group=X filters ------------
function applyHash() {
  const h = new URLSearchParams(location.hash.replace(/^#/, ''));
  if (h.get('cat')) $('cat').value = h.get('cat');
  if (h.get('chain')) $('chain').value = h.get('chain');
  if (h.get('group')) $('group').value = h.get('group');
  if (h.get('q')) $('q').value = h.get('q');
  renderBoard();
  renderDetail(h.get('p') || '');
}
for (const id of ['q', 'cat', 'chain', 'group', 'sort']) {
  $(id).addEventListener('input', renderBoard);
  $(id).addEventListener('change', renderBoard);
}
window.addEventListener('hashchange', applyHash);
applyHash();
