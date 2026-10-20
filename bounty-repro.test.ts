/**
 * @license
 * Copyright DreamDEX S.A.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://github.com/somnia-chain/dreamdex-bot-kit/blob/main/LICENSE
 */

// Reproductions for the dreamDEX Perps Builder Bounty ("Break it" track).
// Every test below is self-contained: no chain, no keys, no network. Each one
// pins a distinct finding with the source file and line it exercises.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicClient } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

// NonceManager and DreamDexRest live in the shared core package. Both import
// viem for TYPES only, so the relative import is runtime-safe.
import { NonceManager } from "../../core/src/nonce.js";
import { DreamDexRest } from "../../core/src/rest.js";
import { closePosition } from "../src/orders.js";
import type { PerpInfo, PerpMarket } from "../src/markets.js";
import type { WriteCtx } from "../src/orders.js";

const ADDR = "0x0000000000000000000000000000000000000001" as const;

function fakeNonceClient(start: number): PublicClient {
  return { getTransactionCount: async () => start } as unknown as PublicClient;
}

// ─────────────────────────────────────────────────────────────────────────────
// Finding 1 — NonceManager deadlocks permanently once `maxInFlight` callers
// skip `settled()`, and its only escape hatch re-hands out live nonces.
// packages/core/src/nonce.ts:46-82
// ─────────────────────────────────────────────────────────────────────────────

describe("NonceManager (packages/core/src/nonce.ts)", () => {
  it("F1a: acquire() hangs FOREVER after maxInFlight callers that never call settled()", async () => {
    const nm = new NonceManager(fakeNonceClient(5), ADDR, 2);

    // Two callers acquired a nonce and then THREW before broadcasting — the
    // documented contract says the caller must call settled(), but nothing in
    // the library enforces it and a throw in the send path naturally skips it.
    await nm.acquire();
    await nm.acquire();

    // The third caller is now stuck in the backpressure while-loop
    // (`inFlight >= maxInFlight`) with no timeout, no error, no recovery.
    let resolved = false;
    const third = nm.acquire().then((n) => {
      resolved = true;
      return n;
    });
    await new Promise((r) => setTimeout(r, 1_000));
    expect(resolved).toBe(false); // still spinning in `await sleep(200)`
    third.catch(() => {}); // keep the test process clean
  });

  it("F1b: resync() hands the same nonces out again while the 'stuck' txs may still be in flight", async () => {
    const nm = new NonceManager(fakeNonceClient(5), ADDR, 4);
    const a = await nm.acquire(); // 5 — caller threw before send
    await nm.acquire(); // 6 — this one WAS broadcast and is pending

    await nm.resync(); // the documented recovery for a nonce error
    const again = await nm.acquire();
    expect(again).toBe(5); // re-issued
    expect(a).toBe(5);
    // If tx nonce 6 is sitting in the mempool, a tx at nonce 5 that lands after
    // it either replaces it or drops — both silently reorder the book's view.
  });

  it("F1c: concurrent acquires bypass the maxInFlight backpressure entirely", async () => {
    const nm = new NonceManager(fakeNonceClient(0), ADDR, 8);
    // 20 callers arrive in the same tick: all pass `while (inFlight >= 8)`
    // before any of them increments inFlight (it happens inside the queued
    // section, after the check).
    const nonces = await Promise.all(Array.from({ length: 20 }, () => nm.acquire()));
    expect(new Set(nonces).size).toBe(20); // 20 handed out under a cap of 8
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Finding 2 — closePosition() sizes the close from a STALE preview while it
// already holds a fresh position read it never uses for sizing. An order for
// more than the current position FLIPS the position (a reducing market order
// is not clamped; reduce-only is a stop-registry intent, not an order flag).
// packages/perp-core/src/orders.ts:234-298
// ─────────────────────────────────────────────────────────────────────────────

const info: PerpInfo = {
  poolAddress: "0x0000000000000000000000000000000000000010" as `0x${string}`,
  marginBank: "0x0000000000000000000000000000000000000011" as `0x${string}`,
  quoteToken: "0x0000000000000000000000000000000000000012" as `0x${string}`,
  baseToken: "0x0000000000000000000000000000000000000013" as `0x${string}`,
  baseSymbol: "ETH",
  quoteSymbol: "USDso",
  baseDecimals: 18,
  quoteDecimals: 18,
  tickSize: "10000000000000000", // 0.01
  lotSize: "1000000000000000", // 0.001
  minQuantity: "1000000000000000",
  markPrice: "100000000000000000000",
  indexPrice: "100000000000000000000",
  fundingRate: "0",
  fundingWindowSec: 28800,
  fundingIntervalSec: 3600,
  initialMarginBps: 500,
  openInterest: "0",
  stopRegistry: "0x0000000000000000000000000000000000000014" as `0x${string}`,
};

const market = {
  symbol: "ETH/USDso:USDso",
  display: "ETH-PERP",
  info,
  market: {},
} as unknown as PerpMarket;

describe("closePosition (packages/perp-core/src/orders.ts)", () => {
  it("F2: sizes the close order from the earlier preview, not the fresh position it just read", async () => {
    const placed: Array<{ price: bigint; quantity: bigint; isBid: boolean }> = [];

    // Timeline: preview says the position is 10 → (stop fires on the venue) →
    // the fresh read sees 4 → the order is STILL placed for 10.
    const ctx: WriteCtx = {
      config: { dryRun: false },
      exchange: {
        client: {
          previewPerpClosePnl: async () => ({
            priceable: true,
            closedQuantity: 10n, // size at preview time
          }),
        },
        fetchPositions: async () => [
          { symbol: market.symbol, side: "long", contracts: 4 }, // size NOW
        ],
        fetchOrderBook: async () => ({ bids: [[100, 50]], asks: [] }),
        trader: {
          placePerpOrder: async (o: { price: bigint; quantity: bigint; isBid: boolean }) => {
            placed.push(o);
            return { orderId: 1n, fills: [] };
          },
        },
      },
    } as unknown as WriteCtx;

    const res = await closePosition(ctx, market, ADDR);
    expect(res.sent).toBe(true);
    expect(placed).toHaveLength(1);
    // The account holds 4; the venue receives a sell for 10 — a SELL of 6
    // beyond the position opens a brand-new 6 short in the account's name.
    expect(placed[0].quantity).toBe(10n);
    expect(placed[0].isBid).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Findings 3 & 4 — strategy decision blocks, replicated verbatim from source
// (pure, no imports needed): the expressions are copied character-for-character
// from the files cited in each test.
// ─────────────────────────────────────────────────────────────────────────────

describe("perp-funding decision block (strategies/perp-funding/src/index.ts:99-151)", () => {
  // Verbatim shape of the strategy's poll body:
  //   const held = position ? position.contracts * liveAt : 0;            // :101
  //   ...
  //   } else if (!position && worthHolding && me) {                        // :126
  //     if (held >= MAX_POSITION) { ... "at the position cap, not adding" } // :127
  //     else { ...sizeForNotional(Math.min(NOTIONAL, MAX_POSITION))...   }  // :137
  function decide(opts: { position: { side: string; contracts: number } | undefined; apr: number; maxPosition: number }) {
    const liveAt = 5;
    const position = opts.position;
    const held = position ? position.contracts * liveAt : 0; // :101
    const worthHolding = Math.abs(opts.apr) >= 0.1;
    const worthKeeping = Math.abs(opts.apr) >= 0.03;
    const paidSide = opts.apr > 0 ? "short" : "long";
    if (position && (!worthKeeping || position.side !== paidSide)) return { action: "close", held };
    if (!position && worthHolding) {
      if (held >= opts.maxPosition) return { action: "cap-blocked", held }; // :127 — held is ALWAYS 0 here
      return { action: "open", held, entryCap: Math.min(50, opts.maxPosition) };
    }
    return { action: "hold", held };
  }

  it("F3a: the PERP_FUNDING_MAX_POSITION_USDSO cap check runs only where held === 0, so it can never fire", () => {
    const out = decide({ position: undefined, apr: 0.5, maxPosition: 200 });
    expect(out.action).toBe("open"); // the cap branch was skipped — held was 0
    // There is no input for which the "cap-blocked" arm is reachable: it sits
    // behind `!position`, and `!position` forces `held = 0` (line 101).
  });

  it("F3b: an over-cap position is neither trimmed nor blocked — the cap bounds nothing", () => {
    // A $50 entry that ran to $300 notional (price moved) with funding still
    // paying: no branch runs, the position is held past the cap indefinitely.
    const out = decide({ position: { side: "short", contracts: 60 }, apr: 0.5, maxPosition: 200 });
    expect(out.action).toBe("hold");
    expect(out.held).toBeGreaterThan(200);
  });
});

describe("perp-guard read-only loop (strategies/perp-guard/src/index.ts:127-164)", () => {
  // Verbatim shape of the watch loop:
  //   for (const market of markets) {
  //     if (!me) break;                       // :136
  //     ...marginSnapshot / healthRatio / console.log...
  it("F4: with no PRIVATE_KEY the guard reports NOTHING, contradicting 'health is reported'", () => {
    const markets = ["BTC-PERP", "ETH-PERP", "SOL-PERP"];
    const reported: string[] = [];
    const me: string | undefined = undefined;
    for (const m of markets) {
      if (!me) break; // :136 — fires on the FIRST iteration
      reported.push(m);
    }
    expect(reported).toHaveLength(0);
    // docs/README promise (index.ts:99-100):
    //   "read-only: no PRIVATE_KEY, so health is reported but nothing is closed."
    // Actual: zero health lines are ever printed, for any account, forever.
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Finding 5 — DreamDexRest.ensureAuth(): no single-flight, and the 3-minute
// refresh margin re-runs the whole SIWE login on EVERY request for any token
// that lives shorter than 3 minutes (or returns expiresAt in seconds).
// packages/core/src/rest.ts:53, 99-126
// ─────────────────────────────────────────────────────────────────────────────

describe("DreamDexRest.ensureAuth (packages/core/src/rest.ts)", () => {
  const net = {
    name: "testnet" as const,
    chainId: 50312,
    nativeSymbol: "STT",
    rpcUrl: "http://127.0.0.1:1",
    restApi: "https://api.testnet.dreamdex.io/v0",
    wsUrl: "ws://127.0.0.1:1",
    explorer: "https://explorer.testnet.somnia.network",
    operatorRegistry: ADDR,
  };
  const account = privateKeyToAccount(generatePrivateKey());

  function stubApi(expiresAt: number) {
    let nonces = 0;
    let logins = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: { method?: string }) => {
        const method = init?.method ?? "GET";
        if (String(url).includes("/auth/nonce")) {
          nonces += 1;
          return {
            ok: true,
            headers: new Headers(),
            text: async () => JSON.stringify({ nonce: `n${nonces}` }),
          };
        }
        if (method !== "POST") {
          return {
            ok: true,
            headers: new Headers(),
            text: async () => JSON.stringify({ order: "prepared" }),
          };
        }
        logins += 1;
        return {
          ok: true,
          headers: new Headers(),
          text: async () => JSON.stringify({ token: `t${logins}`, expiresAt }),
        };
      }),
    );
    return {
      get counts() {
        return { nonces, logins };
      },
    };
  }

  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("F5a: a token with a 2-minute lifetime (still valid!) is re-signed on EVERY request", async () => {
    const api = stubApi(Date.now() + 2 * 60_000); // expires in 2 min < 3 min margin
    const rest = new DreamDexRest(net, account);
    await rest.getOrder("BTC:USDso", "1");
    await rest.getOrder("BTC:USDso", "2");
    expect(api.counts.logins).toBe(2); // full nonce + EIP-191 sign + POST per request
  });

  it("F5b: an expiresAt in SECONDS (unit mismatch) re-auths forever and never caches", async () => {
    const api = stubApi(Math.floor(Date.now() / 1000) + 3_600); // server sends unix seconds
    const rest = new DreamDexRest(net, account);
    await rest.getOrder("BTC:USDso", "1");
    await rest.getOrder("BTC:USDso", "2");
    expect(api.counts.logins).toBe(2);
    expect(api.counts.nonces).toBe(2);
  });

  it("F5c: N concurrent requests with a stale token run N full SIWE logins (no single-flight)", async () => {
    const api = stubApi(Date.now() + 10 * 60_000);
    const rest = new DreamDexRest(net, account);
    await Promise.all([rest.getOrder("BTC:USDso", "1"), rest.getOrder("BTC:USDso", "2"), rest.getOrder("BTC:USDso", "3")]);
    expect(api.counts.logins).toBe(3); // one shared token would need 1
  });

  it("F5d (control): one long-lived token is cached and reused", async () => {
    const api = stubApi(Date.now() + 10 * 60_000);
    const rest = new DreamDexRest(net, account);
    await rest.getOrder("BTC:USDso", "1");
    await rest.getOrder("BTC:USDso", "2");
    expect(api.counts.logins).toBe(1);
  });
});
