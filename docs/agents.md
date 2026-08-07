# For AI agents

An agent that diagnoses a bug in a dependency can now put money on the fix, prove the fix
happened, and close the loop — without an account, a card, or a human.

## 1. Discover

Two free, unauthenticated files describe everything.

**`GET /skill.md`** — the agent-facing contract: endpoints, prices, request and response
schemas, payment instructions, error table, and the custody statement. Drop the URL into a
system prompt or retrieval index and a model can use the service correctly with no other
documentation. This is the [agentres.dev](https://agentres.dev) `skill.md` pattern; the
format is specified by [`x402-skill-md`](https://github.com/nirholas/x402-skill-md).

**`GET /.well-known/x402`** — the machine-readable manifest:

```jsonc
{
  "x402Version": 1,
  "name": "x402-github-bounty",
  "custody": "non-custodial — this service signs certificates and reports; it never holds bounty funds",
  "rails": [
    { "rail": "evm",    "network": "base-sepolia", "asset": "USDC", "payTo": "0x40252CF…2402" },
    { "rail": "solana", "network": "solana",       "asset": "USDC", "payTo": "WwwuGbqH…T3WwW" }
  ],
  "resources": [
    { "resource": "POST /bounties", "price": "$0.01",
      "inputSchema": { "…": {} }, "outputSchema": { "…": {} },
      "accepts": [ { "network": "base-sepolia", … }, { "network": "solana", … } ] }
  ],
  "freeResources": [ { "resource": "POST /settle/:bountyId", "price": "free" } ]
}
```

Plan against `outputSchema` before spending; budget against `price`.

**`GET /openapi.json`** — OpenAPI 3.1, if your framework prefers a generated client.

## 2. Pay

Every paid route answers an unpaid request with 402 and a **dual-rail** `accepts` array:
USDC on Base, USDC on Solana, same price, same artifact. Pick whichever chain your wallet
lives on — the server has no preference.

**EVM rail:**

```ts
import { wrapFetchWithPayment } from "x402-fetch";
const pay = wrapFetchWithPayment(fetch, wallet);       // viem wallet client

const res = await pay(`${BASE}/bounties`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ issueUrl, amount: 25 }),
});
const { certificate, signature, settleKey } = await res.json();
```

**Solana rail:**

```ts
import { prepareSolanaCheckout, encodeX402Payment } from "@three-ws/x402-payment-modal/server";

const accept = challenge.accepts.find((a) => a.network.startsWith("solana"));
const { tx_base64 } = await prepareSolanaCheckout({ accept, buyer: pubkey });
const { x_payment } = encodeX402Payment({
  accept,
  signedTxBase64: await wallet.signTransaction(tx_base64),
  resourceUrl: url,
});
await fetch(url, { method: "POST", headers: { "X-PAYMENT": x_payment, … }, body });
```

`accept.extra.feePayer` sponsors the SOL network fee, so an agent holding only USDC can pay.

### Reading the contract before you pay

Every entry in `accepts` carries an `outputSchema` with two halves, so an agent can judge
whether a call is worth its price and then make it correctly — without fetching the OpenAPI
document first:

- **`outputSchema.input`** — `{ type: "http", method, queryParams?, pathParams?, bodyType?,
  bodyFields? }`. Each value is the JSON Schema for that query parameter, path segment or
  request-body field.
- **`outputSchema.output`** — the JSON Schema of the 200 body you receive once payment
  settles.

Both halves are generated from `openapi.json`, so the runtime challenge and the published
spec cannot drift apart. Both rails advertise the identical contract: which wallet you pay
with never changes what the endpoint takes or returns.

You can probe a paid route safely: the paywall answers before any validation or existence
check, so an unpaid request with a synthetic id or an empty body still returns the full
challenge rather than a 404 or a 400. Read the price and the contract first, decide, then pay.

### Protocol version

This service speaks **x402 v1** (`x402Version: 1`) — the version every client shipped in this
repo, and in the examples above, is written against. v2 relocates the invocation contract to
`extensions.bazaar.schema` and identifies networks with CAIP-2 ids; agentcash prefers it, and
moving is a planned upgrade once the clients here can speak both. Until then, read `accepts[]`
and ignore `extensions`.

## 3. What you get

The 200 body **is** the purchase — no job id, no webhook, nothing to poll:

- `POST /bounties` → the signed certificate and a one-time `settleKey`
- `GET /verify/:bountyId` → a signed snapshot of GitHub state at `checkedAt`
- `POST /settle/:bountyId` → the signed payout receipt

Plus `X-PAYMENT-RESPONSE`, a base64 receipt naming the rail, network and transaction — keep
it to reconcile spend.

### Rules worth encoding in your agent

- **`$0.01` is the mint fee, not the bounty.** The pledged `amount` is never charged. The
  agent (or its human) must actually send the money at settlement. Do not report a bounty as
  "paid" because `settle` returned 200.
- **Store the `settleKey` immediately.** It is returned once and stored only as a hash. Lose
  it and the bounty can never be closed. Do not leave it in a conversation buffer.
- **Verification is a poll, not a subscription.** Each `GET /verify/:bountyId` is a fresh
  $0.002 snapshot. Poll on a sensible cadence — daily, or when a webhook tells you the issue
  closed — not in a loop.
- **Read `eligibleReason`, not just `eligible`.** "issue is still open" and "no merged PR
  references this issue" call for different next actions.
- **Mint only against open issues.** A closed issue returns `409 ISSUE_CLOSED` and costs you
  the $0.01 anyway. Check state first if you are unsure.
- **Signatures prove observation, not escrow.** A valid certificate means *this deployment
  saw that issue open at that time*. It is not proof that funds exist anywhere.

## 4. MCP integration

[`examples/mcp-tool.md`](https://github.com/nirholas/x402-github-bounty/blob/main/examples/mcp-tool.md)
is a complete Model Context Protocol server exposing `create_bounty` and `verify_bounty`.
The wallet lives in the MCP process, so its balance is the agent's spending cap — fund it
with what you are willing to lose.

```json
{
  "mcpServers": {
    "x402-github-bounty": {
      "command": "npx",
      "args": ["tsx", "/path/to/mcp-server.ts"],
      "env": { "PRIVATE_KEY": "0x…", "X402_BOUNTY_URL": "https://your-host" }
    }
  }
}
```

The natural pairing: an agent that fixes bugs and an agent that funds them, transacting
without either signing up for anything.

## 5. Getting listed

Deploy publicly, then submit the origin to the x402 discovery surfaces. Each reads
`/.well-known/x402`:

| where | what it does | how |
|---|---|---|
| [x402scan.com](https://x402scan.com) | indexes live x402 endpoints and their settlement volume | submit your origin; it crawls `/.well-known/x402` |
| **x402 Bazaar** | the protocol's own resource directory, queried by agents at runtime | register through the facilitator's `list` API |
| [agentic.market](https://agentic.market) | marketplace of agent-payable services | submit the origin plus your `skill.md` URL |

Before submitting, confirm these resolve over HTTPS on your public origin, and set
`PUBLIC_BASE_URL` so 402 challenges quote absolute public URLs:

```
https://your-host/.well-known/x402
https://your-host/skill.md
https://your-host/openapi.json
```

Questions or a listing problem: **nichxbt@gmail.com**.
