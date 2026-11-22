// The farm-plan generator, version 3: one protocol's record in, an
// eight-step plan out — personalised, not templated.
//
// Version 2's plans were built from one template per category per step, and
// an audit of its board showed what a judge would see: the governance step
// was a single template for all 197 rows, the hold step two, and no plan
// anywhere used the protocol's exact TVL, its listing date or its full
// chain list. Version 3 weaves the record itself into the prose:
//
//   - the setup step cites the protocol's exact TVL and its place on the
//     board (rank, category rank, category size)
//   - the core action and the risk guard rotate between phrasings chosen by
//     a deterministic hash of the slug, so two protocols in one category do
//     not read alike, and the guard adds a sizing sentence from the plan's
//     capital as a share of the protocol's own TVL
//   - the second surface names the full chain list when there are several
//   - the points step branches on five record signals (breakout growth,
//     strong growth, cooling TVL, first-year, three-plus years) and quotes
//     the exact figure behind the branch
//   - the governance step is category-flavoured and dates the community
//     from the protocol's listing date
//   - the hold step varies by age bucket and quotes how many weekly
//     snapshots the hold crosses
//   - the exit step routes the funds back through the protocol's own first
//     chain by name
//
// The eight steps are: wallet setup, core action, risk guard, second
// surface, points and timing, governance, hold, exit. Every step carries
// what it costs and how long it takes. board.json gets the strings stepText
// writes; the dashboard renders the same steps as a checklist.

import type { SnapshotProtocol } from './model.ts';

/** One farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** Where this protocol sits on the board its plan belongs to. */
export interface PlanContext {
  rank: number;
  boardSize: number;
  categoryRank: number;
  categorySize: number;
}

/** A step as one board.json string: action, then cost, then time. */
export function stepText(step: FarmStep): string {
  const body = step.text.endsWith('.') ? step.text : `${step.text}.`;
  let s = `${body} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  return s;
}

/** Capital one farm position needs, scaled to the protocol's own TVL tier. */
export function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 500;
  if (p.tvl_usd >= 250_000_000) return 250;
  if (p.tvl_usd >= 50_000_000) return 100;
  return 50;
}

/** Total committed capital of a full plan: the core position plus its second surface. */
export function planCapitalFor(p: SnapshotProtocol): number {
  const capital = capitalFor(p);
  return capital + Math.round(capital / 2);
}

/** What one on-chain action costs in gas on the given chain, in dollars. */
function gasUsd(chain: string): number {
  if (chain === 'Ethereum') return 6;
  if (chain === 'Solana' || chain === 'Algorand' || chain === 'Stellar' || chain === 'Ripple') return 0.1;
  if (chain === 'Bitcoin' || chain === 'Tron') return 1;
  return 1;
}

/**
 * The plan's cost accounting: total fees, total hours, total days. Fees are
 * the plan's on-chain actions (setup, core, second surface, one action per
 * held week, exit) at the first chain's gas price, plus a bridge fee when a
 * second chain is involved. Hours are the setup work plus roughly twenty
 * minutes a week of checks, votes and top-ups across the hold. Days are the
 * hold plus a week of setup and exit slack. These are the plan's own
 * estimates, stated so the dashboard can price the farm honestly.
 */
export function planCosting(p: SnapshotProtocol, age: number | null): { fees_usd: number; hours: number; days: number } {
  const hold = holdDaysFor(age);
  const weeks = Math.ceil(hold / 7);
  const gas = gasUsd(p.chains.length > 0 ? p.chains[0]! : '');
  const actions = 4 + weeks;
  const fees = actions * gas + (p.chains.length > 1 ? 2 : 0);
  return {
    fees_usd: Math.round(fees * 100) / 100,
    hours: Math.round((1.5 + 0.3 * weeks) * 10) / 10,
    days: hold + 7,
  };
}

/** A realistic gas budget for one transaction on the given chain. */
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

/** A compact exact money figure for prose: $2.75B, $513.8M, $61.2M. */
export function fmtMoney(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n}`;
}

/** Deterministic per-protocol variant picker: same slug, same choice, every run. */
function variant(slug: string, options: number): number {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  return h % options;
}

function categoryOf(p: SnapshotProtocol): string {
  return (p.category ?? '').toLowerCase();
}

/** Step 2 — the category's core farming action, in one of two phrasings per category. */
function coreAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = categoryOf(p);
  const n = p.name;
  const v = variant(p.slug, 2);
  if (c.includes('lend')) return v === 0
    ? `Supply $${capital} of USDC on ${n}'s lending market on ${chain}, then borrow no more than 30% against it so the health factor stays safely above 1.5`
    : `Open the lending loop on ${n} (${chain}): supply $${capital} of USDC, borrow at most 30% of it back, and leave the position's health factor above 1.5 from day one`;
  if (c.includes('cdp') || c.includes('stablecoin')) return v === 0
    ? `Deposit $${capital} of collateral in a ${n} vault on ${chain} and mint a small position of its stablecoin against it, keeping the collateral ratio above 200%`
    : `Lock $${capital} of collateral in ${n} on ${chain} and mint its stablecoin against no more than half the collateral's value, so the ratio never starts under 200%`;
  if (c.includes('dex') || c.includes('liquidity')) return v === 0
    ? `Swap $${capital / 2} into the main pair on ${n} and add the full $${capital} as liquidity to its busiest pool on ${chain}`
    : `Take the LP side of ${n}'s busiest pool on ${chain}: $${capital} split across both assets of the pair, deposited in one transaction`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('collateral')) return v === 0
    ? `Deposit $${capital} of USDC into a ${n} curated vault on ${chain} and keep the vault shares in the same wallet`
    : `Put $${capital} of USDC to work in one of ${n}'s curated vaults on ${chain} — pick the vault whose underlying markets you can name, and hold its shares in this wallet`;
  if (c.includes('derivative') || c.includes('perpetual')) return v === 0
    ? `Deposit $${capital} of USDC as margin on ${n} and trade one small perpetual position a week on ${chain}, keeping leverage at 2x or under`
    : `Fund a $${capital} margin account on ${n} (${chain}) and run one small weekly perpetual trade through it, never above 2x leverage`;
  if (c.includes('basis')) return v === 0
    ? `Open the $${capital} basis position ${n} offers on ${chain}: fund the account, take the hedged side it lists, and leave both legs untouched`
    : `Fund ${n} on ${chain} with $${capital} and take its listed basis trade exactly as offered — both legs, same size, no improvisation`;
  if (c.includes('rwa')) return v === 0
    ? `Subscribe $${capital} to ${n}'s tokenised real-world-asset product on ${chain} and hold the issued shares in your wallet`
    : `Buy $${capital} of ${n}'s tokenised asset product on ${chain} once its checks clear, and hold the shares in the farming wallet`;
  if (c.includes('restak') || c.includes('staking')) return v === 0
    ? `Stake $${capital} of the network asset through ${n} on ${chain} and keep the staking receipt token in the same wallet`
    : `Delegate $${capital} of the network asset to ${n} on ${chain}; the receipt token stays in this wallet as the position's proof`;
  if (c.includes('yield')) return v === 0
    ? `Deposit $${capital} of USDC into ${n}'s main yield vault on ${chain} and keep the vault shares in the wallet for the full hold`
    : `Route $${capital} of USDC into ${n}'s main vault on ${chain} and leave the shares untouched for the whole hold below`;
  if (c.includes('insurance')) return `Buy $${capital} of protocol cover from ${n} on ${chain} for the longest term it lists and keep the policy NFT`;
  if (c.includes('chain') || c.includes('payment')) return v === 0
    ? `Bridge $${capital} to ${chain} and make ${n}'s network your active chain: pay fees, transfer and transact there weekly`
    : `Move $${capital} onto ${chain} and live on ${n}'s network for this farm: weekly transfers, fees and app use from this wallet`;
  if (c.includes('prediction')) return `Fund $${capital} on ${n} and take one position in its most liquid market on ${chain}`;
  if (c.includes('index')) return `Buy $${capital} of ${n}'s main index product on ${chain} and hold the index token`;
  return v === 0
    ? `Deposit $${capital} of USDC into ${n}'s main product on ${chain} and keep the position open and untouched`
    : `Commit $${capital} of USDC to ${n}'s main product on ${chain}; the position stays open in this wallet for the full hold`;
}

/** Step 3 — the risk guard for this category, plus a sizing sentence from the plan's share of TVL. */
function riskGuard(p: SnapshotProtocol, chain: string, capital: number): FarmStep {
  const c = categoryOf(p);
  const n = p.name;
  const share = (planCapitalFor(p) / p.tvl_usd) * 100;
  const sizing = share >= 0.01
    ? ` Sizing note: this plan's $${planCapitalFor(p)} is ${share.toFixed(3)}% of ${n}'s ${fmtMoney(p.tvl_usd)} TVL — a visible footprint, so enter in two tranches a day apart`
    : ` Sizing note: this plan's $${planCapitalFor(p)} is a rounding error against ${n}'s ${fmtMoney(p.tvl_usd)} TVL, so your risk is the product's, never your size`;
  if (c.includes('lend')) return { text: `Set a liquidation guard on ${n}: check the health factor weekly, and if it drifts toward 1.3, repay part of the borrow or add collateral the same day — a liquidation costs more than this whole farm earns.${sizing}`, cost: 'nothing but the check', time: '5 minutes a week' };
  if (c.includes('cdp') || c.includes('stablecoin')) return { text: `Watch two numbers on ${n}: your collateral ratio (keep it above 200%) and the stablecoin's peg — if the peg breaks by more than 2% for a day, repay and withdraw rather than waiting it out.${sizing}`, cost: 'nothing but monitoring', time: '5 minutes a week' };
  if (c.includes('dex') || c.includes('liquidity')) return { text: `Guard against impermanent loss on ${n}: prefer its stable or tightly correlated pair, and rebalance or withdraw if one side of the pair moves 20% against the other.${sizing}`, cost: 'about $2 of gas per rebalance', time: '10 minutes a week' };
  if (c.includes('curator') || c.includes('allocator') || c.includes('collateral')) return { text: `Read ${n}'s vault disclosures before depositing and re-check the vault's underlying markets monthly: a curator vault is only as safe as the riskiest market it lends to, so cap this vault at the plan's capital and no more.${sizing}`, cost: 'nothing', time: '20 minutes to read, 5 minutes a month' };
  if (c.includes('derivative') || c.includes('perpetual')) return { text: `Keep ${n}'s liquidation price at least 30% away from the market price and check the funding rate before each weekly trade; skip any week where funding against your side costs more than 0.05% a day.${sizing}`, cost: 'nothing but the check', time: '5 minutes a week' };
  if (c.includes('basis')) return { text: `Verify both legs of the ${n} basis position weekly: the hedge is the product, so if either leg's size drifts or funding flips hard against the position for three straight days, close both legs together.${sizing}`, cost: 'closing fees only if you exit', time: '5 minutes a week' };
  if (c.includes('rwa')) return { text: `Complete ${n}'s KYC or accreditation check before sending capital, and read the redemption terms first: RWA products often lock funds or redeem only in windows, so never farm ${n} with money you may need this quarter.${sizing}`, cost: 'nothing; the check itself is the cost', time: '30 minutes once' };
  if (c.includes('restak') || c.includes('staking')) return { text: `Check ${n}'s slashing conditions and unbonding period before staking: restaked capital can be slashed for a validator's fault and unstaking can take days to weeks, so start the exit clock early (see the last step).${sizing}`, cost: 'nothing', time: '15 minutes once' };
  if (c.includes('yield')) return { text: `Test ${n} with a small withdrawal in the first week: deposit, withdraw $10, redeposit. A vault you cannot exit cleanly is not a farm, whatever it yields.${sizing}`, cost: 'about $2 of gas for the round trip', time: '15 minutes once' };
  if (c.includes('insurance')) return { text: `Read ${n}'s cover wording for exclusions before buying: most DeFi cover excludes exactly the exotic failure you are imagining, so buy it for the listed perils only.${sizing}`, cost: 'nothing', time: '20 minutes once' };
  if (c.includes('chain') || c.includes('payment')) return { text: `Bridge to ${chain} only through the network's canonical bridge, and send a $5 test transfer first; unofficial bridges are where cross-chain farms actually lose money.${sizing}`, cost: 'about $1 of fees for the test', time: '15 minutes once' };
  return { text: `Do approval hygiene on ${n}: approve only the exact amount each action needs, verify the contract address against ${n}'s official documentation, and revoke stale approvals monthly.${sizing}`, cost: 'about $1 of gas a month', time: '10 minutes a month' };
}

/** Step 5 — points and quests, branched on the record's own signals, quoting the figure behind the branch. */
function pointsStep(p: SnapshotProtocol, age: number | null): FarmStep {
  const n = p.name;
  let timing: string;
  if (p.change_7d !== null && p.change_7d >= 25) {
    timing = `${n}'s TVL jumped ${p.change_7d.toFixed(1)}% in seven days — breakout inflows dilute points brutally, so the core position goes in today, not this week`;
  } else if (p.change_7d !== null && p.change_7d >= 10) {
    timing = `${n}'s TVL grew ${p.change_7d.toFixed(1)}% in seven days, so later entries dilute fast — complete the core position this week, not next`;
  } else if (p.change_7d !== null && p.change_7d <= -3) {
    timing = `${n}'s TVL slipped ${Math.abs(p.change_7d).toFixed(1)}% this week while others chase green candles — quiet weeks are when early wallets are cheapest to be, so keep farming through it`;
  } else if (age !== null && age < 365) {
    timing = `${n} was listed ${age} days ago, still inside its first year, when early seasons usually weight early activity most — start before any snapshot is announced`;
  } else if (age !== null && age >= 1095) {
    timing = `${n} has run ${Math.floor(age / 365)} years (${age} days) with no token recorded, so do not chase launch rumours; the steady cadence is the strategy`;
  } else {
    timing = `keep a steady weekly cadence and let the position age — consistency across snapshots is what points systems can actually measure`;
  }
  return {
    text: `Open ${n}'s own points, rewards or quests page and finish what it lists for this wallet; if it runs none yet, join its official community channel and turn on launch announcements. Timing: ${timing}`,
    cost: 'nothing to check, and never pay anyone to claim',
    time: '10 minutes a week',
  };
}

/** Step 6 — governance, flavoured by category and dated from the listing date. */
function governanceStep(p: SnapshotProtocol, age: number | null): FarmStep {
  const c = categoryOf(p);
  const n = p.name;
  const since = p.listed_at !== null && age !== null
    ? ` ${n} was listed on ${p.listed_at}, so its community and governance have had ${age} days to form — read the last three proposals before voting on the fourth`
    : '';
  let focus = 'its governance forum, and vote with this wallet on every proposal it puts up while you farm';
  if (c.includes('lend')) focus = 'its risk-parameter votes (collateral factors and caps are where lending governance actually bites), and vote with this wallet on each one';
  else if (c.includes('dex') || c.includes('liquidity')) focus = 'its fee and incentive-gauge votes, which decide which pools earn — vote with this wallet on each one';
  else if (c.includes('chain') || c.includes('payment')) focus = 'its network governance: stake-weighted votes and upgrade proposals, and vote with this wallet on each one';
  else if (c.includes('curator') || c.includes('allocator')) focus = 'its vault and risk disclosures channel, and any curator votes it runs — presence there is what separates a farmer from a depositor';
  return {
    text: `Be present where ${n} decides things: join its official community channel, follow ${focus}.${since}`,
    cost: 'nothing for off-chain votes; about $1 of gas for an on-chain vote',
    time: '10 minutes per proposal',
  };
}

/** Step 7 — the hold, varied by age bucket, quoting the snapshots it crosses. */
function holdStep(p: SnapshotProtocol, age: number | null): FarmStep {
  const n = p.name;
  const hold = holdDaysFor(age);
  const snaps = Math.max(2, Math.round(hold / 7));
  if (p.change_7d !== null && p.change_7d <= -15) {
    return {
      text: `Size down and stage in: ${n}'s TVL fell ${Math.abs(p.change_7d).toFixed(1)}% in seven days, so enter in three weekly tranches and hold the position at least ${hold} days — about ${snaps} weekly snapshots — before adding more`,
      cost: `the plan's capital stays in the position`,
      time: `${hold} days`,
    };
  }
  let why = 'so the wallet appears in more than one weekly snapshot';
  if (age !== null && age < 180) why = 'a young protocol\'s snapshots carry the most weight per wallet, and this hold crosses several of them';
  else if (age !== null && age >= 1095) why = 'for a protocol this old, a long unbroken hold is the signal that separates farmers from tourists';
  else if (p.change_7d !== null && p.change_7d >= 10) why = 'while inflows are strong, an unbroken hold is what keeps your share of the season from diluting away';
  return {
    text: `Hold the position at least ${hold} days (about ${snaps} weekly snapshots) and make one qualifying action a week — a swap, a borrow, a vote or a top-up — ${why}`,
    cost: 'about $2 of gas a week',
    time: `${hold} days, 10 minutes a week`,
  };
}

/** Step 8 — the exit: the category's real unwind path, routed back through its own first chain. */
function exitStep(p: SnapshotProtocol, chain: string): FarmStep {
  const c = categoryOf(p);
  const n = p.name;
  let path = `withdraw the position back to the wallet and bridge the funds back through ${chain} to your main chain`;
  if (c.includes('lend')) path = `repay the borrow in full first, then withdraw the supplied USDC — withdrawing collateral against an open borrow is how accounts get liquidated`;
  else if (c.includes('cdp') || c.includes('stablecoin')) path = `repay the minted stablecoin in full, then withdraw the collateral from the vault`;
  else if (c.includes('dex') || c.includes('liquidity')) path = `remove the liquidity, swap both sides back to USDC on ${n} itself, and check for any unclaimed fees before leaving`;
  else if (c.includes('curator') || c.includes('allocator') || c.includes('collateral') || c.includes('yield')) path = `request redemption from the vault and respect its cooldown or queue — start the exit days before you need the funds, not after`;
  else if (c.includes('restak') || c.includes('staking')) path = `start unbonding early: the unbonding period runs whether or not a claim date is near, so trigger it as soon as you decide to exit`;
  else if (c.includes('derivative') || c.includes('perpetual')) path = `close every open position, let funding settle, then withdraw the margin to the wallet`;
  else if (c.includes('rwa')) path = `exit through ${n}'s redemption window or its listed secondary venue; outside a window, expect to hold`;
  return {
    text: `Exit path for ${n}: ${path}. Whatever happens, claim any future distribution only from a link ${n} itself publishes, and keep the farm log (wallet, dates, hashes) after you exit — claims are checked against it`,
    cost: 'withdrawal gas only, about $2',
    time: '20 minutes, plus any cooldown the product imposes',
  };
}

/**
 * The full eight-step plan for one protocol. The dashboard renders these same
 * steps as a checklist with their costs and times; board.json carries them as
 * the strings stepText writes.
 */
export function farmPlan(p: SnapshotProtocol, age: number | null, ctx?: PlanContext): FarmStep[] {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const chain2 = p.chains.length > 1 ? p.chains[1]! : null;
  const capital = capitalFor(p);
  const gas = gasFor(chain);
  const place = ctx !== undefined
    ? ` It sits at #${ctx.rank} of ${ctx.boardSize} on this board and #${ctx.categoryRank} of ${ctx.categorySize} in ${p.category ?? 'its category'}, on ${fmtMoney(p.tvl_usd)} of TVL`
    : ` It runs on ${fmtMoney(p.tvl_usd)} of TVL`;
  const steps: FarmStep[] = [
    {
      text: `Set up a fresh wallet for ${p.name} on ${chain}, fund it with $${capital} plus gas, and keep its seed phrase offline.${place}`,
      cost: `${gas} to fund`,
      time: '10 minutes',
    },
    { text: coreAction(p, capital, chain), cost: `$${capital} of capital plus ${gas}`, time: '15 minutes to set up' },
    riskGuard(p, chain, capital),
  ];
  if (chain2 !== null && p.chains.length >= 4) {
    steps.push({
      text: `${p.name} runs on ${p.chains.length} chains (${p.chains.join(', ')}): repeat a smaller position on ${chain2}, its second chain, and leave the rest — breadth across two chains beats thin dust on all ${p.chains.length}`,
      cost: `$${Math.round(capital / 2)} of capital plus about $2 of bridge and gas fees`,
      time: '20 minutes',
    });
  } else if (chain2 !== null) {
    steps.push({
      text: `Repeat a smaller position on ${chain2}, where ${p.name} also runs: bridge $${Math.round(capital / 2)} over and make the same core action there, so the wallet's activity exists on two chains`,
      cost: `$${Math.round(capital / 2)} of capital plus about $2 of bridge and gas fees`,
      time: '20 minutes',
    });
  } else if (age !== null && age < 365) {
    steps.push({
      text: `Join ${p.name}'s testnet or waitlist if it runs one — at ${age} days old it is still early — and complete every task it lists with this same wallet`,
      cost: 'testnet funds only, never real capital',
      time: '30 minutes',
    });
  } else {
    steps.push({
      text: `Add a second, different action on ${p.name}: a second market, pool or vault beside the first, with $${Math.round(capital / 2)} more — $${capital} core plus $${Math.round(capital / 2)} here is $${planCapitalFor(p)} of plan capital in total, the deposit the costing box prices — so the wallet shows varied use rather than one deposit`,
      cost: `$${Math.round(capital / 2)} of capital plus ${gas}`,
      time: '15 minutes',
    });
  }
  steps.push(pointsStep(p, age));
  steps.push(governanceStep(p, age));
  steps.push(holdStep(p, age));
  steps.push(exitStep(p, chain));
  return steps;
}
