import "./style.css";
import type { Session } from "@supabase/supabase-js";
import { check, configured, db, loadAll, type Member, type Order, type Run } from "./db.ts";
import { acceptingOrders, countdown, debts, money, parsePrice } from "./runs.ts";

const app = document.querySelector<HTMLElement>("#app")!;

const state = {
  session: null as Session | null,
  /** Email a sign-in code was sent to; shows the code step. */
  pendingEmail: null as string | null,
  members: [] as Member[],
  runs: [] as Run[],
  orders: [] as Order[],
  status: "loading" as "loading" | "ready" | "failed",
  error: null as string | null,
};

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const me = () => state.session?.user.email ?? "";
const nameOf = (email: string) =>
  state.members.find((m) => m.email === email)?.name ?? email.split("@")[0]!;
const time = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-SG", { hour: "numeric", minute: "2-digit" });

// ── Rendering ───────────────────────────────────────────────────────────────

/** Price text a runner has typed but not yet saved, keyed by order id. */
const pendingPrices = new Map<number, string>();

function render() {
  // Realtime updates re-render everything; keep what someone is typing or has
  // picked (price inputs excluded: their value comes from pendingPrices below,
  // so a price the server has saved can replace a stale local one).
  const kept = new Map<string, string>();
  app.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input[data-keep]:not([data-price]), select[data-keep]")
    .forEach((el) => kept.set(el.dataset.keep!, el.value));
  const active = document.activeElement as HTMLElement | null;
  const focused = active?.dataset?.keep;
  const selection = active instanceof HTMLInputElement ? [active.selectionStart, active.selectionEnd] as const : null;

  app.innerHTML = view();

  app.querySelectorAll<HTMLElement>("[data-keep]").forEach((el) => {
    const v = kept.get(el.dataset.keep!);
    if (v !== undefined && (el instanceof HTMLInputElement || el instanceof HTMLSelectElement)) el.value = v;
    if (el.dataset.keep === focused) {
      el.focus();
      if (el instanceof HTMLInputElement && selection) el.setSelectionRange(selection[0], selection[1]);
    }
  });
}

function view(): string {
  if (!configured) {
    return card(`<h2>Almost there</h2>
      <p>Copy <code>.env.example</code> to <code>.env</code> and fill in your Supabase URL and anon key, then restart <code>npm run dev</code>.</p>`);
  }
  if (!state.session) return signInView();
  if (state.status === "failed") {
    return header() + errorBanner() + card(`<button data-action="retry">Retry</button>`);
  }
  if (state.status === "loading") return header() + card(`<p class="muted">Loading…</p>`);
  if (state.members.length === 0) {
    return header() + card(`<h2>You're not on the list</h2>
      <p><b>${esc(me())}</b> isn't one of the ten. Ask whoever set up Kopi Run to add you to the <code>members</code> table.</p>`);
  }
  return header() + errorBanner() + debtsView() + openRunForm() + runsView();
}

function header(): string {
  return `<header class="top">
    <h1>☕ Kopi Run</h1>
    ${state.session ? `<span class="who">${esc(nameOf(me()))} · <button class="link" data-action="sign-out">Sign out</button></span>` : ""}
  </header>`;
}

const card = (inner: string, cls = "") => `<section class="card ${cls}">${inner}</section>`;

function errorBanner(): string {
  return state.error
    ? `<div class="error" role="alert">${esc(state.error)} <button class="link" data-action="dismiss">Dismiss</button></div>`
    : "";
}

function signInView(): string {
  const body = state.pendingEmail
    ? `<h2>Check your inbox</h2>
       <p>We sent a sign-in email to <b>${esc(state.pendingEmail)}</b>. Click the link, or type the 6-digit code here.</p>
       <form data-form="verify" class="row">
         <input name="code" inputmode="numeric" autocomplete="one-time-code" placeholder="123456" maxlength="8" required>
         <button>Sign in</button>
       </form>
       <button class="link" data-action="restart">Use a different email</button>`
    : `<h2>Sign in</h2>
       <p>Coffee runs for the ten of us. Enter your work email and we'll send a sign-in link.</p>
       <form data-form="send" class="row">
         <input name="email" type="email" autocomplete="email" placeholder="you@company.com" required>
         <button>Send link</button>
       </form>`;
  return header() + errorBanner() + card(body);
}

function debtsView(): string {
  const all = debts(state.runs, state.orders);
  const owe = all.filter((d) => d.from === me());
  const owed = all.filter((d) => d.to === me());
  if (!owe.length && !owed.length) return "";
  const line = (d: { cents: number; unpriced: number }) => {
    const tbc = `${d.unpriced} order${d.unpriced === 1 ? "" : "s"} not priced yet`;
    if (!d.cents) return `<span class="muted">for ${tbc}</span>`;
    return `${money(d.cents)}${d.unpriced ? ` <span class="muted">+ ${tbc}</span>` : ""}`;
  };
  return card(`
    ${owe.map((d) => `<p>You owe <b>${esc(nameOf(d.to))}</b> ${line(d)}</p>`).join("")}
    ${owed.map((d) => `<p><b>${esc(nameOf(d.from))}</b> owes you ${line(d)}</p>`).join("")}
  `, "debts");
}

function openRunForm(): string {
  return card(`<h2>Going down?</h2>
    <form data-form="open-run" class="row">
      <input name="place" data-keep="place" placeholder="Where to? e.g. Kopitiam B1" maxlength="60" required>
      <select name="mins" data-keep="mins" aria-label="Taking orders for">
        ${[5, 10, 15, 20].map((m) => `<option value="${m}" ${m === 10 ? "selected" : ""}>${m} min</option>`).join("")}
      </select>
      <button>Open a run</button>
    </form>`);
}

function runsView(): string {
  if (!state.runs.length) return card(`<p class="muted">No runs this week. Be the hero: open one above.</p>`);
  return state.runs.map(runView).join("");
}

function runView(run: Run): string {
  const orders = state.orders.filter((o) => o.run_id === run.id);
  const mine = run.runner_email === me();
  const open = acceptingOrders(run);
  const total = orders.reduce((s, o) => s + (o.price_cents ?? 0), 0);

  const status =
    run.status === "delivered" ? `<span class="pill done">delivered</span>`
    : run.status === "closed" ? `<span class="pill">buying</span>`
    : open ? `<span class="pill live" data-countdown="${run.closes_at}">${countdown(run.closes_at)}</span>`
    : `<span class="pill">orders closed</span>`;

  const rows = orders.map((o) => {
    const own = o.user_email === me();
    const pending = pendingPrices.get(o.id);
    const priceValue = pending !== undefined ? pending : o.price_cents == null ? "" : (o.price_cents / 100).toFixed(2);
    const price = mine
      ? `<input class="price" data-keep="price-${o.id}" data-price="${o.id}" value="${esc(priceValue)}" placeholder="$" inputmode="decimal" aria-label="Price for ${esc(nameOf(o.user_email))}">`
      : `<span class="amt">${o.price_cents == null ? "—" : money(o.price_cents)}</span>`;
    const paid = o.user_email === run.runner_email
      ? `<span class="muted small">runner</span>`
      : mine
        ? `<label class="paid"><input type="checkbox" data-keep="paid-${o.id}" data-paid="${o.id}" ${o.paid ? "checked" : ""}> paid</label>`
        : o.paid ? `<span class="pill done">paid</span>` : `<span class="muted small">unpaid</span>`;
    return `<li class="${own ? "own" : ""}">
      <span class="who">${esc(nameOf(o.user_email))}</span>
      <span class="item">${esc(o.item)}</span>
      ${price}
      ${paid}
      ${own && open ? `<button class="link danger" data-keep="delete-${o.id}" data-action="delete-order" data-id="${o.id}" aria-label="Remove order">✕</button>` : ""}
    </li>`;
  }).join("");

  const add = open
    ? `<form data-form="order" data-run="${run.id}" class="row">
         <input name="item" data-keep="item-${run.id}" placeholder="Your order, e.g. kopi siew dai" maxlength="120" required>
         <button>Add</button>
       </form>`
    : "";

  const controls = !mine ? "" :
    run.status === "open" ? `<button data-keep="status-${run.id}" data-action="set-status" data-id="${run.id}" data-status="closed">Close orders &amp; go</button>`
    : run.status === "closed" ? `<button data-keep="status-${run.id}" data-action="set-status" data-id="${run.id}" data-status="delivered">Mark delivered</button>`
    : "";

  return card(`
    <div class="run-head">
      <div>
        <h3>${esc(run.place)}</h3>
        <p class="muted small">${mine ? "Your run" : `${esc(nameOf(run.runner_email))} is going`} · ${time(run.created_at)}</p>
      </div>
      ${status}
    </div>
    ${orders.length ? `<ul class="orders">${rows}</ul>` : `<p class="muted">No orders yet.</p>`}
    ${add}
    <div class="run-foot">${total ? `<span>Total ${money(total)}</span>` : ""}${controls}</div>
  `, run.status === "delivered" ? "past" : "");
}

// Countdown text updates in place, so typing isn't interrupted every second.
setInterval(() => {
  let expired = false;
  app.querySelectorAll<HTMLElement>("[data-countdown]").forEach((el) => {
    const text = countdown(el.dataset.countdown!);
    if (text === "orders closed") expired = true;
    el.textContent = text;
  });
  if (expired) render(); // drop the order form from runs that just closed
}, 1000);

// ── Data ────────────────────────────────────────────────────────────────────

async function refresh() {
  try {
    Object.assign(state, await loadAll(), { status: "ready" });
  } catch (e) {
    Object.assign(state, { status: "failed", error: (e as Error).message });
  }
  render();
}

let channel: ReturnType<typeof db.channel> | null = null;
function subscribe() {
  channel?.unsubscribe();
  channel = db
    .channel("kopi")
    .on("postgres_changes", { event: "*", schema: "public", table: "runs" }, refresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, refresh)
    .subscribe();
}

/** Runs a write; on failure shows the database's reason (RLS or a guard trigger). */
async function act(fn: () => PromiseLike<unknown>) {
  state.error = null;
  try {
    await fn();
  } catch (e) {
    state.error = (e as Error).message;
  }
  await refresh();
}

// ── Events ──────────────────────────────────────────────────────────────────

document.addEventListener("submit", async (e) => {
  const form = e.target as HTMLFormElement;
  e.preventDefault();
  const data = new FormData(form);
  const get = (k: string) => String(data.get(k) ?? "").trim();

  switch (form.dataset.form) {
    case "send": {
      const email = get("email").toLowerCase();
      const { error } = await db.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: location.origin + import.meta.env.BASE_URL },
      });
      if (error) state.error = error.message;
      else Object.assign(state, { pendingEmail: email, error: null });
      return render();
    }
    case "verify": {
      const { error } = await db.auth.verifyOtp({ email: state.pendingEmail!, token: get("code"), type: "email" });
      state.error = error ? error.message : null;
      return render();
    }
    case "open-run": {
      const closes = new Date(Date.now() + Number(get("mins")) * 60_000).toISOString();
      form.reset();
      return act(async () => check(await db.from("runs").insert({ place: get("place"), closes_at: closes })));
    }
    case "order": {
      const item = get("item");
      form.querySelector("input")!.value = "";
      return act(async () => check(await db.from("orders").insert({ run_id: Number(form.dataset.run), item })));
    }
  }
});

document.addEventListener("click", (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>("[data-action]");
  if (!el) return;
  const id = Number(el.dataset.id);
  switch (el.dataset.action) {
    case "sign-out":
      void db.auth.signOut();
      return;
    case "restart":
      Object.assign(state, { pendingEmail: null, error: null });
      return render();
    case "dismiss":
      state.error = null;
      return render();
    case "retry":
      Object.assign(state, { status: "loading", error: null });
      render();
      return void refresh();
    case "delete-order":
      return void act(async () => check(await db.from("orders").delete().eq("id", id)));
    case "set-status":
      return void act(async () => check(await db.from("runs").update({ status: el.dataset.status }).eq("id", id)));
  }
});

document.addEventListener("change", (e) => {
  const el = e.target as HTMLInputElement;
  if (el.dataset.paid) {
    const id = Number(el.dataset.paid);
    return void act(async () => check(await db.from("orders").update({ paid: el.checked }).eq("id", id)));
  }
});

// Track price edits as they're typed, so a re-render mid-typing (a colleague's
// action, a realtime event) doesn't need to wait for `change` to keep them.
document.addEventListener("input", (e) => {
  const el = e.target as HTMLInputElement;
  if (el.dataset.price) pendingPrices.set(Number(el.dataset.price), el.value);
});

// Save on blur rather than `change`: a re-render replaces the input with a
// fresh element whose value is set by the script, so the browser never sees
// it "change" relative to that baseline and `change` would never fire.
document.addEventListener("focusout", (e) => {
  const el = e.target as HTMLInputElement;
  const id = Number(el.dataset.price);
  if (!el.dataset.price || !pendingPrices.has(id)) return;
  void savePrice(id, el.value);
});

async function savePrice(id: number, text: string) {
  const cents = parsePrice(text);
  if (cents === undefined) {
    state.error = `"${text}" isn't a price. Try 1.80`;
    return render();
  }
  const order = state.orders.find((o) => o.id === id);
  if (order && order.price_cents === cents) {
    pendingPrices.delete(id);
    return;
  }
  await act(async () => check(await db.from("orders").update({ price_cents: cents }).eq("id", id)));
  pendingPrices.delete(id);
}

// ── Start ───────────────────────────────────────────────────────────────────

if (configured) {
  db.auth.onAuthStateChange((_event, session) => {
    const changed = session?.user.id !== state.session?.user.id;
    state.session = session;
    if (!changed) return;
    if (session) {
      Object.assign(state, { pendingEmail: null, status: "loading" });
      subscribe();
      void refresh();
    } else {
      channel?.unsubscribe();
      Object.assign(state, { members: [], runs: [], orders: [], status: "loading" });
    }
    render();
  });
}
render();
