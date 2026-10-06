import { createClient } from "@supabase/supabase-js";

export interface Member {
  email: string;
  name: string;
}

export interface Run {
  id: number;
  runner_email: string;
  place: string;
  closes_at: string;
  status: "open" | "closed" | "delivered";
  created_at: string;
}

export interface Order {
  id: number;
  run_id: number;
  user_email: string;
  item: string;
  price_cents: number | null;
  paid: boolean;
  created_at: string;
}

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const configured = Boolean(url && key);

// Placeholder values keep createClient from throwing; main.ts shows a setup
// message instead of calling it when `configured` is false.
export const db = createClient(url ?? "http://localhost", key ?? "missing");

const HISTORY_DAYS = 7;

export async function loadAll(): Promise<{ members: Member[]; runs: Run[]; orders: Order[] }> {
  const since = new Date(Date.now() - HISTORY_DAYS * 864e5).toISOString();
  const [members, runs] = await Promise.all([
    db.from("members").select("*").order("name"),
    db.from("runs").select("*").gte("created_at", since).order("created_at", { ascending: false }).limit(30),
  ]);
  if (members.error) throw members.error;
  if (runs.error) throw runs.error;
  const ids = runs.data.map((r) => r.id);
  const orders = ids.length
    ? await db.from("orders").select("*").in("run_id", ids).order("created_at")
    : { data: [], error: null };
  if (orders.error) throw orders.error;
  return { members: members.data, runs: runs.data, orders: orders.data };
}

/** Throws the Supabase error, whose message comes from RLS or the guard triggers. */
export function check<T extends { error: { message: string } | null }>(res: T): T {
  if (res.error) throw new Error(res.error.message);
  return res;
}
