# Independent verification of the Z Code bounty report

Verified 2026-10-20 by re-reading the real source (`dreamdex-bot-kit` @ `2579866`), re-running
the live endpoints, and independently auditing the SDK core. Goal: separate what is **real and
submission-safe** from what is **overstated or has a misleading repro**, so nothing weak goes into
a bounty submission and risks the whole batch's credibility.

## Per-finding verdict

| # | Report severity | Verified verdict | Real severity | Why |
|---|-----------------|------------------|---------------|-----|
| F1 NonceManager | major | **partly real** | medium | F1c (concurrent `acquire` reads `inFlight` before the serialized increment → burst bypasses `maxInFlight`) is a genuine check-then-act race. F1a "hangs forever" is true **only if the caller breaks the documented `acquire→settled/resync` contract**; there is no timeout/recovery, which is a fair liveness point but not a normal-use deadlock. F1b (resync re-issues) is weak — `resync()` re-reads the pending nonce, which is the correct recovery. |
| F2 closePosition flip | major | **misleading repro — do not submit as-is** | low / unproven | The order quantity comes from `preview.closedQuantity` (**raw bigint**); the fresh `position` read is used only for *side*. The repro mocks `closedQuantity=10n` (raw) against `contracts=4` (**human units**) — different units, so "6 units flip" is a mock artifact. The only real concern is that the close is **not reduce-only** and sizes from the *staler* of two reads, so a position that shrinks in the ~ms between the two awaits could over-close. That is a narrow race and **was never demonstrated on a real fill** (see faucet note). |
| F3 funding cap dead code | major | **real, low impact** | low | `held >= MAX_POSITION` is in the `!position` branch where `held` is always 0, so it never fires — confirmed. But entry sizing already caps via `sizeForNotional(min(NOTIONAL, MAX_POSITION))` and entry only happens when flat, so there is **no unbounded-position risk**. Dead code, not a money bug. |
| F4 guard read-only reports nothing | major | **confirmed, clean** | normal (UX) | `index.ts:100` prints "health is reported but nothing is closed," then the loop does `if (!me) break;` → in read-only (`me` undefined) **zero health lines ever print**. Genuine self-contradiction. It is a log/UX defect, not "major." |
| F5 REST re-auth storm | major | **partly real, conditional** | medium | F5c (no single-flight → N concurrent requests run N SIWE logins) is real from the code. F5a (`REFRESH_MARGIN_MS = 3min`, so any token with lifetime < 3min re-auths on every call) and F5b (`expiresAt` compared as ms; if the API returns seconds it re-auths forever) are **real risks but conditional on the server's actual token TTL/unit**, which was not measured. Measure a real `/auth/login` response before claiming F5a/F5b as proven. |
| F6 float price off-grid | normal | **overstated — reduce to a style note** | cosmetic | At realistic prices (BTC 110k, ETH 2392, PEPE, ZEC, quoteDec 18) the `Math.round(x*1e18)` round-trip has **zero drift** and lands on the exact tick. The "100,002/200,000 misses" occur only near price ≈ 5×10⁸ (500 million), which no listed market has. Only "doesn't follow its own gotcha #7 (quantize in integer space)" survives, as a hygiene note. |
| F7 stops dry-run 0.30 | normal | **real, cosmetic** | trivial | The **dry-run log string** hardcodes "0.30 SOMI locked"; the actual arming path reads it live (`getPerpStopOrderSomiPayment`, 0.15/stop). Only the preview message misreports if the registry raises the fee. |
| F8 linkProblem ignores reduce | normal | **confirmed, real** | normal | `if (status.place && status.cancel) return undefined` ignores `status.reduce`, so a key missing only the reduce grant is reported "fully linked," and a later `reduceOrderFor` reverts. Genuine logic gap. |
| F9 starter stale bracket | normal | **confirmed, real** | normal | On restart with an already-armed bracket it logs "leaving them alone" and never compares the armed TP/SL to the (possibly changed) config, nor warns. Real UX/correctness gap. |
| F10 REST no perps / no Hideki | normal | **real observation, likely by-design** | feedback | Confirmed live: `GET /v0/markets` = 3 **spot** markets on Shannon (50312), **0 perps**, no Hideki (50383). If the public REST API is intentionally spot-only (perps via SDK/GraphQL) this is a docs/feature-gap feedback item, not a defect — frame it that way. |

**Keep (solid):** F4, F8, F9, and the F1c + F5c sub-claims.
**Keep but downgrade:** F3 (→ low, dead code), F7 (→ trivial), F10 (→ feedback/doc gap), F5a/F5b (→ conditional, measure first).
**Pull or heavily reframe:** F2 (misleading unit-mismatched repro; reframe as an unproven reduce-only race or drop), F6 (not triggerable at real prices; reduce to a style note).

## Scope reality

Every finding is in the **example `dreamdex-bot-kit` glue**, the **public REST API**, or **docs** —
**none** are in the SDK core or the on-chain contracts. The report itself routes them to the public
`feedback/` folder. For the "Break the Perps API and SDK" track these are accepted-format *feedback*
items ("every accepted report earns a bounty"), but they are kit/UX/doc bugs, so expect modest payout
per item and lead with the solid, cleanly-reproduced ones (F4, F8, F9).

## Independent SDK core audit (what the report called "clean")

Re-audited directly against the shipped SDK, not taken on trust:

- `units.js` — correct. Careful shortest-round-trip float handling, `balanceFloor` ULP nudge, grid snapping.
- `funding.js` — correct. Per-window denominator carried explicitly, truncation matches the contract,
  densification refuses to invent forgiven intervals.
- `derivedReads.js` PnL kernels (`computePositionPnL`, `computeBinaryPnl`) — correct avg-cost roll, exact
  cost release, no double-rounding.
- `perpLiquidationPrice` — **correct**, including the `10000 ∓ mmBps` both-sides-move factor and a
  floor-rounding direction that is uniformly cautious on long and short.
- `getMaxPerpOrderSize` — **correct as designed**: the `qStar` step converts the non-monotone IM gate
  into a monotone binary search; the ceiling is conservative; the one over-cap edge case under-states
  (safe), never over-states (which would revert).
- Perp order builder (`perpOrderCall`) — validates only `price/quantity > 0` and leaves tick/lot/min to
  the pool, by design (the facade snaps; the raw builder does not). Not a bug.

**Only real SDK robustness nit found:** `client.getPerpState()` **hard-throws an undecodable revert**
(selector `0xc95fe237`, not present in the SDK's own 538-entry `contractErrorsAbi`) when a market's
index oracle is momentarily unavailable, instead of returning `markPriceOk:false` as the documented
degradation path implies. **Intermittent** — on a later sweep all 24 global + 21 tokyo markets returned
state fine — so there is no deterministic repro yet. Include only if captured again (full error object +
block number + pool), framed as an intermittent error-typing/degradation gap, not a reliable bug.

## Faucet / "demo funds" reality

The app's Perps Arena shows **1,000 USDso** account equity, but on-chain the demo wallet's account
(`addressOf(0xc279937D93813E94794CeD4e93021160ca98d54B, 0..4)`) is **empty on both Hideki (50383) and
Shannon (50312)**. So the "no deposit required" demo is **off-chain / server-side paper** (or funds a
separate Privy-embedded account) — the SDK cannot see or trade it. Consequences:

- Every "live proof" in the report is **read-only**; no funded on-chain perp write was ever executed
  (consistent with the report's own "funded live write: NOT verified").
- **F2's position-flip cannot be demonstrated on a real fill** with this setup, so it stays a
  code-reading claim with a unit-mismatched mock — the single weakest item to submit.
