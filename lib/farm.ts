// The farm-plan generator: one protocol's record in, an eight-step plan out.
//
// Every plan is built from the protocol's own snapshot record — its category,
// its chains, its TVL tier, its age and its seven-day TVL direction — and
// every step carries what it costs and how long it takes. The steps are:
//   1. wallet setup on the protocol's first chain
//   2. the category's core action, naming the protocol's own product type
//   3. the category's risk guard (liquidation, impermanent loss, depeg,
//      slashing, KYC and lockups, vault underlyings — whatever can hurt here)
//   4. a second surface: the second chain when it has one, a testnet or
//      waitlist when it is young, a second product when neither applies
//   5. points and quests, timed by the record: fast-growing TVL dilutes late
//      entries, a first-year protocol's early season is still open, a
//      three-year protocol rewards patience instead of rumour-chasing
//   6. governance and community presence with the same wallet
//   7. the hold: long enough to cross weekly snapshots, tranched when the
//      protocol's TVL is falling fast
//   8. the exit: the category's real unwind path (repay before withdraw,
//      redemption queues, unbonding periods), then claim discipline
//
// No step is a slogan and no two protocols share a plan unless their records
// match: the plan a reader gets for a Monad lending market is not the plan
// they get for a Solana RWA platform.

import type { SnapshotProtocol } from './model.ts';

/** One farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
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

function categoryOf(p: SnapshotProtocol): string {
  return (p.category ?? '').toLowerCase();
}

/** Step 2 — the category's core farming action, naming the protocol and its first chain. */
function coreAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = categoryOf(p);
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

/** Step 3 — the risk guard for this category: the specific way this farm can lose money. */
function riskGuard(p: SnapshotProtocol, chain: string): FarmStep {
  const c = categoryOf(p);
  const n = p.name;
  if (c.includes('lend')) return { text: `Set a liquidation guard on ${n}: check the health factor weekly, and if it drifts toward 1.3, repay part of the borrow or add collateral the same day — a liquidation costs more than this whole farm earns`, cost: 'nothing but the check', time: '5 minutes a week' };
  if (c.includes('cdp') || c.includes('stablecoin')) return { text: `Watch two numbers on ${n}: your collateral ratio (keep it above 200%) and the stablecoin's peg — if the peg breaks by more than 2% for a day, repay and withdraw rather than waiting it out`, cost: 'nothing but monitoring', time: '5 minutes a week' };
  if (c.includes('dex') || c.includes('liquidity')) return { text: `Guard against impermanent loss on ${n}: prefer its stable or tightly correlated pair, and rebalance or withdraw if one side of the pair moves 20% against the other`, cost: 'about $2 of gas per rebalance', time: '10 minutes a week' };
  if (c.includes('curator') || c.includes('allocator') || c.includes('collateral')) return { text: `Read ${n}'s vault disclosures before depositing and re-check the vault's underlying markets monthly: a curator vault is only as safe as the riskiest market it lends to, so cap this vault at the plan's capital and no more`, cost: 'nothing', time: '20 minutes to read, 5 minutes a month' };
  if (c.includes('derivative') || c.includes('perpetual')) return { text: `Keep ${n}'s liquidation price at least 30% away from the market price and check the funding rate before each weekly trade; skip any week where funding against your side costs more than 0.05% a day`, cost: 'nothing but the check', time: '5 minutes a week' };
  if (c.includes('basis')) return { text: `Verify both legs of the ${n} basis position weekly: the hedge is the product, so if either leg's size drifts or funding flips hard against the position for three straight days, close both legs together`, cost: 'closing fees only if you exit', time: '5 minutes a week' };
  if (c.includes('rwa')) return { text: `Complete ${n}'s KYC or accreditation check before sending capital, and read the redemption terms first: RWA products often lock funds or redeem only in windows, so never farm ${n} with money you may need this quarter`, cost: 'nothing; the check itself is the cost', time: '30 minutes once' };
  if (c.includes('restak') || c.includes('staking')) return { text: `Check ${n}'s slashing conditions and unbonding period before staking: restaked capital can be slashed for a validator's fault and unstaking can take days to weeks, so start the exit clock early (see the last step)`, cost: 'nothing', time: '15 minutes once' };
  if (c.includes('yield')) return { text: `Test ${n} with a small withdrawal in the first week: deposit, withdraw $10, redeposit. A vault you cannot exit cleanly is not a farm, whatever it yields`, cost: 'about $2 of gas for the round trip', time: '15 minutes once' };
  if (c.includes('insurance')) return { text: `Read ${n}'s cover wording for exclusions before buying: most DeFi cover excludes exactly the exotic failure you are imagining, so buy it for the listed perils only`, cost: 'nothing', time: '20 minutes once' };
  if (c.includes('chain') || c.includes('payment')) return { text: `Bridge to ${chain} only through the network's canonical bridge, and send a $5 test transfer first; unofficial bridges are where cross-chain farms actually lose money`, cost: 'about $1 of fees for the test', time: '15 minutes once' };
  return { text: `Do approval hygiene on ${n}: approve only the exact amount each action needs, verify the contract address against ${n}'s official documentation, and revoke stale approvals monthly`, cost: 'about $1 of gas a month', time: '10 minutes a month' };
}

/** Step 5 — points and quests, with the timing the protocol's own record implies. */
function pointsStep(p: SnapshotProtocol, age: number | null): FarmStep {
  const n = p.name;
  let timing = 'keep a steady weekly cadence and let the position age';
  if (p.change_7d !== null && p.change_7d >= 10) {
    timing = `${n}'s TVL grew ${p.change_7d.toFixed(1)}% in seven days, so later entries dilute fast — complete the core position this week, not next`;
  } else if (age !== null && age < 365) {
    timing = `${n} is still in its first year (${age} days), when early seasons usually weight early activity most — start before any snapshot is announced`;
  } else if (age !== null && age >= 1095) {
    timing = `${n} has run ${Math.floor(age / 365)} years with no token recorded, so do not chase launch rumours; the steady cadence is the strategy`;
  }
  return {
    text: `Open ${n}'s own points, rewards or quests page and finish what it lists for this wallet; if it runs none yet, join its official community channel and turn on launch announcements. Timing: ${timing}`,
    cost: 'nothing to check, and never pay anyone to claim',
    time: '10 minutes a week',
  };
}

/** Step 8 — the exit: how this category actually unwinds, then claim discipline. */
function exitStep(p: SnapshotProtocol, chain: string): FarmStep {
  const c = categoryOf(p);
  const n = p.name;
  let path = `withdraw the position back to the wallet and bridge the funds back to your main chain`;
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
export function farmPlan(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const chain2 = p.chains.length > 1 ? p.chains[1]! : null;
  const capital = capitalFor(p);
  const gas = gasFor(chain);
  const hold = holdDaysFor(age);
  const steps: FarmStep[] = [
    {
      text: `Set up a fresh wallet for ${p.name} on ${chain}, fund it with $${capital} plus gas, and keep its seed phrase offline`,
      cost: `${gas} to fund`,
      time: '10 minutes',
    },
    { text: coreAction(p, capital, chain), cost: `$${capital} of capital plus ${gas}`, time: '15 minutes to set up' },
    riskGuard(p, chain),
  ];
  if (chain2 !== null) {
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
      text: `Add a second, different action on ${p.name}: a second market, pool or vault beside the first, with $${Math.round(capital / 2)} more, so the wallet shows varied use rather than one deposit`,
      cost: `$${Math.round(capital / 2)} of capital plus ${gas}`,
      time: '15 minutes',
    });
  }
  steps.push(pointsStep(p, age));
  steps.push({
    text: `Be present where ${p.name} decides things: join its official community channel, follow its governance forum, and vote with this wallet on every proposal it puts up while you farm`,
    cost: 'nothing for off-chain votes; about $1 of gas for an on-chain vote',
    time: '10 minutes per proposal',
  });
  if (p.change_7d !== null && p.change_7d <= -15) {
    steps.push({
      text: `Size down and stage in: ${p.name}'s TVL fell ${Math.abs(p.change_7d).toFixed(1)}% in seven days, so enter in three weekly tranches and hold the position at least ${hold} days before adding more`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    });
  } else {
    steps.push({
      text: `Hold the position at least ${hold} days and make one qualifying action a week — a swap, a borrow, a vote or a top-up — so the wallet appears in more than one weekly snapshot`,
      cost: 'about $2 of gas a week',
      time: `${hold} days, 10 minutes a week`,
    });
  }
  steps.push(exitStep(p, chain));
  return steps;
}
