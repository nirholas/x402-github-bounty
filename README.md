<h1 align="center">x402-github-bounty</h1>

<p align="center">
  <b>Put money on a GitHub issue, prove it, and settle it — with signed artifacts and live GitHub state.</b><br>
  $0.01 to mint a bounty certificate. $0.002 for a merged-PR verification report. USDC on Base <i>or</i> Solana.
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: Apache 2.0" src="https://img.shields.io/badge/license-Apache--2.0-blue.svg"></a>
  <a href="https://x402.org"><img alt="x402" src="https://img.shields.io/badge/protocol-x402-0052ff.svg"></a>
  <img alt="rails" src="https://img.shields.io/badge/USDC-Base%20%2B%20Solana-2775ca.svg">
  <img alt="custody" src="https://img.shields.io/badge/custody-none-1f883d.svg">
  <a href="https://nirholas.github.io/x402-github-bounty/"><img alt="docs" src="https://img.shields.io/badge/docs-Pages-24292f.svg"></a>
</p>

---

## What you get

| Route | Price | What lands in the 200 body |
|---|---|---|
| `POST /bounties` | **$0.01** | An HMAC-signed **bounty certificate** — issue URL, title, pledged amount, terms, expiry — minted only after the issue is confirmed open and real through the live GitHub API. Plus a one-time `settleKey`. |
| `GET /verify/:bountyId` | **$0.002** | A signed **verification report** built from live GitHub state at request time: is the issue closed, which merged PRs reference it, who authored them, and whether the bounty is eligible to pay out. |
| `POST /settle/:bountyId` | free | A signed **payout receipt**. Settling costs nothing — you already paid to mint, and a funder should never be charged to close out. |
| `GET /bounties` · `POST /check-signature` · `GET /` · `/health` · `/skill.md` · `/.well-known/x402` · `/openapi.json` | free | Public board, signature validation, discovery |

Every paid route returns its artifact **in the 200 body**. Nothing is queued, nothing is
promised for later.

## Non-custodial, and that is the point

This service **never holds your money.** The $0.01 buys the certificate; the `amount` you
declare is a pledge signed into it. You pay the claimant yourself and record it with
`POST /settle/:bountyId`, which returns the signed receipt.

Why build it this way? Custody is the hard part of bounty platforms — it is where the fees,
the lock-ups, the disputes and the regulatory surface come from. Strip it out and what is
actually scarce remains: a tamper-evident record that *this issue was open, this amount was
pledged, this PR merged, this payout happened*. That record is what you are buying, and it
costs a cent.

## Why x402 for this

A bounty is a one-off act by someone who may never return — an agent that found a blocking
bug in a dependency, a user who wants an issue fixed this week. Making them create an
account, add a card, and accept a platform's custody terms to move $25 is absurd overhead.
x402 charges $0.01 for the artifact, from a wallet they already have, with no signup and no
key to store.

## Quickstart

```bash
git clone https://github.com/nirholas/x402-github-bounty.git
cd x402-github-bounty
npm install
cp .env.example .env      # already filled with working defaults
npm run dev               # http://localhost:4027
```

Ask without paying and you get the dual-rail challenge:

```bash
curl -i -s -X POST localhost:4027/bounties \
  -H 'content-type: application/json' \
  -d '{"issueUrl":"https://github.com/nodejs/node/issues/1","amount":25}'
# HTTP/1.1 402 Payment Required
# { "x402Version": 1, "accepts": [ {…base-sepolia…}, {…solana…} ] }
```

Pay and you get the certificate:

```bash
PRIVATE_KEY=0xyourTestnetKey npm run client
```

## How x402 works here

```
funder ──POST /bounties {issueUrl, amount}──▶ server
       ◀──402 + accepts:[ Base USDC, Solana USDC ]──
       (client picks a rail, signs $0.01)
       ──POST /bounties + X-PAYMENT─────────▶ server
                                              ├─ facilitator: verify → settle
                                              └─ GitHub API: is this issue real and open?
       ◀──200 + signed certificate + settleKey + X-PAYMENT-RESPONSE──
```

Later, anyone can buy the verification report; only the holder of `settleKey` can close the
bounty.

## Dual-rail payment: Base **or** Solana

Every 402 lists **two** payment requirements — USDC on Base (EIP-3009
`transferWithAuthorization`) and USDC on Solana (SPL `transferChecked`). The client picks
whichever chain it can sign on; the server settles either and returns the same artifact.

| | EVM rail | Solana rail |
|---|---|---|
| network | `base-sepolia` (default) / `base` | `solana` (default) / `solana-devnet` |
| asset | USDC `0x036CbD…dCF7e` (sepolia) | USDC mint `EPjFWdd5…TDt1v` |
| payTo | `0x40252CFDF8B20Ed757D61ff157719F33Ec332402` | `WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW` |
| facilitator | `https://x402.org/facilitator` | `https://facilitator.payai.network` |

Those are the suite's public receive addresses and the server runs with them out of the box.
Set `PAY_TO_ADDRESS` / `SOLANA_PAY_TO_ADDRESS` to be paid yourself. The Solana network fee
is sponsored by the facilitator's fee payer, so a payer needs USDC only — no SOL.

## Signed artifacts

Certificates, reports and receipts are **HMAC-SHA256 over canonical JSON** (keys sorted
recursively, so the signature is stable regardless of field order). Validate any of them for
free:

```bash
curl -s -X POST localhost:4027/check-signature \
  -H 'content-type: application/json' \
  -d '{"payload": <the signed object>, "signature": "<hex>"}'
# { "valid": true, "type": "x402-bounty-certificate", "checkedAt": "…" }
```

Set `SIGNING_SECRET` in production. With the default dev secret (the server warns loudly at
boot) anyone running this code can forge a certificate that looks like yours.

A signature proves *this deployment observed that GitHub state at that time*. It does not
prove anyone escrowed money — see the custody note above.

## Real backend / API keys

**GitHub REST API, live on every call.** No fixture mode: a verification report always
reflects real GitHub state at `checkedAt`.

| env | effect if unset | effect if set |
|---|---|---|
| `GITHUB_TOKEN` | works, at GitHub's 60 requests/hour anonymous limit | 5,000 requests/hour, plus issues in private repos the token can read |
| `SIGNING_SECRET` | a dev secret is used and a warning is printed | your artifacts become unforgeable by others |
| `DATA_DIR` | ledger written to `./data/bounties.json` | ledger written where you say |

Storage is a JSON file on disk, on purpose — a bounty ledger this small does not need a
database, and a file is trivially backed up, diffed and audited.

## For AI agents

- **[`skill.md`](skill.md)** — the agent-facing contract: endpoints, prices, schemas,
  payment, errors. Point an agent at `https://your-host/skill.md` and it can use this
  service with no other documentation.
- **`GET /.well-known/x402`** — machine-readable manifest of every paid resource, its price,
  its input/output schema and both rails. This is the format
  [x402scan.com](https://x402scan.com), the **x402 Bazaar** and
  [agentic.market](https://agentic.market) index.
- **MCP** — [`examples/mcp-tool.md`](examples/mcp-tool.md) exposes `create_bounty` and
  `verify_bounty` as Model Context Protocol tools, so Claude can fund an issue it just
  diagnosed.
- **Client** — [`examples/agent-client.ts`](examples/agent-client.ts) runs the whole flow:
  402 → pay → certificate → verification report.

An agent that fixes bugs and an agent that funds them can now transact without either one
signing up for anything.

## Docs

Full site: **<https://nirholas.github.io/x402-github-bounty/>**

- [Tutorial](docs/tutorial.md) — install → 402 → certificate → verify → settle → mainnet
- [API reference](docs/api.md) — every field of every artifact
- [For agents](docs/agents.md) — discovery, payment, MCP, listing

## Support

Questions, bugs, or a listing request: **nichxbt@gmail.com** or open an issue.

Part of the [x402 Suite](https://github.com/nirholas/x402-suite).

## License

Apache-2.0 — see [LICENSE](LICENSE).
