# API reference

Base URL: `http://localhost:4027` when self-hosting. Machine-readable equivalents:
[`openapi.json`](https://github.com/nirholas/x402-github-bounty/blob/main/openapi.json) and
[`/.well-known/x402`](https://github.com/nirholas/x402-github-bounty/blob/main/public/.well-known/x402).

Prices are USDC. Every paid route accepts **both** rails — Base (EVM) and Solana — and
returns its artifact in the 200 body.

Every artifact is signed: **HMAC-SHA256 over canonical JSON** (keys sorted recursively)
using the deployment's `SIGNING_SECRET`. `POST /check-signature` validates any of them for
free.

---

## `POST /bounties`

**Price:** $0.01 · **Returns:** a signed bounty certificate + a one-time `settleKey`

The $0.01 is the mint fee. The pledged `amount` is **not** charged — this service is
non-custodial.

### Request body

| field | type | required | rules |
|---|---|---|---|
| `issueUrl` | string | yes | `https://github.com/owner/repo/issues/N`, or the shorthand `owner/repo#N` |
| `amount` | number | yes | Pledged bounty in USD. `0 < amount ≤ 1,000,000`. Recorded to 2 decimal places |
| `terms` | string | no | Free text. Defaults to *"Payable to the author of the first merged PR that closes the issue, at the funder's settlement."* |
| `funder` | string | no | Wallet address or name, signed into the certificate |
| `expiryDays` | integer | no | 1–365, default 90. Past `expiresAt`, an unsettled bounty reads as `expired` |

```json
{
  "issueUrl": "https://github.com/nodejs/node/issues/1",
  "amount": 25,
  "terms": "Payable on merge of a PR that adds a regression test.",
  "funder": "0xYourWallet",
  "expiryDays": 60
}
```

### What the server checks before signing

Payment is verified and settled first, then — in this order — the issue is fetched live from
GitHub and must **exist**, be an **issue rather than a pull request**, and be **open**. Only
then is a certificate minted. You are paying for the check as much as for the paper.

### Response 200

```json
{
  "certificate": {
    "type": "x402-bounty-certificate",
    "bountyId": "0f0c4b9e-…",
    "issueUrl": "https://github.com/nodejs/node/issues/1",
    "repo": "nodejs/node",
    "issueNumber": 1,
    "issueTitle": "…",
    "amount": "25.00",
    "currency": "USD",
    "terms": "…",
    "funder": "0xYourWallet",
    "createdAt": "2026-08-07T12:00:00.000Z",
    "expiresAt": "2026-10-06T12:00:00.000Z"
  },
  "signature": "9f2c…",
  "algorithm": "HMAC-SHA256 over canonical JSON",
  "settleKey": "b71e…",
  "settleKeyNote": "Keep settleKey secret — it authorizes POST /settle/:bountyId. It is stored only as a hash.",
  "verifyUrl": "/verify/0f0c4b9e-…",
  "receipt": { "success": true, "rail": "evm", "network": "base-sepolia", "transaction": "0x…" }
}
```

`settleKey` is 24 random bytes, hex. It is returned **once**; the server keeps only its
SHA-256 hash, so it cannot be recovered or leaked from the ledger. Losing it makes the
bounty permanently unsettleable.

### Errors

| status | `error` | cause |
|---|---|---|
| 400 | `BAD_REQUEST` | missing `issueUrl`, or `amount` not a positive number ≤ 1,000,000 |
| 400 | `INVALID_ISSUE_URL` | the URL is not a GitHub issue URL |
| 400 | `NOT_AN_ISSUE` | the URL resolves to a pull request |
| 402 | — | payment required or rejected |
| 404 | `ISSUE_NOT_FOUND` | GitHub has no such issue |
| 409 | `ISSUE_CLOSED` | you cannot open a bounty on an already-closed issue |
| 502 | `GITHUB_RATE_LIMITED` | anonymous quota exhausted — set `GITHUB_TOKEN` |
| 502 | `GITHUB_ERROR` | GitHub returned something unexpected |

---

## `GET /verify/:bountyId`

**Price:** $0.002 · **Returns:** a signed verification report

A fresh snapshot of GitHub each time you call it — pay-per-poll, not a subscription.

### Response 200

```json
{
  "report": {
    "type": "x402-bounty-verification",
    "bountyId": "0f0c4b9e-…",
    "issueUrl": "https://github.com/nodejs/node/issues/1",
    "bountyStatus": "open",
    "amount": "25.00",
    "issue": { "state": "closed", "closedAt": "2026-09-01T…", "stateReason": "completed" },
    "mergedPrs": [
      { "number": 418, "title": "fix: …", "author": "contributor",
        "url": "https://github.com/nodejs/node/pull/418",
        "mergedAt": "2026-09-01T…", "mergeCommit": "abc123…" }
    ],
    "eligible": true,
    "eligibleReason": "issue closed with merged PR(s) referencing it",
    "source": "github-live",
    "checkedAt": "2026-09-02T…"
  },
  "signature": "7d10…",
  "algorithm": "HMAC-SHA256 over canonical JSON",
  "receipt": { "success": true, "rail": "solana", "network": "solana", "transaction": "5Qm…" }
}
```

| field | meaning |
|---|---|
| `bountyStatus` | `open` \| `settled` \| `expired`, recomputed on read |
| `issue.state` / `closedAt` / `stateReason` | live GitHub issue state |
| `mergedPrs` | PRs cross-referenced from the issue timeline that actually merged, oldest first, up to 10 candidates inspected |
| `eligible` | `issue.state === "closed"` **and** `mergedPrs.length > 0` **and** `bountyStatus === "open"` |
| `eligibleReason` | which of those failed, in plain words |
| `checkedAt` | the instant this snapshot was taken — it is part of what you signed |

### How `mergedPrs` is derived

The server reads `GET /repos/{owner}/{repo}/issues/{n}/timeline` and collects
`cross-referenced` events whose source is a pull request — the same signal GitHub uses to
show "linked PRs". Each candidate is then fetched and kept only if it has a real
`merged_at`. A PR that mentions the issue but closed unmerged does not appear.

### Errors

| status | `error` | cause |
|---|---|---|
| 402 | — | payment required or rejected |
| 404 | `BOUNTY_NOT_FOUND` | unknown `bountyId` on this deployment |
| 502 | `GITHUB_RATE_LIMITED` / `GITHUB_ERROR` | GitHub upstream trouble |

---

## `POST /settle/:bountyId` — free

**Auth:** the `settleKey` from the certificate · **Returns:** a signed payout receipt

Free on purpose: the mint fee already paid for this bounty's lifecycle, and charging a
funder to close out would be a tax on doing the right thing.

### Request body

| field | type | required | rules |
|---|---|---|---|
| `settleKey` | string | yes | must hash to the stored `settleKeyHash` |
| `payoutAddress` | string | yes | `0x` + 40 hex — where you are sending the money |
| `prNumber` | integer | no | the merged PR being paid for, recorded in the receipt |

### Response 200

```json
{
  "receipt": {
    "type": "x402-bounty-payout-receipt",
    "bountyId": "0f0c4b9e-…",
    "issueUrl": "https://github.com/nodejs/node/issues/1",
    "amount": "25.00",
    "currency": "USD",
    "payoutAddress": "0xClaimantWallet",
    "payoutPr": 418,
    "settledAt": "2026-09-02T…",
    "note": "The funder is responsible for transferring the bounty amount to payoutAddress; this receipt is the signed settlement record."
  },
  "signature": "3ab8…"
}
```

The bounty flips to `settled` and cannot be settled again.

### Errors

| status | `error` | cause |
|---|---|---|
| 400 | `BAD_REQUEST` | `payoutAddress` is not a `0x` EVM address |
| 403 | `FORBIDDEN` | `settleKey` does not match |
| 404 | `BOUNTY_NOT_FOUND` | unknown `bountyId` |
| 409 | `ALREADY_CLOSED` | already `settled` or `expired` |

---

## `POST /check-signature` — free

Validate any certificate, report or receipt this deployment signed.

```json
{ "payload": { "type": "x402-bounty-certificate", "…": "…" }, "signature": "9f2c…" }
```

```json
{
  "valid": true,
  "type": "x402-bounty-certificate",
  "checkedAt": "2026-09-02T…",
  "note": "Signature matches this server's SIGNING_SECRET."
}
```

Comparison is timing-safe. Field order in `payload` is irrelevant — canonicalisation sorts
keys recursively before hashing. `400 BAD_REQUEST` if `payload` or `signature` is missing.

---

## `GET /bounties` — free

The public board: every certificate this deployment has issued, newest first, with
`settleKeyHash` stripped.

```json
{
  "count": 2,
  "bounties": [
    { "bountyId": "…", "issueUrl": "…", "issueTitle": "…", "amount": "25.00",
      "status": "open", "createdAt": "…", "expiresAt": "…", "funder": "0x…" }
  ]
}
```

## Other free routes

| route | returns |
|---|---|
| `GET /` | service card: rails, prices, custody statement, doc links |
| `GET /health` | `{ ok: true, uptime: <seconds> }` |
| `GET /skill.md` | the agent-facing skill file, `text/markdown` |
| `GET /.well-known/x402` | resource manifest with prices, rails and schemas |
| `GET /openapi.json` | OpenAPI 3.1 |

---

## Payment

### The 402 body

```jsonc
{
  "x402Version": 1,
  "error": "X-PAYMENT header is required",
  "accepts": [ /* one PaymentRequirements per rail */ ]
}
```

`PaymentRequirements`:

| field | example | notes |
|---|---|---|
| `scheme` | `"exact"` | the only scheme accepted |
| `network` | `"base-sepolia"` / `"solana"` | switched by `NETWORK` and `SOLANA_NETWORK` |
| `maxAmountRequired` | `"10000"` | base units; USDC has 6 decimals, so this is $0.01 |
| `resource` | `"http://localhost:4027/bounties"` | absolute URL being purchased |
| `description` | `"Mint a signed bounty certificate…"` | shown by wallets and the checkout modal |
| `mimeType` | `"application/json"` | what the 200 will be |
| `payTo` | `0x40252CF…` / `WwwuGbqH…` | receive address for that rail |
| `maxTimeoutSeconds` | `60` | how long the authorisation stays valid |
| `asset` | USDC address / SPL mint | the token you pay in |
| `extra` | `{ name, version }` / `{ name, decimals, feePayer }` | EIP-712 domain on EVM; the fee sponsor on Solana |

### The receipt

Paid responses set `X-PAYMENT-RESPONSE` to base64 JSON and repeat it inline as `receipt`:

```json
{
  "success": true,
  "rail": "evm",
  "network": "base-sepolia",
  "transaction": "0xabc…",
  "payer": "0xYourWallet",
  "amount": "10000",
  "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  "resource": "http://localhost:4027/bounties"
}
```

### 402 reasons

| `error` | meaning |
|---|---|
| `X-PAYMENT header is required` | first, unpaid attempt — normal |
| `invalid X-PAYMENT header: …` | not base64, or not a valid x402 payload |
| `unsupported rail: this endpoint does not accept exact on <network>` | you signed on a rail this server does not take |
| `payment rejected: <reason>` | the facilitator's `invalidReason` — `insufficient_funds`, `payment_expired`, `invalid_exact_evm_payload_signature`, … |
| `settlement failed: <reason>` | verified but could not be broadcast |

A facilitator outage returns `502 facilitator_unreachable` or `502 settlement_error` rather
than a 402, so a retry loop does not mistake an outage for a price.
