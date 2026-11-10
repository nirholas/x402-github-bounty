---
name: x402-github-bounty
description: Call the x402-github-bounty HTTP service to put a bounty on a live GitHub issue, buy a signed verification report of merged PRs, and settle with a payout receipt. Use when an agent or person funds open-source work.
---

# x402-github-bounty

x402-github-bounty is an Express service that is non-custodial: it verifies GitHub state and signs certificates, reports and receipts, but never holds bounty money. The funder pays the claimant directly and the signed receipt is the record.

## Run it

No package is published and there is no hosted instance, so run it from a clone: `git clone https://github.com/nirholas/x402-github-bounty && cd x402-github-bounty`, then `npm install`, `cp .env.example .env`, and `npm run dev` (tsx `src/server.ts`). It listens on `PORT`, default 4027. For production use `npm run build` then `npm start`.

Key env vars: `PORT`, `GITHUB_TOKEN` (optional; raises the GitHub API limit from 60 to 5,000 requests per hour), `SIGNING_SECRET`, `DATA_DIR`, `PUBLIC_BASE_URL`, `PAY_TO_ADDRESS`, `SOLANA_PAY_TO_ADDRESS`, `NETWORK`, `SOLANA_NETWORK`.

## Endpoints

- `POST /bounties` ($0.01). Body `{"issueUrl": "https://github.com/owner/repo/issues/123", "amount": 25, "terms": "...", "funder": "...", "expiryDays": 90}`. The issue is verified live through the GitHub REST API. Returns a signed `certificate`, its `signature`, `verifyUrl` and a secret `settleKey`. Keep `settleKey` private: it is shown once and authorizes settlement.
- `GET /verify/:bountyId` ($0.002 per poll). A signed report from live GitHub state: whether the issue is closed, which merged PRs reference it, their authors, and whether the bounty is eligible to pay out.
- `POST /settle/:bountyId` (free). Body `{settleKey, payoutAddress, prNumber?}` where `payoutAddress` is a `0x` plus 40 hex EVM address. Marks the bounty `settled` and returns a signed payout receipt. Errors: 403 `FORBIDDEN` for a wrong key, 409 `ALREADY_CLOSED`, 404 `BOUNTY_NOT_FOUND`.
- `GET /bounties` (free): the public board, without secrets. `POST /check-signature` (free): body `{payload, signature}` returns `{valid}`.
- `GET /`, `GET /health`, `GET /openapi.json`, `GET /skill.md` (free).

The `amount` is a recorded commitment, not an escrow. Moving the actual money to the claimant is a separate step the funder does, and the signed receipt only records it. Tell the user this before they rely on a certificate.

## Paying

Every paid route answers an unpaid request with HTTP 402 and a body whose `accepts` array lists two rails: USDC on Base (`base-sepolia` by default, `base` via `NETWORK`) and USDC on Solana (`solana` by default, `solana-devnet` via `SOLANA_NETWORK`). Pick the entry your wallet can sign, sign the USDC payment (EIP-3009 on Base, SPL `transferChecked` on Solana), and retry with the base64 `X-PAYMENT` header. The artifact is in the 200 body and the settlement receipt is in the `X-PAYMENT-RESPONSE` header. On the EVM rail `x402-fetch` with `viem` does this for you; `npm run client` runs `examples/agent-client.ts`, which reads `BASE_URL` and `PRIVATE_KEY`.

Discovery: `GET /.well-known/x402` lists routes, prices and rails, and `GET /skill.md` serves the repo's own reference. Paying moves real USDC on the configured network, so show the user the route, amount and rail first and wait for a yes before any paid call. Use a throwaway wallet on `base-sepolia` or `solana-devnet` for testing.
