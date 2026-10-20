// Live read-only proofs against the Hideki deployment and the public REST API.
// No keys, no writes, a handful of requests. Run from anywhere:
//   node run-live-proofs.mjs
import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { createPublicClient, defineChain, http } from "viem";

const RPC = "https://api.hideki2.infra.testnet.somnia.network";
const GRAPHQL = "https://hideki-dev.smk.somnia.host/v1/graphql";
const REST = "https://api.testnet.dreamdex.io/v0";
const log = (...a) => console.log(...a);
const line = (t) => console.log("\n=== " + t + " ===");

const chain = defineChain({
  id: 50383,
  name: "hideki",
  nativeCurrency: { name: "STT", symbol: "STT", decimals: 18 },
  rpcUrls: { default: { http: [RPC], webSocket: [RPC.replace("https", "wss") + "/ws"] } },
});

// ── L1: the chain is the one the perps docs name ──
line("L1  Hideki RPC chain id (docs/perps.md says 50383)");
{
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
  });
  const j = await res.json();
  log(`  eth_chainId -> ${j.result} (decimal ${parseInt(j.result, 16)})`);
}

// ── L2: the SDK's perp read paths all work live ──
line("L2  SDK perp reads on live Hideki (SomniaMarkets, no key)");
const ex = new SomniaMarkets({
  indexerUrl: GRAPHQL,
  chain,
  wsRpcUrl: RPC.replace("https", "wss") + "/ws",
  addresses: SOMNIA_TESTNET_ADDRESSES,
});
const ZERO = "0x0000000000000000000000000000000000000001";
const markets = await ex.loadMarkets(true);
const swaps = Object.values(markets).filter((m) => m.type === "swap");
log(`  loadMarkets: ${Object.keys(markets).length} markets, ${swaps.length} perp swaps`);
const eth = swaps.find((m) => m.symbol === "ETH/USDso:USDso");
log(`  ETH-PERP pool=${eth.info.poolAddress}`);
log(`  ETH-PERP marginBank=${eth.info.marginBank}`);
const ob = await ex.fetchOrderBook(eth.symbol, 1);
log(`  fetchOrderBook (floats): bid ${JSON.stringify(ob.bids[0])} ask ${JSON.stringify(ob.asks[0])}`);
log(`  fetchOrderBook (raw)    : bid ${ob.info.bids[0].price} ask ${ob.info.asks[0].price}`);
const st = await ex.client.getPerpState(eth.info.poolAddress);
log(`  getPerpState: mark=${st.markPrice} fundingRate=${st.fundingRate} window=${st.fundingWindowSec}s interval=${st.fundingIntervalSec}s`);
const snap = await ex.client.getPerpHealthSnapshot(eth.info.poolAddress);
log(`  getPerpHealthSnapshot: priceable=${snap.priceable} imf=${snap.effectiveImfBps}bps mm=${snap.maintenanceMarginBps}bps`);
const acc = await ex.client.getMarginAccount(eth.info.marginBank, ZERO);
log(`  getMarginAccount(zero): status=${acc.marginStatus} equity=${acc.equity}`);
const mx = await ex.client.getMaxPerpOrderSize({ pool: eth.info.poolAddress, marginBank: eth.info.marginBank, account: ZERO, isBid: true, price: 1n, autoPull: false });
log(`  getMaxPerpOrderSize(zero): placeable=${mx.placeable} limitedBy=${mx.limitedBy}`);
const close = await ex.client.previewPerpClosePnl({ pool: eth.info.poolAddress, marginBank: eth.info.marginBank, account: ZERO });
log(`  previewPerpClosePnl(zero): closedQuantity=${close.closedQuantity} priceable=${close.priceable}`);
const stops = await ex.client.listPerpStopOrders({ account: ZERO, pool: eth.info.poolAddress });
log(`  listPerpStopOrders(zero): ${stops.length} stop(s)`);
const fee = await ex.client.getPerpStopOrderSomiPayment(eth.info.stopRegistry);
log(`  getPerpStopOrderSomiPayment: ${fee} wei = ${Number(fee) / 1e18} SOMI per stop (stops.ts dry-run hardcodes "0.30" for a pair)`);

// ── L3: the bot-access check works on the live pool ──
line("L3  isOperatorAuthorized on the live ETH pool (bot access / link-a-bot)");
{
  const client = createPublicClient({ chain, transport: http(RPC) });
  const abi = [{
    type: "function", name: "isOperatorAuthorized", stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }, { name: "operator", type: "address" }, { name: "selector", type: "bytes4" }],
    outputs: [{ name: "", type: "bool" }],
  }];
  const A = "0x00000000000000000000000000000000000d0001";
  const B = "0x00000000000000000000000000000000000d0002";
  for (const sel of ["0x80054449", "0xe37b444b", "0x364c2587", "0xdeadbeef"]) {
    const r = await client.readContract({ address: eth.info.poolAddress, abi, functionName: "isOperatorAuthorized", args: [A, B, sel] });
    log(`  isOperatorAuthorized(dummy, dummy, ${sel}) = ${r}  <- function exists, answers, does not revert`);
  }
}

// ── L4: the REST API has no perp markets (finding 10) ──
line("L4  REST API market table vs live perp markets");
{
  const j = await (await fetch(REST + "/markets")).json();
  log(`  GET /v0/markets -> ${j.markets.length} markets: ${j.markets.map((m) => `${m.symbol}@${m.chainId}`).join(", ")}`);
  log(`  perp rows: ${j.markets.filter((m) => m.kind !== "spot").length}`);
  const bad = await fetch(REST + "/orderbooks?symbols=ETH%3AUSDso&depth=2");
  log(`  GET /v0/orderbooks?symbols=ETH:USDso -> HTTP ${bad.status} ${JSON.stringify(await bad.json()).slice(0, 120)}`);
}
process.exit(0);
