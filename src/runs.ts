// Pure logic: no DOM, no fetch. The product rules that the UI reads.
import type { Order, Run } from "./db.ts";

/** Orders are accepted while the run is open and before its closing time. */
export function acceptingOrders(run: Run, now = Date.now()): boolean {
  return run.status === "open" && Date.parse(run.closes_at) > now;
}

export function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** "1.8", "$1.80", "180c" → 180. Returns null for blank, undefined for nonsense. */
export function parsePrice(text: string): number | null | undefined {
  const t = text.trim().replace(/^\$/, "");
  if (!t) return null;
  if (/^\d+c$/i.test(t)) return Number(t.slice(0, -1));
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return undefined;
  return Math.round(Number(t) * 100);
}

export interface Debt {
  from: string;
  to: string;
  cents: number;
  /** Orders still without a price, so the total may grow. */
  unpriced: number;
}

/**
 * Who owes whom, across all loaded runs: every unpaid order is owed by its
 * orderer to that run's runner. The runner's own orders don't count.
 */
export function debts(runs: Run[], orders: Order[]): Debt[] {
  const runner = new Map(runs.map((r) => [r.id, r.runner_email]));
  const byPair = new Map<string, Debt>();
  for (const o of orders) {
    const to = runner.get(o.run_id);
    if (!to || to === o.user_email || o.paid) continue;
    const k = `${o.user_email}→${to}`;
    const d = byPair.get(k) ?? { from: o.user_email, to, cents: 0, unpriced: 0 };
    if (o.price_cents == null) d.unpriced++;
    else d.cents += o.price_cents;
    byPair.set(k, d);
  }
  return [...byPair.values()];
}

/** "closes in 4 min", "closes in 40 s", "closed". */
export function countdown(closesAt: string, now = Date.now()): string {
  const s = Math.round((Date.parse(closesAt) - now) / 1000);
  if (s <= 0) return "orders closed";
  if (s < 60) return `closes in ${s} s`;
  return `closes in ${Math.ceil(s / 60)} min`;
}
