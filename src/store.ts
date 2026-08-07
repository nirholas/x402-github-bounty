/**
 * File-based bounty ledger (JSON on disk — no database by design).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const FILE = path.join(DATA_DIR, "bounties.json");

export interface BountyRecord {
  bountyId: string;
  issueUrl: string;
  owner: string;
  repo: string;
  issueNumber: number;
  issueTitle: string;
  amount: string; // USD amount of the bounty, e.g. "25.00"
  terms: string;
  funder: string | null; // funder-supplied identity (wallet address or name)
  status: "open" | "settled" | "expired";
  createdAt: string;
  expiresAt: string;
  settleKeyHash: string; // sha256 of the settle key — key itself is never stored
  settledAt?: string;
  payoutAddress?: string;
  payoutPr?: number;
}

function load(): Record<string, BountyRecord> {
  if (!existsSync(FILE)) return {};
  try {
    return JSON.parse(readFileSync(FILE, "utf8"));
  } catch {
    return {};
  }
}

function save(all: Record<string, BountyRecord>): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(all, null, 2));
}

export function putBounty(rec: BountyRecord): void {
  const all = load();
  all[rec.bountyId] = rec;
  save(all);
}

export function getBounty(id: string): BountyRecord | null {
  const rec = load()[id] ?? null;
  if (rec && rec.status === "open" && new Date(rec.expiresAt).getTime() < Date.now()) {
    rec.status = "expired";
    putBounty(rec);
  }
  return rec;
}

export function listBounties(): BountyRecord[] {
  return Object.values(load()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
