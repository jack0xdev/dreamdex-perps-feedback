# dreamDEX Perps Bounty — Raw Evidence Transcript

Captured: 2026-10-20 13:07 UTC | Machine: Windows 11 (10.0.19045), Node v24.13.1
Target: dreamdex-bot-kit commit 2579866 (2026-10-12), @somnia-chain/markets-sdk 0.31.0 (perp-core pin)

---

## 1. Bounty repro suite — 11/11 tests PASS (vitest, packages/perp-core)

```

[1m[7m[36m RUN [39m[27m[22m [36mv2.1.9 [39m[90mC:/Users/Asik/ZCodeProject/dreamdex-bounty/dreamdex-bot-kit/packages/perp-core[39m

[90mstdout[2m | tests/bounty-repro.test.ts[2m > [22m[2mclosePosition (packages/perp-core/src/orders.ts)[2m > [22m[2mF2: sizes the close order from the earlier preview, not the fresh position it just read
[22m[39mplaced close short 0.00000000000000001 ETH @ 99.8 | filled 0 | order 1

 [32m✓[39m tests/bounty-repro.test.ts[2m > [22mNonceManager (packages/core/src/nonce.ts)[2m > [22mF1a: acquire() hangs FOREVER after maxInFlight callers that never call settled()[33m 1005[2mms[22m[39m
 [32m✓[39m tests/bounty-repro.test.ts[2m > [22mNonceManager (packages/core/src/nonce.ts)[2m > [22mF1b: resync() hands the same nonces out again while the 'stuck' txs may still be in flight
 [32m✓[39m tests/bounty-repro.test.ts[2m > [22mNonceManager (packages/core/src/nonce.ts)[2m > [22mF1c: concurrent acquires bypass the maxInFlight backpressure entirely
 [32m✓[39m tests/bounty-repro.test.ts[2m > [22mclosePosition (packages/perp-core/src/orders.ts)[2m > [22mF2: sizes the close order from the earlier preview, not the fresh position it just read
 [32m✓[39m tests/bounty-repro.test.ts[2m > [22mperp-funding decision block (strategies/perp-funding/src/index.ts:99-151)[2m > [22mF3a: the PERP_FUNDING_MAX_POSITION_USDSO cap check runs only where held === 0, so it can never fire
 [32m✓[39m tests/bounty-repro.test.ts[2m > [22mperp-funding decision block (strategies/perp-funding/src/index.ts:99-151)[2m > [22mF3b: an over-cap position is neither trimmed nor blocked — the cap bounds nothing
 [32m✓[39m tests/bounty-repro.test.ts[2m > [22mperp-guard read-only loop (strategies/perp-guard/src/index.ts:127-164)[2m > [22mF4: with no PRIVATE_KEY the guard reports NOTHING, contradicting 'health is reported'
 [32m✓[39m tests/bounty-repro.test.ts[2m > [22mDreamDexRest.ensureAuth (packages/core/src/rest.ts)[2m > [22mF5a: a token with a 2-minute lifetime (still valid!) is re-signed on EVERY request
 [32m✓[39m tests/bounty-repro.test.ts[2m > [22mDreamDexRest.ensureAuth (packages/core/src/rest.ts)[2m > [22mF5b: an expiresAt in SECONDS (unit mismatch) re-auths forever and never caches
 [32m✓[39m tests/bounty-repro.test.ts[2m > [22mDreamDexRest.ensureAuth (packages/core/src/rest.ts)[2m > [22mF5c: N concurrent requests with a stale token run N full SIWE logins (no single-flight)
 [32m✓[39m tests/bounty-repro.test.ts[2m > [22mDreamDexRest.ensureAuth (packages/core/src/rest.ts)[2m > [22mF5d (control): one long-lived token is cached and reused

[2m Test Files [22m [1m[32m1 passed[39m[22m[90m (1)[39m
[2m      Tests [22m [1m[32m11 passed[39m[22m[90m (11)[39m
[2m   Start at [22m 18:56:41
[2m   Duration [22m 5.11s[2m (transform 134ms, setup 0ms, collect 3.09s, tests 1.02s, environment 0ms, prepare 592ms)[22m

```

## 2. Full perp-core suite — 42/42 PASS (31 original + 11 repro)

```

[1m[7m[36m RUN [39m[27m[22m [36mv2.1.9 [39m[90mC:/Users/Asik/ZCodeProject/dreamdex-bounty/dreamdex-bot-kit/packages/perp-core[39m

 [32m✓[39m tests/units.test.ts [2m([22m[2m19 tests[22m[2m)[22m[90m 6[2mms[22m[39m
 [32m✓[39m tests/trading-key.test.ts [2m([22m[2m12 tests[22m[2m)[22m[90m 57[2mms[22m[39m
[90mstdout[2m | tests/bounty-repro.test.ts[2m > [22m[2mclosePosition (packages/perp-core/src/orders.ts)[2m > [22m[2mF2: sizes the close order from the earlier preview, not the fresh position it just read
[22m[39mplaced close short 0.00000000000000001 ETH @ 99.8 | filled 0 | order 1

 [32m✓[39m tests/bounty-repro.test.ts [2m([22m[2m11 tests[22m[2m)[22m[33m 1026[2mms[22m[39m
   [33m[2m✓[22m[39m NonceManager (packages/core/src/nonce.ts)[2m > [22mF1a: acquire() hangs FOREVER after maxInFlight callers that never call settled() [33m1011[2mms[22m[39m

[2m Test Files [22m [1m[32m3 passed[39m[22m[90m (3)[39m
[2m      Tests [22m [1m[32m42 passed[39m[22m[90m (42)[39m
[2m   Start at [22m 18:56:56
[2m   Duration [22m 2.01s[2m (transform 176ms, setup 0ms, collect 1.85s, tests 1.09s, environment 0ms, prepare 343ms)[22m

```

## 3. TypeScript check

```
TYPECHECK OK
```

## 4. Offline deterministic proofs (no network, no keys)

```

=== P1  trading-key selectors (packages/perp-core/src/operator.ts:40-44) ===
  placeOrderFor   keccak("placeOrderFor(address,bool,uint64,uint25...") -> 0x80054449
  cancelOrderFor  keccak("cancelOrderFor(address,uint128)...") -> 0xe37b444b
  reduceOrderFor  keccak("reduceOrderFor(address,uint128,uint256)...") -> 0x364c2587

=== P2  float price construction (orders.ts:293 / perp-starter:174 / perp-maker:142 pattern) ===
  exact raw        : 100000000000100000000000000
  through float64  : 100000000000099991603380224
  alignPrice(tick) : 100000000000000000000000000
  same tick?       : NO — dropped 100000000000000 wei (a full tick)
  tick-boundary misses scanning 200k consecutive tick multiples near 5e26: 100002

=== P3  repo's own rule (docs/gotchas.md #7 and markets.ts comment) ===
  docs/gotchas.md #7  : "Fix: quantize in integer space."
  markets.ts:126-129  : parseUnits(x.toFixed(18), 18) ... is wrong ... four wei off the tick grid
  orders.ts:293       : price: BigInt(Math.round(touch * 1e18))   <-- float64, not integer space
  perp-starter:174    : BigInt(Math.round(mark * (1 + TAKE_PROFIT_PCT / 100) * 1e18))

=== P4  NonceManager deadlock, observed live (packages/core/dist/nonce.js:46-66) ===
  maxInFlight = 2; acquiring 2 nonces and never calling settled() (caller threw):
  got nonce 5
  got nonce 6
  after 3000 ms: third acquire resolved? NO — still spinning in backpressure sleep
  (waited 3006 ms wall-clock; there is no timeout, error, or recovery path)

=== P5  closePosition sends a 10-unit close for a 4-unit position (orders.ts:234-298) ===
  captured from the F2 test run (vitest bounty-repro.test.ts):
  placed close short 0.00000000000000001 ETH @ 99.8 | filled 0 | order 1
  mocks: previewPerpClosePnl -> closedQuantity 10n; fetchPositions -> contracts 4
  asserted: trader received quantity 10n, isBid false  =>  6 units flip into a new short
```

## 5. Live read-only proofs (Hideki 50383 + public REST API)

```

=== L1  Hideki RPC chain id (docs/perps.md says 50383) ===
  eth_chainId -> 0xc4cf (decimal 50383)

=== L2  SDK perp reads on live Hideki (SomniaMarkets, no key) ===
  loadMarkets: 55 markets, 21 perp swaps
  ETH-PERP pool=0xd6cb1dd58580b84d76068ac21594219ce03aeddf
  ETH-PERP marginBank=0x478769e1177c0773c43a593dccc4ad15f15f1394
  fetchOrderBook (floats): bid [2392.06,2.9286] ask [2392.14,0.8117]
  fetchOrderBook (raw)    : bid 2392060000000000000000 ask 2392140000000000000000
  getPerpState: mark=2390376563208962000000 fundingRate=100000000000000 window=28800s interval=3600s
  getPerpHealthSnapshot: priceable=true imf=500bps mm=250bps
  getMarginAccount(zero): status=Healthy equity=0
  getMaxPerpOrderSize(zero): placeable=false limitedBy=collateral
  previewPerpClosePnl(zero): closedQuantity=0 priceable=true
  listPerpStopOrders(zero): 0 stop(s)
  getPerpStopOrderSomiPayment: 150000000000000000 wei = 0.15 SOMI per stop (stops.ts dry-run hardcodes "0.30" for a pair)

=== L3  isOperatorAuthorized on the live ETH pool (bot access / link-a-bot) ===
  isOperatorAuthorized(dummy, dummy, 0x80054449) = false  <- function exists, answers, does not revert
  isOperatorAuthorized(dummy, dummy, 0xe37b444b) = false  <- function exists, answers, does not revert
  isOperatorAuthorized(dummy, dummy, 0x364c2587) = false  <- function exists, answers, does not revert
  isOperatorAuthorized(dummy, dummy, 0xdeadbeef) = false  <- function exists, answers, does not revert

=== L4  REST API market table vs live perp markets ===
  GET /v0/markets -> 3 markets: SOMI:USDso@50312, WBTC:USDso@50312, WETH:USDso@50312
  perp rows: 0
  GET /v0/orderbooks?symbols=ETH:USDso -> HTTP 400 {"status":400,"name":"invalid_param","description":"unknown market symbols: ETH:USDso","context":{"invalid_symbols":["ET
```
