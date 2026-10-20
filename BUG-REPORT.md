# dreamDEX Perps Builder Bounty — Bug Report (corrected, submission-safe)

**Track:** Break it — feedback on the Perps API, SDK and the official `dreamdex-bot-kit`.
**Target:** `dreamdex-bot-kit` @ `2579866` (2026-10-12) and `@somnia-chain/markets-sdk` 0.30.0/0.31.0
(the versions the kit pins); SDK core cross-checked against 0.32.0-rc. Live: Hideki (50383) + Shannon
(50312) RPC/GraphQL and `api.testnet.dreamdex.io/v0` (read-only).
**Audited & independently verified:** 2026-10-20.

> This is a corrected version of the first draft. Severities are honest, two draft findings were
> pulled/reframed after they failed verification, and each kept finding has a repro that survives
> scrutiny. See `VERIFICATION.md` for the full pass/fail reasoning.

## Honest scope

All findings are in the **example bot-kit glue**, the **public REST API**, or **docs** — not in the
SDK core or the contracts. They are correctness / liveness / UX / doc defects, so they belong in the
public `feedback/` folder, one Markdown file per issue. The SDK core (funding math, liquidation-price
solve, max-order-size search, PnL kernels, unit handling) was audited directly and **held up** — see
"SDK core: audited, no defect found" below.

## Findings (corrected severities)

| # | Severity | Location | Bug | Repro |
|---|----------|----------|-----|-------|
| 01 | **medium** | `packages/core/src/nonce.ts` | Concurrent `acquire()` reads `inFlight` **before** the serialized increment, so a burst of N callers all pass the `maxInFlight` backpressure gate at once (cap bypassed). Separately, a caller that acquires and never calls `settled()`/`resync()` wedges the manager with **no timeout or recovery path**. | `evidence/run-offchain-proofs.mjs` P4 + repro F1c |
| 02 | **normal** | `packages/perp-core/src/orders.ts:234` | `closePosition` is **not reduce-only** and sizes the order from `preview.closedQuantity` read *before* the fresh `position` read (which it uses only for side). A position that shrinks between the two reads can over-close and flip. **Narrow race; not demonstrated on a live fill.** | code walk-through only (see note) |
| 03 | **low** | `strategies/perp-funding/src/index.ts:127` | `PERP_FUNDING_MAX_POSITION_USDSO` check is dead code (sits in the `!position` branch where `held===0`). Harmless today because entry sizing already caps via `sizeForNotional(min(NOTIONAL, MAX_POSITION))`, but the cap bounds nothing and will mislead anyone who raises `NOTIONAL`. | repro F3a/F3b |
| 04 | **normal** | `strategies/perp-guard/src/index.ts:100,140` | Read-only mode prints `"health is reported but nothing is closed"` then `if (!me) break;` skips every market → **no health is ever reported**, contradicting its own message. | repro F4 |
| 05 | **medium** | `packages/core/src/rest.ts:99` | `ensureAuth` has **no single-flight**: N concurrent requests with an expired token run N full SIWE logins. Also fragile: `REFRESH_MARGIN_MS = 3min` means any token with TTL < 3min re-auths on every call, and `expiresAt` is compared as ms — if the API returns **seconds**, it re-auths forever. (Measure a real `/auth/login` response to confirm the TTL/unit arms.) | repro F5c (solid); F5a/F5b (conditional) |
| 06 | **normal** | `packages/perp-core/src/operator.ts:128` | `linkProblem` returns "no problem" when `place && cancel` are granted, **ignoring a missing `reduce` grant** — so a key that cannot `reduceOrderFor` is reported fully linked and reverts later. | `linkStatus`/`linkProblem` source |
| 07 | **normal** | `strategies/perp-starter/src/index.ts:165` | On restart with an already-armed bracket, the bot keeps it and **never compares the armed TP/SL to changed config, nor warns** — new settings are silently ignored. | source walk-through |
| 08 | **trivial** | `packages/perp-core/src/stops.ts:81` | Dry-run **log string** hardcodes `"0.30 SOMI locked"` while the real path reads the lock live (`getPerpStopOrderSomiPayment`, 0.15/stop). Misreports only in the preview if the registry fee changes. | `evidence/05-live-proofs.txt` L2 |
| 09 | **feedback** | API + docs | `GET /v0/markets` returns 3 **spot** markets on Shannon (50312), **0 perps**, and no Hideki (50383) entry. If the REST API is intentionally spot-only (perps via SDK/GraphQL), this is a docs/feature-gap note; if gotcha #15 tells builders to read perp decimals there, it is a real gap. | `evidence/05-live-proofs.txt` L4 |

## Pulled / reframed from the first draft (did not survive verification)

- **"closePosition sends a 10-unit close for a 4-unit position" (was major):** the draft repro mocked
  `previewPerpClosePnl.closedQuantity = 10n` (**raw units**) against `fetchPositions.contracts = 4`
  (**human units**) — two different scales, so the "6 units flip" was a mock artifact, not a demonstrated
  behavior. Kept only as finding 02 above, honestly scoped as an undemonstrated reduce-only race.
- **"float price construction provably off-tick" (was normal, "major-ish"):** at every realistic price on
  these markets the `Math.round(x*1e18)` round-trip has **zero drift** and lands on the exact tick. The
  draft's "100,002/200,000 misses" only occur near price ≈ 5×10⁸, which no listed market has. Reduced to a
  hygiene note ("follow gotcha #7 and quantize in integer space"), not a defect.

## SDK core: audited, no defect found (state this in the submission — it builds credibility)

Independently re-audited against the shipped SDK:

- **`perpLiquidationPrice`** — correct, incl. the `10000 ∓ mmBps` both-sides-move factor and a
  floor-rounding direction that is uniformly cautious on long and short.
- **`getMaxPerpOrderSize`** — correct as designed: the `qStar` step makes the non-monotone IM gate a
  monotone binary search; the one over-cap edge case under-states (safe), never over-states.
- **`funding.ts`** — window/interval denominator carried per-row, truncation matches the contract,
  densification refuses to invent forgiven intervals.
- **`units` + PnL kernels** — shortest-round-trip float handling, exact avg-cost roll, no double-rounding.
- **Trading-key selectors** `0x80054449` / `0xe37b444b` / `0x364c2587` — recomputed with keccak, exact.

**One intermittent robustness nit (include only if captured again):** `client.getPerpState()` hard-throws
an **undecodable** revert (selector `0xc95fe237`, not in the SDK's 538-entry error ABI) when a market's
index oracle is momentarily unavailable, instead of returning `markPriceOk:false`. Seen once on
SWSOL/SWBNB (global), then cleared on the next sweep — so no deterministic repro. Frame as an intermittent
error-typing/degradation gap if you can re-capture the full error object + block + pool.

## Note on the demo funds (affects what can be proven)

The Perps Arena "no deposit" demo shows 1,000 USDso in-app but the wallet's account is **empty on-chain**
(both 50383 and 50312) — the demo balance is off-chain/server-side. So no funded on-chain perp write was
performed, and every live proof here is read-only. Finding 02 cannot be confirmed on a real fill with this
setup; present it as a code-level observation only.

## How to run the repros

```bash
cd dreamdex-bot-kit
npm install
cd packages/perp-core
../../node_modules/.bin/vitest run tests/bounty-repro.test.ts   # F1c, F3, F4, F5c (+ the conditional/pulled ones)
node ../../evidence/run-offchain-proofs.mjs                      # P4 nonce liveness
node ../../evidence/run-live-proofs.mjs                          # read-only live: chain id, perp reads, REST table
```
