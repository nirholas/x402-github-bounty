# Tutorial — mint a bounty, prove the fix, settle it

Twenty minutes. By the end you will have run the server, seen a real dual-rail 402, bought a
signed bounty certificate, bought a verification report from live GitHub state, and closed
the bounty with a signed receipt.

## 1. Install

```bash
git clone https://github.com/nirholas/x402-github-bounty.git
cd x402-github-bounty
npm install
```

Node 18 or newer. Runtime dependencies: `express`, `x402`, `dotenv`. Storage is a JSON file.

## 2. Configure

```bash
cp .env.example .env
```

It ships with the suite's public receive addresses already filled in, so the server runs
as-is. Two variables are worth setting even for a local run:

```bash
# GitHub: 60 req/h anonymous → 5,000 req/h with a token. `public_repo` scope is enough.
GITHUB_TOKEN=ghp_...

# The HMAC key your certificates are signed with. The default is a public dev secret and
# the server prints a warning at boot — with it, anyone running this code can forge a
# certificate that looks like it came from you.
SIGNING_SECRET=$(openssl rand -hex 32)
```

## 3. Run the server

```bash
npm run dev
```

```
x402-github-bounty listening on http://localhost:4021
Payment rails (USDC — the client picks):
  evm     base-sepolia   → 0x40252CFDF8B20Ed757D61ff157719F33Ec332402  via https://x402.org/facilitator
  solana  solana         → WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW  via https://facilitator.payai.network
  note: using suite default payTo — set PAY_TO_ADDRESS / SOLANA_PAY_TO_ADDRESS to receive funds yourself
GitHub API: authenticated (5,000 req/h)
Routes:
  POST /bounties             $0.01
  GET /verify/:bountyId      $0.002
  POST /settle/:bountyId     free (settle-key auth)
  GET /bounties              free
  POST /check-signature      free
```

## 4. Your first 402

```bash
curl -i -s -X POST localhost:4021/bounties \
  -H 'content-type: application/json' \
  -d '{"issueUrl":"https://github.com/nodejs/node/issues/1","amount":25}'
```

```jsonc
{
  "x402Version": 1,
  "error": "X-PAYMENT header is required",
  "accepts": [
    { "scheme": "exact", "network": "base-sepolia", "maxAmountRequired": "10000",
      "payTo": "0x40252CFDF8B20Ed757D61ff157719F33Ec332402",
      "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e", … },
    { "scheme": "exact", "network": "solana", "maxAmountRequired": "10000",
      "payTo": "WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW",
      "asset": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", … }
  ]
}
```

`maxAmountRequired` is in USDC base units (6 decimals), so `"10000"` is **$0.01** — the mint
fee. The `$25` you declared is not charged; see step 8.

Two entries means two ways to pay for the identical artifact. Your client chooses.

## 5. Get a funded test wallet

1. Throwaway key: `openssl rand -hex 32`, prefixed with `0x`.
2. Its address: `npx tsx -e "import {privateKeyToAccount} from 'viem/accounts'; console.log(privateKeyToAccount(process.env.K).address)"`.
3. Testnet USDC from the [Circle faucet](https://faucet.circle.com) — pick Base Sepolia. A
   dollar is plenty.

## 6. Mint a certificate

```bash
PRIVATE_KEY=0xyourTestnetKey \
ISSUE_URL=https://github.com/nodejs/node/issues/1 \
npm run client
```

```
① Unpaid request → expect a dual-rail 402
   accepts: base-sepolia   10000 base units USDC → 0x40252CF…
   accepts: solana         10000 base units USDC → WwwuGbqH…

② Minting a certificate from 0xYourWallet on Base Sepolia — $0.01

   the artifact — a signed bounty certificate:
{
  "type": "x402-bounty-certificate",
  "bountyId": "0f0c4b9e-…",
  "issueUrl": "https://github.com/nodejs/node/issues/1",
  "repo": "nodejs/node",
  "issueNumber": 1,
  "issueTitle": "…",
  "amount": "25.00",
  "currency": "USD",
  "terms": "Payable to the author of the first merged PR that closes this issue.",
  "funder": "0xYourWallet",
  "createdAt": "2026-08-07T12:00:00.000Z",
  "expiresAt": "2026-11-05T12:00:00.000Z"
}
   signature: 9f2c…
   settleKey: b71e…   ← keep this secret, it closes the bounty
   X-PAYMENT-RESPONSE: { success: true, rail: 'evm', transaction: '0x…' }
```

What happened server-side, in order: the paywall verified and settled your $0.01 through
the facilitator; **then** the handler called GitHub to confirm the issue is real, is an issue
and not a PR, and is still open; only then did it sign the certificate. Fail any of those
checks and you get a 404 / 400 / 409 — the payment is the price of the check, and a real
answer either way.

### The settleKey

Returned exactly once. The server stores only its SHA-256 hash, so it cannot show it to you
again and cannot be tricked into revealing it. Lose it and the bounty can never be closed —
put it somewhere durable now.

## 7. Buy proof that someone fixed it

```bash
curl -s localhost:4021/verify/$BOUNTY_ID -H "X-PAYMENT: $PAID_2000" | jq .report
```

```json
{
  "type": "x402-bounty-verification",
  "bountyId": "0f0c4b9e-…",
  "bountyStatus": "open",
  "issue": { "state": "closed", "closedAt": "2026-09-01T…", "stateReason": "completed" },
  "mergedPrs": [
    { "number": 418, "title": "fix: …", "author": "contributor",
      "url": "https://github.com/nodejs/node/pull/418", "mergedAt": "2026-09-01T…" }
  ],
  "eligible": true,
  "eligibleReason": "issue closed with merged PR(s) referencing it",
  "source": "github-live",
  "checkedAt": "2026-09-02T…"
}
```

How `mergedPrs` is built: the server reads the issue's **timeline** for `cross-referenced`
events pointing at pull requests — the same signal GitHub itself uses for "linked PRs" — then
fetches each candidate and keeps only the ones with a real `merged_at`. A PR that merely
mentions the issue but was closed unmerged does not count.

`eligible` is true only when the issue is closed, at least one referencing PR merged, and
the bounty is still open. `eligibleReason` always tells you which condition failed.

This is a **pay-per-poll** endpoint by design: each call is a fresh, signed snapshot of
GitHub at `checkedAt`. There is nothing to subscribe to and nothing to wait for.

## 8. Settle — free

```bash
curl -s -X POST localhost:4021/settle/$BOUNTY_ID \
  -H 'content-type: application/json' \
  -d '{"settleKey":"b71e…","payoutAddress":"0xClaimantWallet","prNumber":418}' | jq
```

```json
{
  "receipt": {
    "type": "x402-bounty-payout-receipt",
    "bountyId": "0f0c4b9e-…",
    "amount": "25.00",
    "payoutAddress": "0xClaimantWallet",
    "payoutPr": 418,
    "settledAt": "2026-09-02T…",
    "note": "The funder is responsible for transferring the bounty amount to payoutAddress; this receipt is the signed settlement record."
  },
  "signature": "3ab8…"
}
```

**You still owe the $25.** Send it to `payoutAddress` yourself. This service is
non-custodial — it never received your bounty, so it cannot forward it. What it gives you is
a signed, timestamped record that you committed to pay and to whom, which is the part that
was previously impossible to have without trusting a platform.

Settling is idempotent-by-refusal: a second attempt gets `409 ALREADY_CLOSED`.

## 9. Verify a signature — free

```bash
curl -s -X POST localhost:4021/check-signature \
  -H 'content-type: application/json' \
  -d "{\"payload\": $CERT_JSON, \"signature\": \"9f2c…\"}"
# { "valid": true, "type": "x402-bounty-certificate", "checkedAt": "…" }
```

Change one character of the payload and it flips to `false`. Field order does not matter —
the canonical form sorts keys recursively before hashing.

## 10. Going to mainnet

```bash
# EVM rail → Base mainnet
NETWORK=base
FACILITATOR_URL=https://your-mainnet-facilitator.example

# Solana rail → already mainnet by default
SOLANA_NETWORK=mainnet-beta
SOLANA_RPC_URL=https://your-rpc-provider.example

# your own addresses, or you are donating to the suite
PAY_TO_ADDRESS=0xYourMainnetAddress
SOLANA_PAY_TO_ADDRESS=YourSolanaAddress

# so 402 challenges quote absolute public URLs
PUBLIC_BASE_URL=https://bounty.yourdomain.com

# non-negotiable in production
SIGNING_SECRET=<32+ random bytes>
GITHUB_TOKEN=<a token with public_repo>
DATA_DIR=/var/lib/x402-bounty       # on a volume you back up
```

`https://x402.org/facilitator` is a testnet convenience. For real money point
`FACILITATOR_URL` at a mainnet-capable facilitator (Coinbase CDP's, or your own) — it
verifies signatures and broadcasts settlement, so choose it as deliberately as a payment
processor.

Back up `DATA_DIR`. It holds every certificate's metadata and the `settleKey` hashes; lose
it and open bounties can no longer be settled.

Then list the deployment: submit your origin to [x402scan.com](https://x402scan.com), the
x402 Bazaar, and [agentic.market](https://agentic.market). They read `/.well-known/x402`,
which this server already serves.

## Next

- [API reference](api.md) — every field of every artifact
- [For AI agents](agents.md) — discovery, MCP, listing
- [`examples/curl.md`](https://github.com/nirholas/x402-github-bounty/blob/main/examples/curl.md) — the protocol by hand
