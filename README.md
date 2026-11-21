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

Implied value is priced from the snapshot's own figures, never from a list of
names:

- **Peer multiple** — for each category, the median market-cap/TVL ratio of
  protocols in that category whose token already trades (ratios kept in
  [0.01, 3]), shrunk toward the global median by eight phantom peers and
  clamped to [0.06, 0.65]. A lending market is priced like trading lending
  markets; a DEX like trading DEXes.
- **Momentum** — seven-day TVL change, clamped to [-30%, +40%], half weight.
- **Maturity** — 0.80 plus up to +0.20 for age, over four years: a protocol
  that has run for years with no token has a record a launch can be priced on.
- **Reach** — +1.5% per additional chain, up to five.

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
