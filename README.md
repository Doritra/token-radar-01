# Token Launch Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Doritra/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Doritra/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar for [make.fun's `token-radar-01` bounty](https://make.fun/bounty/token-radar-01). It reads the
sealed DefiLlama snapshot, ranks every protocol that records no token yet by
an implied launch value, and hands in a static dashboard: the ranked board, a
detail view per protocol with its farm plan, filters, and a comparison strip
of protocols whose token already trades.

## The model

Implied value comes from a regression fitted on the snapshot itself — no
hand-set multiples, no list of names:

- **Size curve** — `log10(mcap) = b0 + b1·log10(TVL) + b2·momentum +
  b3·log10(age) + sector premium`, fitted by least squares on the 106 traded
  tokens whose cap-to-TVL ratio sits in [0.01, 3] (outside that band the
  ratios are shells and data errors; training on them doubles the held-out
  miss). The sector premium is each category's median residual, shrunk by
  n/(n+20).
- **Evidence, printed on the dashboard** — leave-one-out median miss ×2.93
  for this model against ×3.82 for the previous peer-multiple model and
  ×4.18 for a flat global median; walk-forward (fit the oldest 60%, predict
  the newest 40%) ×2.49. Every term is ablated on the same test: the size
  curve carries the model, momentum and age earn small keeps, and the
  multi-chain reach premium earlier versions used was tested and **dropped**
  — it made held-out predictions worse.
- **Calibrated ranges** — each row's P25–P75 and P10–P90 bands come from the
  leave-one-out residuals; on held-out tokens they covered 51% and 81% of
  real caps against stated 50% and 80%.
- **Token odds** — each row's launch probability is its category's own
  token record, shrunk toward the 54.9% base rate, Brier-scored out-of-fold
  at 0.226 against the base rate's 0.248.
- **Costed farm verdicts** — each row's eight-step plan (generated in
  `lib/farm.ts` from the protocol's own record, quoting its rank, exact TVL,
  listing date and chain list) is priced: fees, hours and days, an expected
  drop slice (5% of supply split equally among qualifying wallets, weighted
  by the launch odds), net dollars and net per hour, and a verdict —
  FARM, MARGINAL, THIN or SKIP. The dashboard's drop and deposit controls
  reprice every verdict live.
- **The full ledger** — all 758 snapshot protocols sit in exactly one named
  group on the page (ranked, token trades, token on record, bridge, liquid
  staking, exchange custody, versioned, wrapped/staked, other), and an
  integrity strip recomputes the board in the browser and checks its
  checksum against the one `main.ts` wrote.
- **The fit, shown** — the evidence section draws the leave-one-out
  predicted-vs-actual scatter and the residual histogram from the fit's own
  held-out predictions, and states the sample's size (106 traded tokens)
  and its limits next to them. Detail panels carry a net-on-deposit figure
  beside the per-hour verdict and a "what moves this price" readout from
  the fitted coefficients; a momentum-leaders strip surfaces the strongest
  7-day TVL moves the momentum term is pricing.
- **Four views ship as screenshots** — the board and the farm-net/hour
  verdict view (both via `#view=board`, a print view that steps the leader
  strips aside so the ranked rows fill the frame), one protocol's detail
  tall enough to read the plan's steps and its total-capital bridge, and a
  dedicated evidence view (`#view=evidence`) that puts the full
  out-of-sample tables, the charts, the ledger and the integrity strip at
  the top of the page. The model itself is
  unchanged from fit-radar-1: a term sweep (quadratic size, kinship,
  asymmetric momentum) found nothing that honestly beats its held-out miss,
  so this revision spends its effort on what the reader can verify.

Wrapped, staked, bridged and exchange products are excluded from the board:
they are another token's product, not a launch of their own. The board covers
the snapshot's whole 40-protocol watchlist plus every other rankable
pre-token protocol in the snapshot.

## Run

```sh
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

Writes `out/board.json`, `out/data.js`, `out/dashboard/`, `out/screenshots/`
and `out/dossier.json`. Node 22.18+, standard library only, deterministic:
two runs write identical bytes.
