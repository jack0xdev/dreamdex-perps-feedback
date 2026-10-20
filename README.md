<div align="center">

# dreamDEX Perps Security & Feedback Report

**Break-it track** · verified bugs with runnable repros · missing order-type features vs top perp DEXs · SDK & API doc gaps

[![Track](https://img.shields.io/badge/track-Break%20it-orange)](https://dorahacks.io/hackathon/dreamdex-perps-bounty)
[![SDK](https://img.shields.io/badge/SDK-%40somnia--chain%2Fmarkets--sdk-blue)](https://www.npmjs.com/package/@somnia-chain/markets-sdk)
[![Chain](https://img.shields.io/badge/chain-Somnia%20Hideki%2050383%20%2F%20Shannon%2050312-5865F2)](https://somnia.network)
[![Repros](https://img.shields.io/badge/repros-runnable-brightgreen)](#-reproduce-everything)
[![SDK core](https://img.shields.io/badge/SDK%20core%20math-verified%20correct-success)](#-what-i-verified-is-correct)

</div>

---

## Summary

I hammered the dreamDEX Perps stack end to end — the `@somnia-chain/markets-sdk`, the official
[`dreamdex-bot-kit`](https://github.com/somnia-chain/dreamdex-bot-kit) (`@2579866`), and the public REST
API — against the live **Somnia Hideki (50383)** and **Shannon (50312)** testnets.

This report is deliberately **honest and self-verified**: every finding was re-checked against the real
source, each one ships a repro you can run, overstated items were dropped, and I explicitly call out the
parts of the SDK that are **correct** so a reviewer can trust the parts I flag.

> **Headline:** the SDK's core math (liquidation price, max-order-size, funding, PnL) is **solid**. The
> real issues are in the bot-kit glue, the perp order **feature set**, the **REST API** surface, and the
> **docs**.

---

## Table of contents

- [Findings at a glance](#findings-at-a-glance)
- [Bugs (with repros)](#-bugs)
- [Missing features vs top perp DEXs](#-missing-features-vs-top-perp-dexs)
- [Broken / missing docs](#-broken--missing-docs)
- [What I verified is correct](#-what-i-verified-is-correct)
- [Reproduce everything](#-reproduce-everything)
- [Repository layout](#-repository-layout)
- [Scope & disclosure](#-scope--disclosure)

---

## Findings at a glance

| # | Type | Severity | Area | One-liner |
|---|------|----------|------|-----------|
| B1 | Bug | 🔴 major | `core/nonce.ts` | Concurrent `acquire()` bypasses the in-flight cap; a stuck caller wedges it forever (no recovery) |
| B2 | Bug | 🔴 major | `core/rest.ts` | `ensureAuth` has no single-flight → N concurrent calls = N SIWE logins; short/seconds-unit tokens re-auth every request |
| B3 | Bug | 🟠 medium | `perp-core/operator.ts` | "Link a bot" reports a key fully linked even when the **reduce** grant is missing → later revert |
| B4 | Bug | 🟠 medium | `perp-starter` | Restart keeps the **old** TP/SL bracket after config changes, with no warning |
| B5 | Bug | 🟡 low | `perp-guard` | Read-only mode promises "health is reported", then prints nothing |
| M1 | Missing | ⭐ high value | SDK order path | **No reduce-only flag on normal orders** (only on stop orders) |
| M2 | Missing | ⭐ | SDK order path | No **TWAP** orders |
| M3 | Missing | ⭐ | SDK order path | No **scale / ladder** orders |
| M4 | Missing | ⭐ high value | REST API | **No perp markets in the public REST API at all** |
| D1–D3 | Docs | 📄 | docs | Perps nearly undocumented; stop orders mislabeled "spot only"; funding-window caveat only in code |

Full pass/fail reasoning for each item (including two findings I **dropped** for being overstated) is in
[`VERIFICATION.md`](VERIFICATION.md).

---

## 🐞 Bugs

### B1 — Nonce manager: cap bypass + permanent wedge  ·  🔴 major
**`packages/core/src/nonce.ts`**

`acquire()` checks the in-flight counter *before* it increments it, and the two steps are not atomic. Under
concurrency, several callers pass the `maxInFlight` gate while the counter is still low, so the manager hands
out **more nonces than its own limit**. Separately, if a caller takes a nonce and never calls `settled()` or
`resync()` (e.g. the send threw), the counter never drains and **every later `acquire()` waits forever** —
there is no timeout and no recovery path.

**Impact:** defeats the backpressure that protects a high-throughput bot, and can silently freeze it.
**Repro:** `evidence/run-offchain-proofs.mjs` (P4) + `repro/bounty-repro.test.ts` (F1c).

### B2 — REST auth re-login storm  ·  🔴 major
**`packages/core/src/rest.ts` (`ensureAuth`)**

No single-flight guard: N concurrent requests with an expired token each run a full SIWE sign-in. It also
refreshes 3 min before expiry (`REFRESH_MARGIN_MS`), so any token with a life under 3 min re-signs on
**every** request, and `expiresAt` is compared as milliseconds — if the API returns **seconds**, the token
always looks expired and it re-logs-in forever.

**Impact:** one logical request becomes many sign-ins — the fastest way to get a bot rate-limited.
**Repro:** `repro/bounty-repro.test.ts` (F5c). *The short-token / seconds-unit arms depend on the API's real
token lifetime, which I couldn't measure without a whitelisted account — the "no single-flight" part is
confirmed from code.*

### B3 — "Link a bot" ignores a missing reduce grant  ·  🟠 medium
**`packages/perp-core/src/operator.ts` (`linkProblem`)**

`linkProblem()` returns "no problem" as soon as `place` and `cancel` are granted and **never checks
`reduce`**. A key missing only the reduce grant is reported fully linked, then the first `reduceOrderFor`
reverts on-chain — the exact gap this helper exists to catch.

### B4 — Changed TP/SL silently ignored on restart  ·  🟠 medium
**`strategies/perp-starter/src/index.ts`**

On restart, if a bracket is already armed the bot logs "leaving them alone" and never compares the armed
triggers to the (possibly changed) config, nor warns. A user who lowers their stop-loss and restarts believes
the new level is live — it isn't.

### B5 — Read-only guard reports nothing  ·  🟡 low (UX)
**`strategies/perp-guard/src/index.ts`**

With no key it prints `"read-only: ... health is reported but nothing is closed"`, then the market loop does
`if (!me) break;` and exits before printing a single health line. **Repro:** `repro/bounty-repro.test.ts` (F4).

---

## 🧩 Missing features vs top perp DEXs

Benchmarked against **Hyperliquid** and **Lighter**, the usual references for an on-chain order-book perp DEX.

### M1 — No reduce-only flag on normal market/limit orders  ·  ⭐ highest value
`placePerpOrder` has no reduce-only option — in the SDK, reduce-only exists **only** on stop orders
(`perp/stops.js`, `intent: "reduceOnly"`). On Hyperliquid, Lighter and every major CEX, reduce-only is a
basic flag on ordinary orders that guarantees an order can only **shrink** a position, never flip it.

Without it, any "close position" flow that sizes from a slightly stale read can over-fill and open a position
the other way. A reduce-only order would make a safe close a one-liner. Evidence: `perpOrderCall` args carry
no reduce-only field; grep shows `reduceOnly` only under `perp/stops.js`.

### M2 — No TWAP orders  ·  ⭐
No time-sliced order type. Hyperliquid and Lighter both offer TWAP (split a large order into timed child
orders with a per-slice slippage cap). `twap` returns nothing in the SDK. Significant for any sizeable order.

### M3 — No scale / ladder orders  ·  ⭐
No way to place multiple limits across a price range in one action (Hyperliquid has scale orders). Today each
level must be placed and tracked by hand.

### M4 — The public REST API has no perps at all  ·  ⭐ highest value
`GET /v0/markets` returns 3 **spot** markets on Shannon (50312), **zero** perps, and no Hideki (50383) entry;
`GET /v0/orderbooks?symbols=ETH:USDso` → HTTP 400 `invalid_param`. So perps are only reachable through the
SDK + GraphQL indexer. For a **Perps API** bounty this is the biggest gap — either the REST perp endpoints
are missing, or the docs must clearly say REST is spot-only and route perp builders to the SDK.
**Evidence:** `evidence/run-live-proofs.mjs` (L4), `evidence/05-live-proofs.txt`.

---

## 📄 Broken / missing docs

- **Perps are barely documented** in the TypeScript guide (`llms-full.txt`): no `placePerpOrder` /
  `depositMargin` examples, and **no formulas** for funding, liquidation price, or margin — even though the
  SDK implements them correctly. A builder has to read the `.d.ts` files.
- **Stop orders labelled "spot only"**, yet the SDK has a full perp stop-order system (TP/SL brackets, an
  on-chain stop registry). The docs undersell a real feature.
- **Funding-window caveat lives only in code comments.** Live pools run mixed settlement intervals (I saw
  3600s and 300s); the per-interval accrual differs, and a fixed denominator produces a wrong funding chart.
  That warning belongs in the docs.

---

## ✅ What I verified *is* correct

Stated on purpose — it bounds the blast radius and shows the flags above are deliberate, not noise.

- **`perpLiquidationPrice`** — correct, incl. the long/short `10000 ∓ mmBps` maintenance asymmetry and a
  floor-rounding direction that is uniformly cautious on both sides.
- **`getMaxPerpOrderSize`** — correct as designed: the `qStar` step turns the non-monotone initial-margin gate
  into a monotone binary search, and the one over-cap edge case **under**-states (never a size that reverts).
- **Funding math, unit conversions, PnL kernels** — all correct.
- **Trading-key selectors** (`placeOrderFor` / `cancelOrderFor` / `reduceOrderFor`) — match keccak exactly;
  on-chain `isOperatorAuthorized` answers correctly on the live pool.

---

## 🔁 Reproduce everything

```bash
# 1. Clone the official kit NEXT TO this repo (the offline/vitest proofs import from it)
git clone https://github.com/somnia-chain/dreamdex-bot-kit
cd dreamdex-bot-kit && git checkout 2579866 && npm install

# 2. Copy the repro test in and run it (B-series)
cp ../dreamdex-perps-feedback/repro/bounty-repro.test.ts packages/perp-core/tests/
cd packages/perp-core && ../../node_modules/.bin/vitest run tests/bounty-repro.test.ts

# 3. Deterministic offline proofs (nonce liveness, selectors)
node ../../../dreamdex-perps-feedback/evidence/run-offchain-proofs.mjs

# 4. Read-only live proofs (chain id, perp reads, REST table) — no keys
node ../../../dreamdex-perps-feedback/evidence/run-live-proofs.mjs
```

Captured outputs for all of the above are in [`evidence/`](evidence/) (`01`–`05` + `EVIDENCE.md`).

---

## 📁 Repository layout

```
README.md            → this report
VERIFICATION.md      → per-finding pass/fail reasoning (incl. 2 findings dropped as overstated)
BUG-REPORT.md        → corrected, submission-format write-up
repro/
  bounty-repro.test.ts   → vitest repros (B1 F1c, B5 F4, B2 F5c, …)
evidence/
  run-live-proofs.mjs    → read-only live proofs (no keys)
  run-offchain-proofs.mjs→ deterministic offline proofs
  01–05*.txt, EVIDENCE.md→ captured raw outputs
```

---

## 🔒 Scope & disclosure

Everything here is a **correctness / liveness / UX / docs / feature** issue in the shipped kit, the API
surface, and the docs — **no fund-loss or protocol security vulnerability**. Per the bounty rules these
belong in the public **Feedback** track, not a private security email. All testing was read-only or on local
mock state; the Perps Arena demo balance is off-chain, so no funded on-chain write was performed.

<div align="center">

**Built & tested on Somnia testnet** · order-book perp DEX tooling · SDK/API integration · differential testing

</div>
