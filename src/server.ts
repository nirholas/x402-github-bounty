import "dotenv/config";
import express from "express";
import path from "node:path";
import { randomUUID, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  paywall,
  activeRails,
  usingSuiteDefaultPayTo,
  paymentReceipt,
  type RoutePrices,
} from "./payments.js";
import { parseIssueUrl, getIssue, findMergedPrs, GitHubError } from "./github.js";
import { sign, verify as verifySignature, sha256 } from "./sign.js";
import { putBounty, getBounty, listBounties, type BountyRecord } from "./store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const PORT = Number(process.env.PORT || 4021);

const PAID_ROUTES: RoutePrices = {
  "POST /bounties": "$0.01",
  "GET /verify/:bountyId": "$0.002",
};

const DESCRIPTIONS: Record<string, string> = {
  "POST /bounties":
    "Mint a signed bounty certificate against a live-verified open GitHub issue",
  "GET /verify/:bountyId":
    "Signed merged-PR verification report built from live GitHub state",
};

const PRICE_TABLE = [
  { route: "POST /bounties", price: "$0.01" },
  { route: "GET /verify/:bountyId", price: "$0.002" },
  { route: "POST /settle/:bountyId", price: "free (settle-key auth)" },
  { route: "GET /bounties", price: "free" },
  { route: "POST /check-signature", price: "free" },
];

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "256kb" }));

// ---- free routes ----
app.get("/", (_req, res) => {
  res.json({
    name: "x402-github-bounty",
    description:
      "Fund GitHub issues with x402 — signed bounty certificates, merged-PR verification reports, settlement receipts",
    docs: "https://nirholas.github.io/x402-github-bounty/",
    skill: "/skill.md",
    manifest: "/.well-known/x402",
    openapi: "/openapi.json",
    payment: {
      protocol: "x402",
      note: "Pay in USDC on Base or Solana — your client picks the rail.",
      rails: activeRails(),
    },
    custody: "non-custodial — this service signs certificates and reports, it never holds bounty funds",
    endpoints: PRICE_TABLE,
  });
});
app.get("/health", (_req, res) => res.json({ ok: true, uptime: process.uptime() }));
app.get("/.well-known/x402", (_req, res) =>
  res.type("application/json").sendFile(path.join(ROOT, "public", ".well-known", "x402")),
);
app.get("/skill.md", (_req, res) => res.type("text/markdown").sendFile(path.join(ROOT, "skill.md")));
app.get("/openapi.json", (_req, res) => res.sendFile(path.join(ROOT, "openapi.json")));
app.use(express.static(path.join(ROOT, "public")));

// Public bounty board (free) — certificates minus secrets.
app.get("/bounties", (_req, res) => {
  res.json({
    count: listBounties().length,
    bounties: listBounties().map(({ settleKeyHash: _omit, ...pub }) => pub),
  });
});

/**
 * POST /check-signature (free) — anyone can validate a certificate, report or
 * receipt this server issued without paying. Signatures are HMAC-SHA256 over
 * canonical JSON, so `payload` must be the object exactly as it was returned.
 */
app.post("/check-signature", (req, res) => {
  const { payload, signature } = req.body ?? {};
  if (payload === undefined || typeof signature !== "string") {
    res.status(400).json({
      error: "BAD_REQUEST",
      message: 'Body must be { "payload": <the signed object>, "signature": "<hex>" }',
    });
    return;
  }
  const valid = verifySignature(payload, signature);
  res.json({
    valid,
    type: (payload as { type?: string })?.type ?? null,
    checkedAt: new Date().toISOString(),
    note: valid
      ? "Signature matches this server's SIGNING_SECRET."
      : "Signature does not match — the payload was altered, or it was signed by a different deployment.",
  });
});

// ---- paywall: everything below this line costs USDC ----
app.use(paywall(PAID_ROUTES, { service: "x402-github-bounty", descriptions: DESCRIPTIONS }));

/**
 * POST /bounties — $0.01
 * The purchased artifact is the signed bounty certificate itself, returned
 * immediately in the 200 body (iron rule: no pay-now-deliver-later).
 */
app.post("/bounties", async (req, res) => {
  try {
    const { issueUrl, amount, terms, funder, expiryDays } = req.body ?? {};
    if (typeof issueUrl !== "string" || !issueUrl) {
      res.status(400).json({ error: "BAD_REQUEST", message: "issueUrl is required" });
      return;
    }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0 || amt > 1_000_000) {
      res.status(400).json({ error: "BAD_REQUEST", message: "amount must be a positive USD number" });
      return;
    }
    const ref = parseIssueUrl(issueUrl);
    const issue = await getIssue(ref); // live GitHub verification
    if (issue.isPullRequest) {
      res.status(400).json({ error: "NOT_AN_ISSUE", message: "URL points to a pull request, not an issue" });
      return;
    }
    if (issue.state === "closed") {
      res.status(409).json({ error: "ISSUE_CLOSED", message: "Cannot open a bounty on a closed issue" });
      return;
    }

    const days = Math.min(Math.max(Number(expiryDays) || 90, 1), 365);
    const settleKey = randomBytes(24).toString("hex");
    const certificate = {
      type: "x402-bounty-certificate",
      bountyId: randomUUID(),
      issueUrl: issue.url,
      repo: issue.repo,
      issueNumber: ref.number,
      issueTitle: issue.title,
      amount: amt.toFixed(2),
      currency: "USD",
      terms:
        typeof terms === "string" && terms
          ? terms
          : "Payable to the author of the first merged PR that closes the issue, at the funder's settlement.",
      funder: typeof funder === "string" ? funder : null,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + days * 86_400_000).toISOString(),
    };
    const signature = sign(certificate);

    const record: BountyRecord = {
      bountyId: certificate.bountyId,
      issueUrl: certificate.issueUrl,
      owner: ref.owner,
      repo: ref.repo,
      issueNumber: ref.number,
      issueTitle: issue.title,
      amount: certificate.amount,
      terms: certificate.terms,
      funder: certificate.funder,
      status: "open",
      createdAt: certificate.createdAt,
      expiresAt: certificate.expiresAt,
      settleKeyHash: sha256(settleKey),
    };
    putBounty(record);

    res.json({
      certificate,
      signature,
      algorithm: "HMAC-SHA256 over canonical JSON",
      settleKey,
      settleKeyNote:
        "Keep settleKey secret — it authorizes POST /settle/:bountyId. It is stored only as a hash.",
      verifyUrl: `/verify/${certificate.bountyId}`,
      receipt: paymentReceipt(res),
    });
  } catch (err) {
    if (err instanceof GitHubError) {
      res.status(err.status === 404 ? 404 : 502).json({ error: err.code, message: err.message });
    } else {
      res.status(500).json({ error: "INTERNAL", message: String(err) });
    }
  }
});

/**
 * GET /verify/:bountyId — $0.002
 * Live merged-PR verification report, signed.
 */
app.get("/verify/:bountyId", async (req, res) => {
  try {
    const bounty = getBounty(req.params.bountyId);
    if (!bounty) {
      res.status(404).json({ error: "BOUNTY_NOT_FOUND", message: "Unknown bountyId" });
      return;
    }
    const ref = { owner: bounty.owner, repo: bounty.repo, number: bounty.issueNumber };
    const issue = await getIssue(ref);
    const mergedPrs = await findMergedPrs(ref);
    const report = {
      type: "x402-bounty-verification",
      bountyId: bounty.bountyId,
      issueUrl: bounty.issueUrl,
      bountyStatus: bounty.status,
      amount: bounty.amount,
      issue: {
        state: issue.state,
        closedAt: issue.closedAt,
        stateReason: issue.stateReason,
      },
      mergedPrs,
      eligible: issue.state === "closed" && mergedPrs.length > 0 && bounty.status === "open",
      eligibleReason:
        bounty.status !== "open"
          ? `bounty is ${bounty.status}`
          : issue.state !== "closed"
            ? "issue is still open"
            : mergedPrs.length === 0
              ? "no merged PR references this issue"
              : "issue closed with merged PR(s) referencing it",
      source: "github-live",
      checkedAt: new Date().toISOString(),
    };
    res.json({
      report,
      signature: sign(report),
      algorithm: "HMAC-SHA256 over canonical JSON",
      receipt: paymentReceipt(res),
    });
  } catch (err) {
    if (err instanceof GitHubError) {
      res.status(502).json({ error: err.code, message: err.message });
    } else {
      res.status(500).json({ error: "INTERNAL", message: String(err) });
    }
  }
});

/**
 * POST /settle/:bountyId — free (auth by settleKey)
 * Returns a signed payout receipt immediately.
 */
app.post("/settle/:bountyId", async (req, res) => {
  const bounty = getBounty(req.params.bountyId);
  if (!bounty) {
    res.status(404).json({ error: "BOUNTY_NOT_FOUND", message: "Unknown bountyId" });
    return;
  }
  const { settleKey, payoutAddress, prNumber } = req.body ?? {};
  if (typeof settleKey !== "string" || sha256(settleKey) !== bounty.settleKeyHash) {
    res.status(403).json({ error: "FORBIDDEN", message: "settleKey does not match this bounty" });
    return;
  }
  if (bounty.status !== "open") {
    res.status(409).json({ error: "ALREADY_CLOSED", message: `Bounty is ${bounty.status}` });
    return;
  }
  if (typeof payoutAddress !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(payoutAddress)) {
    res.status(400).json({ error: "BAD_REQUEST", message: "payoutAddress must be a 0x EVM address" });
    return;
  }

  bounty.status = "settled";
  bounty.settledAt = new Date().toISOString();
  bounty.payoutAddress = payoutAddress;
  if (Number.isInteger(prNumber)) bounty.payoutPr = prNumber;
  putBounty(bounty);

  const receipt = {
    type: "x402-bounty-payout-receipt",
    bountyId: bounty.bountyId,
    issueUrl: bounty.issueUrl,
    amount: bounty.amount,
    currency: "USD",
    payoutAddress,
    payoutPr: bounty.payoutPr ?? null,
    settledAt: bounty.settledAt,
    note: "The funder is responsible for transferring the bounty amount to payoutAddress; this receipt is the signed settlement record.",
  };
  res.json({ receipt, signature: sign(receipt) });
});

app.listen(PORT, () => {
  console.log(`\nx402-github-bounty listening on http://localhost:${PORT}`);
  console.log("Payment rails (USDC — the client picks):");
  for (const r of activeRails()) {
    console.log(`  ${r.rail.padEnd(7)} ${r.network.padEnd(14)} \u2192 ${r.payTo}  via ${r.facilitator}`);
  }
  if (usingSuiteDefaultPayTo()) {
    console.log(
      "  note: using suite default payTo — set PAY_TO_ADDRESS / SOLANA_PAY_TO_ADDRESS to receive funds yourself",
    );
  }
  console.log(
    `GitHub API: ${process.env.GITHUB_TOKEN ? "authenticated (5,000 req/h)" : "unauthenticated (60 req/h — set GITHUB_TOKEN)"}`,
  );
  console.log("Routes:");
  for (const r of PRICE_TABLE) console.log(`  ${r.route.padEnd(26)} ${r.price}`);
  console.log("Free discovery: GET /  /health  /skill.md  /.well-known/x402  /openapi.json\n");
});
