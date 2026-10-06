-- Kopi Run schema. Paste into Supabase → SQL Editor → Run.
-- Safe to re-run: drops and recreates policies, triggers and functions.

-- ── Tables ────────────────────────────────────────────────────────────────

-- The ten. Only emails listed here can see or change anything.
create table if not exists members (
  email text primary key,
  name  text not null
);

-- A trip to the coffee shop. A thin container: the real record is the order.
create table if not exists runs (
  id           bigint generated always as identity primary key,
  runner_email text not null default (auth.jwt() ->> 'email'),
  place        text not null check (length(place) between 1 and 60),
  closes_at    timestamptz not null,
  status       text not null default 'open' check (status in ('open', 'closed', 'delivered')),
  created_at   timestamptz not null default now()
);

-- One person's order on a run. Price is filled in by the runner at the counter.
create table if not exists orders (
  id          bigint generated always as identity primary key,
  run_id      bigint not null references runs (id) on delete cascade,
  user_email  text not null default (auth.jwt() ->> 'email'),
  item        text not null check (length(item) between 1 and 120),
  price_cents integer check (price_cents is null or price_cents between 0 and 100000),
  paid        boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists orders_run_id on orders (run_id);

-- ── Helpers ───────────────────────────────────────────────────────────────

create or replace function me() returns text
language sql stable as $$ select auth.jwt() ->> 'email' $$;

create or replace function is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where email = auth.jwt() ->> 'email')
$$;

-- A run accepts orders while it is open and before its closing time.
create or replace function run_is_open(rid bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from runs where id = rid and status = 'open' and closes_at > now())
$$;

create or replace function is_runner(rid bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from runs where id = rid and runner_email = auth.jwt() ->> 'email')
$$;

-- ── Row-level security: the one rule ──────────────────────────────────────
-- Everyone in the ten sees everything.
-- You change only your own order, and only while the run is open.
-- Only the runner closes the run, sets prices and marks people paid.

alter table members enable row level security;
alter table runs    enable row level security;
alter table orders  enable row level security;

drop policy if exists "members read" on members;
create policy "members read" on members for select using (is_member());

drop policy if exists "runs read"   on runs;
drop policy if exists "runs open"   on runs;
drop policy if exists "runs update" on runs;
create policy "runs read"   on runs for select using (is_member());
create policy "runs open"   on runs for insert with check (is_member() and runner_email = me() and status = 'open');
create policy "runs update" on runs for update using (runner_email = me()) with check (runner_email = me());

drop policy if exists "orders read"   on orders;
drop policy if exists "orders add"    on orders;
drop policy if exists "orders update" on orders;
drop policy if exists "orders delete" on orders;
create policy "orders read" on orders for select using (is_member());
create policy "orders add"  on orders for insert
  with check (is_member() and user_email = me() and run_is_open(run_id) and price_cents is null and not paid);
create policy "orders update" on orders for update
  using ((user_email = me() and run_is_open(run_id)) or is_runner(run_id));
create policy "orders delete" on orders for delete
  using (user_email = me() and run_is_open(run_id));

-- RLS works on rows, not columns, so a trigger splits who may change what:
-- the orderer changes the item, the runner changes price and paid.
create or replace function guard_order_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.run_id <> old.run_id or new.user_email <> old.user_email then
    raise exception 'An order cannot move to another run or person';
  end if;
  if new.item <> old.item and not (old.user_email = me() and run_is_open(old.run_id)) then
    raise exception 'Only the person who ordered can change the item, while the run is open';
  end if;
  if (new.price_cents is distinct from old.price_cents or new.paid <> old.paid)
     and not is_runner(old.run_id) then
    raise exception 'Only the runner can set prices and mark orders paid';
  end if;
  return new;
end $$;

drop trigger if exists guard_order_update on orders;
create trigger guard_order_update before update on orders
  for each row execute function guard_order_update();

-- The runner can't hand the run to someone else or rewrite its history.
create or replace function guard_run_update() returns trigger
language plpgsql as $$
begin
  if new.runner_email <> old.runner_email or new.created_at <> old.created_at then
    raise exception 'A run cannot change hands';
  end if;
  return new;
end $$;

drop trigger if exists guard_run_update on runs;
create trigger guard_run_update before update on runs
  for each row execute function guard_run_update();

-- ── Realtime: push changes to everyone's screen ───────────────────────────

do $$ begin
  alter publication supabase_realtime add table runs, orders;
exception when duplicate_object then null;
end $$;

-- ── The ten (edit these, then re-run just this block) ─────────────────────
-- insert into members (email, name) values
--   ('you@example.com', 'You'),
--   ('colleague@example.com', 'Colleague')
-- on conflict (email) do update set name = excluded.name;
