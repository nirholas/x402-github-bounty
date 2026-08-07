/**
 * examples/agent-client.ts — the whole bounty lifecycle, paid end to end.
 *
 *   PRIVATE_KEY=0x… ISSUE_URL=https://github.com/owner/repo/issues/123 npm run client
 *
 * ① show the raw dual-rail 402   ② mint a certificate ($0.01)
 * ③ buy a verification report ($0.002)   ④ settle (free) when eligible
 *
 * `wrapFetchWithPayment` catches each 402, picks the EVM requirement out of the
 * dual-rail `accepts` array, signs an EIP-3009 authorisation for the exact
 * amount, and retries with `X-PAYMENT`. The Solana rail is shown at the bottom.
 */
import { createWalletClient, http, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import { wrapFetchWithPayment, decodeXPaymentResponse } from "x402-fetch";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:4027";
const ISSUE_URL = process.env.ISSUE_URL ?? "https://github.com/expressjs/express/issues/5555";
const PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}` | undefined;

async function showChallenge(): Promise<void> {
  console.log(`\n① Unpaid request → expect a dual-rail 402\n   POST ${BASE_URL}/bounties`);
  const res = await fetch(`${BASE_URL}/bounties`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ issueUrl: ISSUE_URL, amount: 25 }),
  });
  const body = await res.json();
  console.log(`   HTTP ${res.status}`);
  for (const a of body.accepts ?? []) {
    console.log(
      `   accepts: ${String(a.network).padEnd(14)} ${a.maxAmountRequired} base units USDC → ${a.payTo}`,
    );
  }
}

async function main(): Promise<void> {
  await showChallenge();

  if (!PRIVATE_KEY) {
    console.log(
      "\nSet PRIVATE_KEY to a funded Base Sepolia wallet to complete the purchase." +
        "\nTestnet USDC faucet: https://faucet.circle.com\n",
    );
    return;
  }

  const chain = process.env.NETWORK === "base" ? base : baseSepolia;
  const account = privateKeyToAccount(PRIVATE_KEY);
  const wallet = createWalletClient({ account, chain, transport: http() }).extend(publicActions);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pay = wrapFetchWithPayment(fetch, wallet as any);

  console.log(`\n② Minting a certificate from ${account.address} on ${chain.name} — $0.01`);
  const created = await pay(`${BASE_URL}/bounties`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      issueUrl: ISSUE_URL,
      amount: 25,
      funder: account.address,
      terms: "Payable to the author of the first merged PR that closes this issue.",
    }),
  });
  const cert = await created.json();
  if (!created.ok) throw new Error(`mint failed: ${created.status} ${JSON.stringify(cert)}`);

  console.log("\n   the artifact — a signed bounty certificate:");
  console.log(JSON.stringify(cert.certificate, null, 2));
  console.log(`   signature: ${cert.signature}`);
  console.log(`   settleKey: ${cert.settleKey}   ← keep this secret, it closes the bounty`);
  const r1 = created.headers.get("x-payment-response");
  if (r1) console.log("   X-PAYMENT-RESPONSE:", decodeXPaymentResponse(r1));

  const bountyId: string = cert.certificate.bountyId;

  console.log(`\n③ Buying a verification report for ${bountyId} — $0.002`);
  const verified = await pay(`${BASE_URL}/verify/${bountyId}`);
  const verification = await verified.json();
  if (!verified.ok) throw new Error(`verify failed: ${verified.status}`);
  console.log(JSON.stringify(verification.report, null, 2));

  // Anyone can check a signature for free — no payment, no secret required.
  const check = await fetch(`${BASE_URL}/check-signature`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ payload: cert.certificate, signature: cert.signature }),
  });
  console.log(`   certificate signature valid: ${(await check.json()).valid}`);

  if (verification.report.eligible) {
    console.log(`\n④ Settling ${bountyId} — free`);
    const settled = await fetch(`${BASE_URL}/settle/${bountyId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        settleKey: cert.settleKey,
        payoutAddress: account.address,
        prNumber: verification.report.mergedPrs[0]?.number,
      }),
    });
    console.log(JSON.stringify(await settled.json(), null, 2));
    console.log(
      "\n   Remember: the receipt records the payout. Transferring the $25 to the claimant " +
        "is yours to do — this service is non-custodial.",
    );
  } else {
    console.log(`\n④ Not settleable yet: ${verification.report.eligibleReason}`);
  }
}

main().catch((err) => {
  console.error("\nfailed:", err instanceof Error ? err.message : err);
  process.exit(1);
});

/* ---------------------------------------------------------------------------
 * Paying on the SOLANA rail instead
 * ---------------------------------------------------------------------------
 * The same 402 carries a `solana` entry. Pick it, build the SPL transferChecked
 * to `payTo` for `maxAmountRequired` base units of the USDC mint, sign it, and
 * base64 the x402 envelope into `X-PAYMENT`:
 *
 *   import {
 *     prepareSolanaCheckout,
 *     encodeX402Payment,
 *   } from "@three-ws/x402-payment-modal/server";
 *
 *   const challenge = await (await fetch(`${BASE_URL}/bounties`, { method: "POST", … })).json();
 *   const accept    = challenge.accepts.find((a: any) => a.network.startsWith("solana"));
 *
 *   const { tx_base64 } = await prepareSolanaCheckout({ accept, buyer: myPubkey });
 *   const signed        = await wallet.signTransaction(tx_base64);   // Phantom, Solflare, a keypair
 *   const { x_payment } = encodeX402Payment({
 *     accept,
 *     signedTxBase64: signed,
 *     resourceUrl: `${BASE_URL}/bounties`,
 *   });
 *
 *   await fetch(`${BASE_URL}/bounties`, {
 *     method: "POST",
 *     headers: { "content-type": "application/json", "X-PAYMENT": x_payment },
 *     body: JSON.stringify({ issueUrl: ISSUE_URL, amount: 25 }),
 *   });
 *
 * The fee payer in `accept.extra.feePayer` sponsors the SOL network fee, so the
 * buyer spends USDC only.
 *
 * ---------------------------------------------------------------------------
 * The raw dual-rail 402, for reference
 * ---------------------------------------------------------------------------
 *   $ curl -s -X POST localhost:4027/bounties -H 'content-type: application/json' \
 *       -d '{"issueUrl":"https://github.com/nodejs/node/issues/1","amount":25}' \
 *     | jq '.accepts[] | {network, payTo, maxAmountRequired}'
 *   { "network": "base-sepolia", "payTo": "0x40252CFDF8B20Ed757D61ff157719F33Ec332402", "maxAmountRequired": "10000" }
 *   { "network": "solana",       "payTo": "WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW", "maxAmountRequired": "10000" }
 */
