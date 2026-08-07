# x402-github-bounty

> Fund GitHub issues with x402 — signed bounty certificates, merged-PR verification reports, settlement receipts. Every artifact is returned in the paid response body and verified against live GitHub state.

x402-github-bounty lets any agent or human put money on a GitHub issue. Creating a bounty live-verifies the issue via the GitHub REST API and returns an HMAC-signed bounty certificate. Anyone can then buy a verification report — live GitHub state showing whether the issue closed and which merged PRs reference it — and the funder settles with a signed payout receipt.

**Base URL**: `http://localhost:4027` when self-hosted — replace with the deployment you are
talking to. **Contact**: nichxbt@gmail.com

**Custody**: this service is non-custodial. It verifies GitHub state and signs certificates,
reports and receipts. It never holds the bounty money — the funder pays the claimant
directly and the signed receipt is the settlement record.

## `POST /bounties` — $0.01

Create a bounty on a live-verified open GitHub issue.

- **Body**:
```json
{
  "issueUrl": "https://github.com/owner/repo/issues/123",
  "amount": 25,
  "terms": "optional payout terms",
  "funder": "0xFunderAddressOrName (optional)",
  "expiryDays": 90
}
```
**Response 200** — the signed certificate (the purchased artifact), plus a secret `settleKey` that authorises settlement:
```json
{
  "certificate": {
    "type": "x402-bounty-certificate",
    "bountyId": "uuid",
    "issueUrl": "https://github.com/owner/repo/issues/123",
    "repo": "owner/repo",
    "issueNumber": 123,
    "issueTitle": "...",
    "amount": "25.00",
    "currency": "USD",
    "terms": "...",
    "funder": null,
    "createdAt": "...",
    "expiresAt": "..."
  },
  "signature": "hmac-sha256 hex over canonical JSON",
  "settleKey": "keep secret — authorizes POST /settle/:bountyId",
  "verifyUrl": "/verify/<bountyId>"
}
```

## `GET /verify/:bountyId` — $0.002

A signed verification report built from live GitHub state at request time: is the issue
closed, which merged PRs reference it, who authored them, and whether the bounty is eligible
to pay out. Pay-per-poll — each call is a fresh, signed snapshot.

**Parameters**

| name | in | type | required | notes |
|---|---|---|---|---|
| `bountyId` | path | string | yes | The `bountyId` from a certificate issued by this deployment |

**Response 200**
```json
{
  "report": {
    "type": "x402-bounty-verification",
    "bountyId": "uuid",
    "issue": { "state": "closed", "closedAt": "...", "stateReason": "completed" },
    "mergedPrs": [{ "number": 124, "title": "...", "author": "octocat", "url": "...", "mergedAt": "...", "mergeCommit": "..." }],
    "eligible": true,
    "eligibleReason": "issue closed with merged PR(s) referencing it",
    "source": "github-live",
    "checkedAt": "..."
  },
  "signature": "..."
}
```

## `POST /settle/:bountyId` — free

Close a bounty and get the signed payout receipt back immediately. Free because the mint fee
already paid for this bounty's lifecycle, and because a funder should never be charged to do
the right thing. Marks the bounty `settled`; a second attempt returns `409`.

**Parameters**

| name | in | type | required | notes |
|---|---|---|---|---|
| `bountyId` | path | string | yes | The bounty being closed |
| `settleKey` | body | string | yes | The secret returned once with the certificate; stored only as a hash |
| `payoutAddress` | body | string | yes | `0x` + 40 hex — where you are sending the money |
| `prNumber` | body | integer | no | The merged PR being paid for, recorded in the receipt |

**Response 200**

```json
{
  "receipt": {
    "type": "x402-bounty-payout-receipt",
    "bountyId": "0f0c4b9e-…",
    "issueUrl": "https://github.com/nodejs/node/issues/1",
    "amount": "25.00",
    "currency": "USD",
    "payoutAddress": "0xClaimantWallet",
    "payoutPr": 124,
    "settledAt": "2026-09-02T10:14:00.000Z",
    "note": "The funder is responsible for transferring the bounty amount to payoutAddress; this receipt is the signed settlement record."
  },
  "signature": "3ab8…"
}
```

**You still owe the money.** This service is non-custodial — it never received your bounty,
so it cannot forward it. The receipt is a signed, timestamped record that you committed to
pay and to whom.

## Free routes

| route | returns |
| --- | --- |
| `GET /` | service card: rails, prices, doc links |
| `GET /health` | `{ ok, uptime }` |
| `GET /bounties` | the public bounty board (every certificate, minus secrets) |
| `POST /check-signature` | `{ valid }` — validate any certificate / report / receipt this server issued. Body: `{ payload, signature }` |
| `GET /skill.md` | this file |
| `GET /.well-known/x402` | machine-readable resource manifest |
| `GET /openapi.json` | OpenAPI 3.1 |

## Payment

This service speaks [x402](https://x402.org) (HTTP 402 Payment Required). Every paid route
answers an unpaid request with a 402 whose `accepts` array carries **two rails — USDC on
Base (EVM) and USDC on Solana. Your client picks whichever it can sign.**

```jsonc
{
  "x402Version": 1,
  "error": "X-PAYMENT header is required",
  "accepts": [
    { "scheme": "exact", "network": "base-sepolia", "maxAmountRequired": "10000",
      "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      "payTo": "0x40252CFDF8B20Ed757D61ff157719F33Ec332402",
      "resource": "http://localhost:4027/bounties", "mimeType": "application/json",
      "maxTimeoutSeconds": 60, "extra": { "name": "USDC", "version": "2" } },
    { "scheme": "exact", "network": "solana", "maxAmountRequired": "10000",
      "asset": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "payTo": "WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW",
      "resource": "http://localhost:4027/bounties", "mimeType": "application/json",
      "maxTimeoutSeconds": 60,
      "extra": { "name": "USD Coin", "decimals": 6, "feePayer": "2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4" } }
  ]
}
```

- **Asset**: USDC (6 decimals) on both rails · **scheme**: `exact`
- **Invocation contract:** every accept also carries `outputSchema.input` (how to build the
  request — method, query/path params, JSON body fields) and `outputSchema.output` (the JSON
  Schema of the 200 body). Both are elided above for readability and both are generated from
  `openapi.json`, so an agent can plan and call the route from the challenge alone.
- **Networks**: `base-sepolia` (default) or `base`; `solana` (default) or `solana-devnet`
- **Facilitators**: `https://x402.org/facilitator` (EVM) and `https://facilitator.payai.network`
  (Solana) — the reference x402.org facilitator only settles Base Sepolia
- **How to pay**: any x402 client. `x402-fetch` + `viem` on the EVM rail; on Solana build the
  SPL `transferChecked` (the fee is sponsored by `extra.feePayer`, so you need no SOL), sign
  it, and base64 the envelope into `X-PAYMENT`.
- **Receipt**: paid responses carry `X-PAYMENT-RESPONSE` (base64 JSON with `rail`, `network`,
  `transaction`, `payer`, `amount`) and repeat it inline as `receipt`.

## What the price buys, and what it does not

`$0.01` mints the certificate. It is **not** the bounty. The `amount` you declare is a
pledge recorded and signed inside the certificate; you pay the claimant yourself and record
it with `POST /settle/:bountyId`. Nothing here custodies funds, which is why nothing here
can run off with them.

## Signatures

Every artifact — certificate, verification report, payout receipt — is HMAC-SHA256 over
canonical (recursively key-sorted) JSON using the deployment's `SIGNING_SECRET`. To check
one, POST it back:

```bash
curl -s -X POST $BASE/check-signature -H 'content-type: application/json' \
  -d '{"payload": <the signed object>, "signature": "<hex>"}'
# { "valid": true, "type": "x402-bounty-certificate", "checkedAt": "..." }
```

Signatures are only as trustworthy as the deployment that issued them: a certificate proves
*this server* saw that issue open at that time, not that anyone escrowed money.

## Errors

| Status | Code | Meaning |
| --- | --- | --- |
| 400 | `BAD_REQUEST` / `INVALID_ISSUE_URL` / `NOT_AN_ISSUE` | Malformed input |
| 402 | — | Payment required or rejected; body is the dual-rail challenge with `error` explaining why |
| 403 | `FORBIDDEN` | settleKey mismatch |
| 404 | `ISSUE_NOT_FOUND` / `BOUNTY_NOT_FOUND` | No such issue/bounty |
| 409 | `ISSUE_CLOSED` / `ALREADY_CLOSED` | State conflict |
| 502 | `GITHUB_RATE_LIMITED` / `GITHUB_ERROR` | GitHub upstream trouble |

## Data source

GitHub REST API v3, live on every call. `GITHUB_TOKEN` is optional: without it the server
gets GitHub's 60 requests/hour anonymous quota, with it 5,000/hour plus access to issues in
private repos you can read. There is no fixture mode — a verification report always reflects
GitHub state at `checkedAt`.

## Discovery

Manifest: `/.well-known/x402` · OpenAPI: `/openapi.json` · Docs:
<https://nirholas.github.io/x402-github-bounty/>
