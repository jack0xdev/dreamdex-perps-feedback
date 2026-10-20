// Deterministic offline proofs — no network, no keys. Run from repo root:
//   node ../../evidence/run-offchain-proofs.mjs
import { keccak256, toHex } from "viem";

const log = (...a) => console.log(...a);
const line = (t) => console.log("\n=== " + t + " ===");

// ── P1: trading-key selectors in operator.ts vs keccak of the ABI signatures ──
line("P1  trading-key selectors (packages/perp-core/src/operator.ts:40-44)");
const sigs = {
  placeOrderFor: "placeOrderFor(address,bool,uint64,uint256,uint256,uint64,uint8,uint8,address,uint96)",
  cancelOrderFor: "cancelOrderFor(address,uint128)",
  reduceOrderFor: "reduceOrderFor(address,uint128,uint256)",
};
for (const [name, sig] of Object.entries(sigs)) {
  const got = keccak256(toHex(sig)).slice(0, 10);
  log(`  ${name.padEnd(15)} keccak("${sig.slice(0, 40)}...") -> ${got}`);
}

// ── P2: float64 price round-trip breaks the tick grid at high raw scales ──
line("P2  float price construction (orders.ts:293 / perp-starter:174 / perp-maker:142 pattern)");
{
  const tick = 10n ** 14n;
  const raw = 100000000000100000000000000n; // clean tick multiple, BTC-scale×1000
  const human = Number(raw) / 1e18;         // what the SDK hands the strategy (fetchOrderBook)
  const back = BigInt(Math.round(human * 1e18)); // what the strategies rebuild
  const aligned = (back / tick) * tick;
  log(`  exact raw        : ${raw}`);
  log(`  through float64  : ${back}`);
  log(`  alignPrice(tick) : ${aligned}`);
  log(`  same tick?       : ${aligned === raw ? "yes" : "NO — dropped " + (raw - aligned) + " wei (a full tick)"}`);
  let misses = 0;
  for (let i = 0; i < 200_000; i++) {
    const k = 50_000_000_000_000n + BigInt(i); // 200k consecutive tick multiples near 5e26
    const r = k * tick;
    const rt = (BigInt(Math.round((Number(r) / 1e18) * 1e18)) / tick) * tick;
    if (rt !== r) misses += 1;
  }
  log(`  tick-boundary misses scanning 200k consecutive tick multiples near 5e26: ${misses}`);
}

// ── P3: the repo's own guard contradicts it — quoted from source ──
line("P3  repo's own rule (docs/gotchas.md #7 and markets.ts comment)");
log('  docs/gotchas.md #7  : "Fix: quantize in integer space."');
log("  markets.ts:126-129  : parseUnits(x.toFixed(18), 18) ... is wrong ... four wei off the tick grid");
log("  orders.ts:293       : price: BigInt(Math.round(touch * 1e18))   <-- float64, not integer space");
log("  perp-starter:174    : BigInt(Math.round(mark * (1 + TAKE_PROFIT_PCT / 100) * 1e18))");

// ── P4: NonceManager — the deadlock is real wall-clock time ──
line("P4  NonceManager deadlock, observed live (packages/core/dist/nonce.js:46-66)");
const { NonceManager } = await import("../dreamdex-bot-kit/packages/core/dist/nonce.js");
{
  const client = { getTransactionCount: async () => 5 };
  const nm = new NonceManager(client, "0x0000000000000000000000000000000000000001", 2);
  log("  maxInFlight = 2; acquiring 2 nonces and never calling settled() (caller threw):");
  log("  got nonce " + (await nm.acquire()));
  log("  got nonce " + (await nm.acquire()));
  let done = false;
  const t0 = Date.now();
  nm.acquire().then((n) => { done = true; log(`  third acquire resolved with ${n}`); });
  await new Promise((r) => setTimeout(r, 3_000));
  log(`  after 3000 ms: third acquire resolved? ${done ? "yes" : "NO — still spinning in backpressure sleep"}`);
  log(`  (waited ${Date.now() - t0} ms wall-clock; there is no timeout, error, or recovery path)`);
}

// ── P5: closePosition stale-size flip — the order that was actually built ──
line("P5  closePosition sends a 10-unit close for a 4-unit position (orders.ts:234-298)");
log("  captured from the F2 test run (vitest bounty-repro.test.ts):");
log('  placed close short 0.00000000000000001 ETH @ 99.8 | filled 0 | order 1');
log("  mocks: previewPerpClosePnl -> closedQuantity 10n; fetchPositions -> contracts 4");
log("  asserted: trader received quantity 10n, isBid false  =>  6 units flip into a new short");
process.exit(0);
