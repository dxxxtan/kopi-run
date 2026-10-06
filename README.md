# ☕ Kopi Run

Grab for the office pantry, made for a group of ten. Someone heading down opens a run, everyone adds their order before it closes, and the runner fills in prices and ticks off who has paid.

| Brief | Kopi Run |
|---|---|
| **The ten** | Ten colleagues on one floor who buy coffee together |
| **Main record** | An **order** ("kopi siew dai"), placed on a run (one trip down) |
| **Shared action** | Join an open run by adding your order |
| **The rule** | All ten see everything. You can change only your own order, and only while the run is open. Only the runner closes the run, sets prices and marks people as paid. |

The database enforces the rule, not just the UI. Row-level security and two guard triggers in [`supabase/schema.sql`](supabase/schema.sql) handle it, so someone poking the API directly still can't mark their own order as paid.

## Stack

Static Vite + TypeScript (no framework) on GitHub Pages, with [Supabase](https://supabase.com) for email login and the database. Changes appear on everyone's screen through Supabase Realtime.

```
src/db.ts      Supabase client, types, loading
src/runs.ts    pure rules: is a run open, who owes whom, price parsing
src/main.ts    state, rendering, events
supabase/schema.sql   tables, row-level security, triggers, realtime
```

## Setup (one time, about 10 minutes)

1. **Create a Supabase project** (free tier) at supabase.com. Its URL is `https://<id>.supabase.co`. The app also accepts the `…/rest/v1/` form the dashboard shows.
2. **SQL Editor:** paste in all of `supabase/schema.sql` and run it. Then add the ten people:
   ```sql
   insert into members (email, name) values
     ('you@company.com', 'You'),
     ('colleague@company.com', 'Colleague');
   ```
   Anyone not in `members` can sign in but sees nothing.
3. **Authentication → URL Configuration:** set the Site URL to `https://<your-github-user>.github.io/kopi-run/`, and add `http://localhost:5173/` under Redirect URLs.
4. **Authentication → Email Templates → Magic Link:** add `Your code: {{ .Token }}` to the template. Corporate email scanners sometimes "click" sign-in links before you do, which uses them up. The 6-digit code always works.
5. **Local dev:** copy `.env.example` to `.env`, fill in the values from Project Settings → API, then:
   ```bash
   npm install
   npm run dev
   ```
6. **Deploy:** in GitHub, go to repo → Settings → Secrets and variables → Actions and add repository secrets `SUPABASE_URL` and `SUPABASE_ANON_KEY`. Then, under Settings → Pages, set Source to **GitHub Actions**. Every push to `main` deploys.

The anon key is meant to be public. Row-level security protects the data.

## Limits to know

- Supabase's built-in email sender is rate-limited (a few emails an hour on the free tier). That's fine for ten people who stay signed in. If you hit the limit, plug in a custom SMTP server under Authentication → SMTP.
- The app shows runs from the last 7 days. Debts from older runs drop off the screen.

## Ideas for later

- Runner leaderboard: who has done the most runs, so the freeloaders get nudged.
- PayNow QR for the runner, shown next to "you owe".
