# The raw 402 → pay → 200 walkthrough

No SDK — just HTTP, so you can see exactly what the protocol does.

```bash
npm install && npm run dev     # http://localhost:4021
```

## 0. Discover the service for free

```bash
curl -s localhost:4021/ | jq
curl -s localhost:4021/.well-known/x402 | jq '.resources[] | {resource, price}'
```

```
{ "resource": "POST /bounties",        "price": "$0.01" }
{ "resource": "GET /verify/:bountyId", "price": "$0.002" }
```

## 1. Mint a certificate without paying → 402 with **both** rails

```bash
curl -i -s -X POST localhost:4021/bounties \
  -H 'content-type: application/json' \
  -d '{"issueUrl":"https://github.com/nodejs/node/issues/1","amount":25}'
```

```http
HTTP/1.1 402 Payment Required
Content-Type: application/json
```

```jsonc
{
  "x402Version": 1,
  "error": "X-PAYMENT header is required",
  "accepts": [
    {
      "scheme": "exact",
      "network": "base-sepolia",
      "maxAmountRequired": "10000",             // 10000 base units = $0.01 USDC (6 dp)
      "resource": "http://localhost:4021/bounties",
      "description": "Mint a signed bounty certificate against a live-verified open GitHub issue",
      "mimeType": "application/json",
      "payTo": "0x40252CFDF8B20Ed757D61ff157719F33Ec332402",
      "maxTimeoutSeconds": 60,
      "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      "extra": { "name": "USDC", "version": "2" }
    },
    {
      "scheme": "exact",
      "network": "solana",
      "maxAmountRequired": "10000",
      "resource": "http://localhost:4021/bounties",
      "description": "Mint a signed bounty certificate against a live-verified open GitHub issue",
      "mimeType": "application/json",
      "payTo": "WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW",
      "maxTimeoutSeconds": 60,
      "asset": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "extra": { "name": "USD Coin", "decimals": 6, "feePayer": "2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4" }
    }
  ]
}
```

Note the price is the **mint fee**, not the bounty. `$0.01` buys the certificate; the `$25`
you declared is a pledge signed into it.

Just the rails:

```bash
curl -s -X POST localhost:4021/bounties -H 'content-type: application/json' \
  -d '{"issueUrl":"https://github.com/nodejs/node/issues/1","amount":25}' \
  | jq '.accepts[] | {network, asset, payTo, maxAmountRequired}'
```

## 2. Build the payment

`X-PAYMENT` is base64 of a JSON payload proving you authorised exactly
`maxAmountRequired` to `payTo` on the rail you chose.

**EVM rail** — an EIP-3009 `transferWithAuthorization` signature:

```jsonc
{
  "x402Version": 1,
  "scheme": "exact",
  "network": "base-sepolia",
  "payload": {
    "signature": "0x…",
    "authorization": {
      "from": "0xYourWallet",
      "to": "0x40252CFDF8B20Ed757D61ff157719F33Ec332402",
      "value": "10000",
      "validAfter": "0",
      "validBefore": "1791234567",
      "nonce": "0x…"
    }
  }
}
```

**Solana rail** — a signed SPL `transferChecked` transaction, base64, in the same envelope.
`@three-ws/x402-payment-modal/server` builds and encodes it (`prepareSolanaCheckout` → sign
→ `encodeX402Payment`).

```bash
X_PAYMENT=$(printf '%s' "$PAYLOAD_JSON" | base64 -w0)
```

Worth doing by hand once. After that:

```bash
PRIVATE_KEY=0xyourTestnetKey npm run client
```

## 3. Retry with the header → 200 + the certificate

```bash
curl -i -s -X POST localhost:4021/bounties \
  -H 'content-type: application/json' \
  -H "X-PAYMENT: $X_PAYMENT" \
  -d '{"issueUrl":"https://github.com/nodejs/node/issues/1","amount":25,"funder":"0xYourWallet"}'
```

```http
HTTP/1.1 200 OK
X-PAYMENT-RESPONSE: eyJzdWNjZXNzIjp0cnVlLCJyYWlsIjoiZXZtIiwi…
```

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
    "terms": "Payable to the author of the first merged PR that closes the issue…",
    "funder": "0xYourWallet",
    "createdAt": "2026-08-07T12:00:00.000Z",
    "expiresAt": "2026-11-05T12:00:00.000Z"
  },
  "signature": "9f2c…",
  "algorithm": "HMAC-SHA256 over canonical JSON",
  "settleKey": "b71e…",
  "verifyUrl": "/verify/0f0c4b9e-…",
  "receipt": { "success": true, "rail": "evm", "network": "base-sepolia", "transaction": "0x…" }
}
```

The server called GitHub before signing: if that issue did not exist, was a PR, or was
already closed, you would have got a 404 / 400 / 409 instead — and no certificate.

## 4. Buy a verification report — $0.002

```bash
curl -s localhost:4021/verify/$BOUNTY_ID -H "X-PAYMENT: $X_PAYMENT_2000" | jq .report
```

```json
{
  "type": "x402-bounty-verification",
  "bountyId": "0f0c4b9e-…",
  "bountyStatus": "open",
  "issue": { "state": "closed", "closedAt": "2026-09-01T…", "stateReason": "completed" },
  "mergedPrs": [
    { "number": 124, "title": "fix: …", "author": "octocat",
      "url": "https://github.com/nodejs/node/pull/124",
      "mergedAt": "2026-09-01T…", "mergeCommit": "abc123…" }
  ],
  "eligible": true,
  "eligibleReason": "issue closed with merged PR(s) referencing it",
  "source": "github-live",
  "checkedAt": "2026-09-02T…"
}
```

The price is separate ($0.002 → `maxAmountRequired: "2000"`), so it needs its own payment.

## 5. Settle — free

```bash
curl -s -X POST localhost:4021/settle/$BOUNTY_ID \
  -H 'content-type: application/json' \
  -d '{"settleKey":"b71e…","payoutAddress":"0xClaimantWallet","prNumber":124}' | jq
```

```json
{
  "receipt": {
    "type": "x402-bounty-payout-receipt",
    "bountyId": "0f0c4b9e-…",
    "amount": "25.00",
    "currency": "USD",
    "payoutAddress": "0xClaimantWallet",
    "payoutPr": 124,
    "settledAt": "2026-09-02T…",
    "note": "The funder is responsible for transferring the bounty amount to payoutAddress; this receipt is the signed settlement record."
  },
  "signature": "3ab8…"
}
```

## 6. Check any signature — free

```bash
curl -s -X POST localhost:4021/check-signature \
  -H 'content-type: application/json' \
  -d "{\"payload\": $CERTIFICATE_JSON, \"signature\": \"9f2c…\"}" | jq
# { "valid": true, "type": "x402-bounty-certificate", "checkedAt": "…" }
```

Change one byte of the payload and `valid` flips to `false`.

## Errors you may hit

| what you sent | you get |
|---|---|
| no header on a paid route | 402, `error: "X-PAYMENT header is required"` |
| garbage header | 402, `error: "invalid X-PAYMENT header: …"` |
| a rail we don't take | 402, `error: "unsupported rail: …"` |
| short-paid or expired authorisation | 402, `error:` the facilitator's `invalidReason` |
| an issue URL that isn't one | 400, `INVALID_ISSUE_URL` |
| a PR URL instead of an issue | 400, `NOT_AN_ISSUE` |
| an issue that is already closed | 409, `ISSUE_CLOSED` |
| an issue that doesn't exist | 404, `ISSUE_NOT_FOUND` |
| the wrong `settleKey` | 403, `FORBIDDEN` |
| too many anonymous GitHub calls | 502, `GITHUB_RATE_LIMITED` — set `GITHUB_TOKEN` |
