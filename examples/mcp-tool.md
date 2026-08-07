# Exposing x402-github-bounty as an MCP tool for Claude

Give Claude the ability to fund issues and verify merged PRs, paying per call from its own wallet.

## Minimal MCP server

```ts
// mcp-server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { wrapFetchWithPayment } from "x402-fetch";
import { createWalletClient, http, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const BASE_URL = process.env.X402_BOUNTY_URL || "http://localhost:4021";

// One wallet, reused for every purchase. Its balance IS the agent's spending
// cap — fund it with what you are willing to let Claude spend, and no more.
const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
const wallet = createWalletClient({ account, chain: baseSepolia, transport: http() })
  .extend(publicActions);
const payFetch = wrapFetchWithPayment(fetch, wallet as never);

const server = new McpServer({ name: "x402-github-bounty", version: "0.1.0" });

server.tool(
  "create_bounty",
  "Mint a signed bounty certificate on a GitHub issue. Costs $0.01 USDC, paid automatically. " +
    "The pledged `amount` is NOT charged — this service is non-custodial and the funder pays " +
    "the claimant directly at settlement. Returns the certificate and a secret settleKey.",
  {
    issueUrl: z.string().url(),
    amount: z.number().positive().describe("Bounty amount in USD"),
    terms: z.string().optional(),
  },
  async ({ issueUrl, amount, terms }) => {
    const res = await payFetch(`${BASE_URL}/bounties`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ issueUrl, amount, terms }),
    });
    return { content: [{ type: "text", text: await res.text() }] };
  },
);

server.tool(
  "verify_bounty",
  "Buy a signed verification report for a bounty: is the issue closed, which merged PRs " +
    "reference it, and is the bounty eligible to pay out. Live GitHub state. $0.002 USDC.",
  { bountyId: z.string() },
  async ({ bountyId }) => {
    const res = await payFetch(`${BASE_URL}/verify/${bountyId}`);
    return { content: [{ type: "text", text: await res.text() }] };
  },
);

await server.connect(new StdioServerTransport());
```

## Claude Desktop config

```json
{
  "mcpServers": {
    "x402-github-bounty": {
      "command": "npx",
      "args": ["tsx", "/path/to/mcp-server.ts"],
      "env": {
        "X402_BOUNTY_URL": "http://localhost:4021",
        "PRIVATE_KEY": "0x..."
      }
    }
  }
}
```

## Using it

> **You:** This crash in `foo-parser` is blocking us. Find the upstream issue and put $50 on it.
>
> **Claude:** *(searches, finds `github.com/acme/foo-parser/issues/412`, calls `create_bounty` —
> $0.01 — and returns the signed certificate)*
>
> …a week later…
>
> **You:** Did anyone fix it?
>
> **Claude:** *(calls `verify_bounty` — $0.002 — and reports: issue closed, PR #418 by
> `@contributor` merged, bounty eligible)*

## Notes

- **Budget the wallet, not the tool.** The MCP process holds the key; its balance is the
  ceiling on what the agent can spend. That is the safety mechanism.
- **Keep the `settleKey`.** It is returned once, stored only as a hash, and is the only
  thing that can close the bounty. Persist it outside the conversation.
- **The pledge is yours to honour.** Nothing in this stack moves the $50. `settle` records
  the payout; you make it.
- **Solana rail.** Swap `wrapFetchWithPayment` for a Solana x402 client if the agent's
  wallet lives on Solana — the service accepts either and the tool code is unchanged.
- **Discovery.** An agent that can read [`skill.md`](../skill.md) or `GET /.well-known/x402`
  can write this wrapper itself.
