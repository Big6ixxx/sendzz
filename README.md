# Sendzz

A cross-border payment platform. Send USDC to anyone by email address, deposit and withdraw local
currency through African bank accounts and mobile money, and move USDC between networks — all
gasless, across seven EVM chains plus Solana and Stellar.

---

## Live Deployments

Sendzz is live on both **Mainnet** and **Testnet**:

- **Mainnet:** Live across EVM chains and Stellar for cross-chain USDC transfers and fiat rails.
- **Testnet:** Live on Arc Testnet — check out the testnet version at **[arc.sendzz.io](https://arc.sendzz.io)**.

---

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Architecture Overview](#architecture-overview)
- [Database Schema](#database-schema)
- [API Routes](#api-routes)
- [Pages \& Routes](#pages--routes)
- [Email Templates](#email-templates)
- [Environment Variables](#environment-variables)
- [Local Development Setup](#local-development-setup)
- [Webhook Configuration](#webhook-configuration)
  - [Alchemy Address Activity](#alchemy-address-activity)
- [Admin Access](#admin-access)
- [Testing](#testing)

---

## Features

### Gasless USDC Transfers

Send USDC to any email address with no gas fee. Transfers execute through Circle ERC-4337 smart
accounts under a sponsored paymaster policy. A recipient who has never used Sendzz still gets
paid: a wallet is created for them, the USDC is held in escrow, and they receive a claim link.
Unclaimed transfers can be reclaimed by the sender.

### Fiat On-Ramp (Deposit)

Convert local currency into USDC from a bank account or mobile money wallet. Two providers sit
behind one interface — **Paycrest** and **Bitnob** — and the app picks whichever can serve the
corridor, so neither is a single point of failure.

Corridors: **NGN**, **KES**, **GHS**, **UGX**, **RWF**, **XOF** (Côte d'Ivoire, Senegal),
**XAF** (Cameroon), **GMD**, and **USD** via wire/ACH.

### Fiat Off-Ramp (Withdrawal)

Convert USDC back to local currency. The user enters an amount, previews the rate and what lands
in their account, verifies the destination, and confirms with their transaction PIN.

Withdrawal pricing is per corridor: `WITHDRAWAL_FEE_PERCENT_<CURRENCY>` where a corridor costs
more to serve, otherwise the global `WITHDRAWAL_FEE_PERCENT`. Where a provider deducts a flat
fee of its own, `CORRIDOR_FEE_<CURRENCY>` covers it out of the withdrawal rather than our float.
Deposits are free.

The destination is sealed at authorisation time, so the account the user approved is the account
that gets paid. Status comes from the provider webhook, with a reconcile cron as the backstop for
payouts that were initiated but never confirmed.

### Cross-Chain USDC Bridge

Move USDC between any two supported networks using Circle's Cross-Chain Transfer Protocol V2.
Not a custodial bridge: the protocol burns on the source chain, Circle's Iris attestation service
signs it, and the mint happens on the destination.

Networks: **Ethereum**, **Arbitrum**, **Base**, **Polygon**, **Optimism**, **Avalanche**, **Arc**,
plus **Solana** and **Stellar**.

A bridge takes two confirmations, and the confirmation dialog says so before the first one rather
than surprising the user with the second. If the page is closed mid-flight nothing is lost — the
burn and its attestation stay valid, and the transfer can be finished later from Pending Claims.

### Transaction PIN

Every outgoing transaction is approved with a four-digit PIN, entered in a Sendzz confirmation
sheet rather than a wallet pop-up. The sheet states the amount, the destination and what cannot
be undone, and for multi-step flows it says how many confirmations are coming before the first
one is signed.

Approving mints a single-use token bound to that exact operation — amount, destination, chain —
which the server requires and spends atomically. A token for one payment cannot authorise
another.

### Second Factor on Large Transactions

Above a user-set threshold, the PIN is followed by a second factor: **email OTP**, an
**authenticator app** (TOTP), or a **passkey** (WebAuthn). The PIN is deliberately not offered
as the second factor — it is already required for every transaction, so accepting it twice would
be one secret satisfying two checks.

The same step-up guards security settings themselves, so turning the protection off is harder
than using it.

### Referrals

Referrers earn a share of withdrawal volume, priced by tier and accrued to a ledger rather than
paid per transaction — a commission is usually cents, and paying each one separately would cost
more in gas than it is worth. A cron sweeps balances above a floor to the referrer's own wallet.

Two tracks, mutually exclusive: the standard programme, and a **Merchant** track that businesses
apply for and an admin reviews.

### Identity Verification

KYC through Didit, required past configured limits on the fiat rails. Sendzz does not store
government-issued IDs.

### Batch Transfers

Send USDC to multiple recipients in a single ERC-4337 UserOperation, reducing overhead and keeping the experience gasless.

### Transaction History

Full activity feed showing all transfers (sent and received), deposits, withdrawals, and bridge transactions with real-time status.

### Admin Dashboard

A protected admin area with:

- Platform-wide stats (total volume, user count, pending actions, 24 h active users)
- Interactive analytics charts (7 d / 30 d / all-time)
- Transaction management across all types
- User management with per-user volume breakdown
- Merchant application review queue
- Refunds owed and outstanding
- Webhook event and audit log viewer

### Notifications

Transactional email via Resend — login codes, incoming transfers with claim links, deposit and
withdrawal receipts, bridge completions, referral earnings, security alerts and PIN resets. Web
push is available for the same events, and both are configurable per category in settings.

### Dark / Light Mode

System-aware theme with manual toggle, powered by `next-themes`.

---

## Tech Stack

| Layer                | Technology                                                   |
| -------------------- | ------------------------------------------------------------ |
| Framework            | Next.js 16 (App Router), React 19                            |
| Language             | TypeScript 5                                                 |
| Styling              | Tailwind CSS v4, Radix UI primitives, Framer Motion          |
| Auth                 | Privy (email OTP, embedded wallets)                          |
| Transaction security | scrypt PIN + pepper, WebAuthn passkeys, TOTP, email OTP      |
| Database             | Supabase — PostgreSQL, Row Level Security, stored procedures |
| Blockchain           | Viem, Circle Modular Wallets Core (ERC-4337 smart accounts)  |
| Non-EVM              | Solana Kit + SPL Token, Stellar (Circle TEE wallets)         |
| Bridge               | Circle CCTP V2 via Iris attestation API                      |
| Payouts              | Circle developer-controlled wallets (referral sweeps)        |
| RPC                  | Alchemy (EVM), with public-RPC fallback                      |
| Fiat Rails           | Paycrest and Bitnob — both on-ramp and off-ramp              |
| KYC                  | Didit                                                        |
| Email                | Resend                                                       |
| Push                 | Web Push (VAPID)                                             |
| State                | TanStack Query v5                                            |
| Charts               | Recharts                                                     |
| Validation           | Zod, React Hook Form                                         |
| Webhook Verification | HMAC-SHA256 (crypto)                                         |
| Package Manager      | pnpm                                                         |
| Testing              | Vitest (unit), Playwright (e2e)                              |
| CI                   | GitHub Actions — typecheck, lint, tests, dependency audit    |

---

## Architecture Overview

```text
Browser (Next.js App Router)
│
├── Privy embedded wallet ─────────────► 7 EVM chains + Solana + Stellar
│     Circle ERC-4337 smart account          │
│     sponsored paymaster (gasless)         USDC
│     Privy wallet pop-ups are OFF —         │
│     confirmation happens in our own sheet  │
│                                            │
├── PIN confirmation ──► /api/2fa/pin ──► single-use token bound to
│     amount + destination + chain, spent atomically server side
│                                            │
├── Server Actions ('use server')            │
│     every export is a POST endpoint, so identity comes from the
│     session and never from an argument
│                                            │
├── API routes (Node runtime)                │
│     ├── /api/transfer/*   send, claim, accept, reclaim
│     ├── /api/bridge/*     CCTP burn → attestation → mint
│     ├── /api/stellar/*    provision, trustline, send, bridge
│     ├── /api/webhook/*    Paycrest · Bitnob · Alchemy · Didit
│     └── /api/cron/*       reconcile · referral payouts · roster
│                                            │
└── Supabase (service role only)             │
      ├── RLS on every table, and no grants for anon/authenticated
      ├── append-only triggers on accounts and financial history
      ├── finalize_withdrawal_* / claim_transfer atomic RPCs
      └── consume_rate_limit — one statement, so concurrent
          requests cannot all pass the same check
                                             │
Fiat rails ──► Paycrest or Bitnob ◄──────────┘
                 whichever serves the corridor
```

### Withdrawal Status Flow

A withdrawal reaches its terminal state through whichever of these gets there first. They are
deliberately redundant: a payout that has left the building but is recorded as pending is the
failure that costs the most to unpick.

1. **Provider webhook** — `/api/webhook/paycrest` or `/api/webhook/bitnob`, both signature
   verified. The handler calls `finalize_withdrawal_success` or `finalize_withdrawal_failed`,
   which are Postgres functions rather than application code so the status change and its
   bookkeeping cannot half-apply.
2. **Client polling** — while the tab is open, as a fast path rather than a safety net.
3. **Reconcile cron** — `/api/cron/reconcile-transactions`. Finds deferred payouts that were
   initiated but never confirmed, and settles or reverses them. This is what covers a webhook
   that never arrives and a user who closed the tab.

Sends are recorded before they settle and reconciled afterwards, so a crash mid-flight leaves a
row that is visible and fixable rather than money with no record.

---

## Database Schema

Everything lives in the `public` schema. RLS is enabled on all of it, and since migration 061
the `anon` and `authenticated` roles hold no grants there at all — Sendzz reaches Postgres only
as the service role, server side, so RLS is a second line rather than the only one.

| Table                        | Description                                                     |
| ---------------------------- | --------------------------------------------------------------- |
| `users`                      | Account registry keyed by email, one row per person             |
| `user_profiles`              | PIN hash, TOTP secret, passkeys, notification and 2FA settings  |
| `user_sessions`              | Signed-in devices, for the session list in settings             |
| `balances`                   | Per-user available and locked balance                           |
| `deposits`                   | On-ramp records, both providers                                 |
| `withdrawals`                | Off-ramp records, including the sealed payout destination       |
| `transfers`                  | Peer-to-peer sends; supports an unclaimed escrow state          |
| `pending_sends`              | Sends recorded before settlement, reconciled afterwards         |
| `bridge_transactions`        | CCTP burns and their mints                                      |
| `consolidation_claims`       | Funds gathered onto one chain before a send                     |
| `deposit_sync_state`         | Per-user, per-chain scan cursor for the deposit scanner         |
| `transaction_authorizations` | Single-use PIN tokens, bound to one operation                   |
| `transaction_otps`           | Second-factor codes for large transactions                      |
| `auth_otp` / `otp_logs`      | Login codes and their delivery record                           |
| `webauthn_challenges`        | Passkey registration and authentication challenges              |
| `rate_limits`                | Fixed-window counters, held in Postgres so they survive restarts|
| `kyc_verifications`          | Didit verification state                                        |
| `referral_earnings`          | Accrued commission, one row per qualifying withdrawal           |
| `referral_payouts`           | Sweeps of accrued earnings to a referrer's wallet               |
| `referral_benefits`          | Fee waivers and credits on the referee side                     |
| `merchant_applications`      | Merchant track applications and their review state              |
| `contacts` / `bank_contacts` | Address book, and saved payout destinations                     |
| `notifications`              | In-app notification feed                                        |
| `push_subscriptions`         | Web push endpoints per device                                   |
| `webhook_events`             | Idempotency log for every inbound webhook                       |
| `audit_logs`                 | Append-only record of sensitive state changes                   |
| `ops_alert_log`              | Operational alerts already sent, so they are not repeated       |
| `platform_admins`            | Admin allowlist                                                 |

Accounts and financial history are append-only, enforced by triggers rather than by convention
(migration 043). Deleting a user, a transfer, a deposit or a withdrawal raises — including for
the service role, because the thing most likely to erase history is our own code. A genuine
erasure means dropping those triggers deliberately, which is the friction that was missing.

Migrations live in `supabase/migrations/` and are applied in filename order. The chain builds a
working database from empty — that is checked, not assumed.

---

## API Routes

Grouped rather than listed one by one: the list of routes goes stale faster than the shape does,
and the previous version of this section listed six of them.

| Group                  | What lives there                                                     |
| ---------------------- | -------------------------------------------------------------------- |
| `/api/transfer/*`      | send preview, recipient lookup, claim, accept, reclaim               |
| `/api/bridge/*`        | CCTP status, record, complete, consolidation, Solana claim + sponsor |
| `/api/stellar/*`       | provision, trustline, balance, send, bridge, claim                   |
| `/api/solana/sponsor`  | fee-payer sponsorship for Solana sends                               |
| `/api/2fa/*`           | PIN, email OTP, TOTP, passkeys, step-up for security changes         |
| `/api/session/*`       | signed-in devices and presence                                       |
| `/api/user/preferences`| the signed-in user's own security settings                           |
| `/api/kyc/*`           | Didit session start and status                                       |
| `/api/referrals/*`     | referral dashboard data and merchant applications                    |
| `/api/notifications/*` | feed, push subscription, email and security preferences              |
| `/api/wallets/*`       | pre-generating a wallet for a recipient who has not signed up        |
| `/api/webhook/*`       | Paycrest, Bitnob, Alchemy, Didit — all signature verified            |
| `/api/cron/*`          | reconcile transactions, referral payouts, Dune roster sync           |

**Every route decides whether the caller may proceed**, and a test enforces it
(`lib/security/server-action-identity.test.ts`). It walks `app/api` and fails on any route with
no session check, admin check, cron secret or webhook signature. A route that is genuinely public
has to be listed with a written reason; the list is currently empty.

The same test guards `'use server'` modules, where every export is a POST endpoint anyone can
invoke once they know the action id. Identity comes from the session, never from an argument.

## Pages & Routes

| Path                            | Description                                     |
| ------------------------------- | ----------------------------------------------- |
| `/`                             | Marketing landing page                          |
| `/features`, `/security`, `/privacy` | Public information pages                   |
| `/explore`                      | Public transaction feed                         |
| `/claim`                        | Claim a transfer sent to your email             |
| `/tx/[orderId]`                 | Individual transaction status                   |
| `/dashboard`                    | Wallet overview                                 |
| `/dashboard/transfer`           | Send USDC, by email or wallet address           |
| `/dashboard/bridge`             | Move USDC between networks                      |
| `/dashboard/history`            | Full activity feed                              |
| `/dashboard/activity/[id]`      | One transaction in detail                       |
| `/dashboard/referrals`          | Referral dashboard and earnings                 |
| `/dashboard/merchant`           | Merchant track application and status           |
| `/dashboard/notifications`      | Notification feed                               |
| `/dashboard/settings`           | Account, PIN and second-factor setup            |
| `/dashboard/settings/devices`   | Signed-in devices                               |
| `/dashboard/settings/fees`      | What a transaction costs, per corridor          |
| `/dashboard/settings/notifications` | Email and push preferences                  |
| `/admin`                        | Platform stats and analytics                    |
| `/admin/transactions`           | All transactions                                |
| `/admin/users`, `/admin/users/[userId]` | Users and per-user detail               |
| `/admin/merchants`              | Merchant application review queue               |
| `/admin/refunds`                | Refunds owed and outstanding                    |
| `/admin/logs`                   | Webhook events and audit trail                  |

## Email Templates

Sent through Resend from `lib/email/templates.ts`, all built on one base layout:

| Trigger                  | Template                                          |
| ------------------------ | ------------------------------------------------- |
| Login                    | OTP code                                          |
| Transfer received        | Amount, sender, and a claim link if unclaimed      |
| Transfer sent            | Confirmation to the sender                        |
| Deposit confirmed        | Receipt once the on-ramp settles                  |
| Withdrawal OTP           | Second factor on a large withdrawal               |
| Withdrawal completed     | Receipt with amount and destination               |
| Bridge completed         | Confirmation that funds landed on the destination |
| Referral earning         | A commission accrued                              |
| Transaction OTP          | Second factor on a large transaction              |
| Security code            | Step-up for changing a security setting           |
| Security alert           | Something changed on the account                  |
| PIN reset                | Reset link when a PIN is forgotten                |

Each category can be turned off individually in `/dashboard/settings/notifications`. Web push
carries the same events for anyone who has subscribed a device.

## Environment Variables

**`.env.example` is the reference.** It carries every variable with a note on each explaining
what breaks without it, which is not something worth maintaining in two places — the copy that
used to live here had drifted to about twenty, several under names the code no longer reads.

```bash
cp .env.example .env
```

What the groups are for:

| Group                                   | Needed for                                            |
| --------------------------------------- | ----------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_*`, `SUPABASE_SERVICE_ROLE_KEY` | Database. The service key is server-only |
| `NEXT_PUBLIC_PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `PRIVY_AUTHORIZATION_PRIVATE_KEY` | Auth and embedded wallets |
| `CIRCLE_API_KEY`, `CIRCLE_ENTITY_SECRET`, `CIRCLE_WALLET_SET_ID` | Smart accounts, and signing for payouts |
| `NEXT_PUBLIC_CIRCLE_CLIENT_KEY`, `NEXT_PUBLIC_CIRCLE_READ_URL`, `NEXT_PUBLIC_CIRCLE_SEND_URL` | Browser-side Circle SDK |
| `CIRCLE_SOLANA_FEEPAYER_WALLET_ID`, `CIRCLE_SOLANA_FEEPAYER_ADDRESS` | Gasless sends on Solana |
| `NEXT_PUBLIC_CIRCLE_GAS_POLICY_*`       | Gasless sends, per chain                              |
| `PAYCREST_*`, `BITNOB_*`                | The two fiat providers, including webhook secrets     |
| `WITHDRAWAL_FEE_PERCENT[_<CUR>]`, `TRANSFER_FEE_PERCENT`, `BRIDGE_FEE_PERCENT` | What we charge |
| `CORRIDOR_FEE_[<PROVIDER>_]<CUR>`       | What a provider deducts, covered out of the withdrawal|
| `FEE_TREASURY_<CHAIN>`                  | Where fees land. Unset fails closed, deliberately      |
| `REFERRAL_*`, `CIRCLE_PAYOUT_*`         | Referral rates, and the wallet payouts are sent from  |
| `PIN_PEPPER`, `TOTP_ENCRYPTION_KEY`, `WEBAUTHN_*` | Transaction PIN and second factors          |
| `VAPID_*`, `RESEND_API_KEY`             | Push and email                                        |
| `DIDIT_*`                               | KYC                                                   |
| `*_RPC_URL`, `NEXT_PUBLIC_ALCHEMY_API_KEY` | Chain access                                       |
| `ALCHEMY_WEBHOOK_ID_<CHAIN>`, `ALCHEMY_WEBHOOK_SECRET_<CHAIN>`, `ALCHEMY_NOTIFY_TOKEN` | Push deposit detection — see below |
| `STELLAR_*`, `NEXT_PUBLIC_STELLAR_*`    | The Stellar rail                                      |
| `PRIVY_KEY_QUORUM_ID`, `PRIVY_AUTHORIZATION_PRIVATE_KEY` | Signing on the Stellar rail            |
| `CRON_SECRET`                           | Gates `/api/cron/*`. Unset means those routes refuse  |
| `DUNE_API_KEY`                          | The Dune roster sync cron                             |
| `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SUPPORT_TELEGRAM_URL` | Links in emails and the UI           |
| `NEXT_PUBLIC_SIMULATION_MODE`           | `false` for mainnet; anything else uses testnet       |
| `ADMIN_EMAILS`                          | Admin fallback if `platform_admins` is unreachable    |

Two worth knowing about before your first withdrawal:

- **`WITHDRAWAL_FEE_PERCENT` has no compiled-in default.** A payout whose fee cannot be
  determined throws rather than settling for free. The same is true of `FEE_TREASURY_<CHAIN>`:
  an unconfigured chain refuses the withdrawal instead of giving the service away.
- **Fee rates are read per request, not at module load**, so changing one takes effect on the
  next request rather than the next deploy.

## Local Development Setup

### Prerequisites

- Node.js 22+
- pnpm (`npm install -g pnpm`)
- A Supabase project
- A Privy application
- A Circle developer account (Modular Wallets)
- A Paycrest sender account, a Bitnob account, or both

### Steps

1. **Clone the repository**

   ```bash
   git clone https://github.com/Big6ixxx/sendzz.git
   cd sendzz
   ```

2. **Install dependencies**

   ```bash
   pnpm install
   ```

3. **Configure environment variables**

   Copy the template and fill in each value:

   ```bash
   cp .env.example .env
   ```

4. **Apply Supabase migrations**

   Using the Supabase CLI:

   ```bash
   npx supabase link --project-ref sendzz
   npx supabase db push
   ```

   Or paste the SQL files into the Supabase SQL editor in filename order. Note that the editor
   returns only the **last** statement's result, so a file with several queries will appear to
   have run only its tail.

5. **Start the development server**

   ```bash
   pnpm dev
   ```

   The app will be available at `http://localhost:3000`.

---

## Webhook Configuration

Four inbound webhooks, each configured in its provider's dashboard and each signature verified
before anything is read from the body.

| Endpoint                | Provider | Secret                  | Tells us                        |
| ----------------------- | -------- | ----------------------- | ------------------------------- |
| `/api/webhook/paycrest` | Paycrest | `PAYCREST_API_SECRET`   | On/off-ramp order reached a terminal state |
| `/api/webhook/bitnob`   | Bitnob   | `BITNOB_WEBHOOK_SECRET` | Same, for Bitnob corridors      |
| `/api/webhook/alchemy`  | Alchemy  | `ALCHEMY_WEBHOOK_SECRET_<CHAIN>` | USDC arrived at a watched address |
| `/api/webhook/didit`    | Didit    | `DIDIT_WEBHOOK_SECRET`  | KYC verification finished       |

Point each at `https://<your-domain>/api/webhook/<provider>`. Alchemy is configured per chain —
one webhook, one id and one secret for each of Base, Polygon, Arbitrum, Optimism, Avalanche and
Arc — because a signing key is issued per webhook, not per account.

Signature verification is not optional and not advisory: an unsigned or wrongly signed request
is rejected before its body is parsed. A deposit webhook that could be forged is a way to credit
an account with money nobody sent.

Deliveries are recorded in `webhook_events`, unique on `event_id`, so a provider that retries —
and they all do — cannot apply the same event twice. The Alchemy webhook additionally relies on
the unique `(user_id, tx_hash)` index on `deposits`, which makes a repeat delivery a no-op
however many times it arrives.

### Alchemy Address Activity

The other three providers are one endpoint and one secret. Alchemy is per chain, and needs three
variables rather than one.

| Variable                         | What it is                                                    |
| -------------------------------- | ------------------------------------------------------------- |
| `ALCHEMY_WEBHOOK_ID_<CHAIN>`     | The webhook's own id, from the dashboard                      |
| `ALCHEMY_WEBHOOK_SECRET_<CHAIN>` | Its signing key — issued per webhook, so one per chain        |
| `ALCHEMY_NOTIFY_TOKEN`           | Notify API auth token, account-wide. Adds addresses to watch  |

`<CHAIN>` is one of `BASE`, `POLYGON`, `ARBITRUM`, `OPTIMISM`, `AVALANCHE`, `ARC` — the chains in
`DEPOSIT_CHAINS`. Ethereum is deliberately not among them.

**Setup, per chain:**

1. Alchemy dashboard → Webhooks → create an **Address Activity** webhook on that network,
   pointing at `https://<your-domain>/api/webhook/alchemy`.
2. Copy its **webhook id** into `ALCHEMY_WEBHOOK_ID_<CHAIN>` and its **signing key** into
   `ALCHEMY_WEBHOOK_SECRET_<CHAIN>`.
3. Set `ALCHEMY_NOTIFY_TOKEN` once, from Alchemy's Notify API settings.

The id does double duty: it is how an inbound delivery is matched back to a chain (the payload
does not name one), and it is what `lib/web3/alchemy-registry.ts` PATCHes when a new wallet is
created, so the address starts being watched.

**All of it is optional, and the failure modes differ:**

- **No `ALCHEMY_NOTIFY_TOKEN`, or no ids configured** — addresses are never registered, so no
  deposit webhook ever fires. Nothing is lost: the deposit scanner cron still finds them on its
  next sweep. It logs a warning saying so, once per attempt.
- **An id set but the matching secret missing** — the route returns `500` and refuses to process
  that chain. That is deliberate. An unverified path into the deposit ledger would let anyone
  credit themselves any amount, so a half-configured chain fails closed rather than open.

Registration is best-effort and off the caller's failure path: a wallet that cannot be registered
with Alchemy is still a working wallet, whereas a sign-up that fails because a webhook API was
briefly down is not. The periodic sync re-registers anything that missed.

---

## Admin Access

Admin access is controlled by the `platform_admins` table in Supabase. To grant access:

```sql
insert into public.platform_admins (email) values ('your@email.com');
```

As a disaster-recovery fallback, the `ADMIN_EMAILS` environment variable accepts a comma-separated list of admin emails that bypasses the database check if the table query fails.

Admin users see a protected `/admin` section in the sidebar after signing in with a listed
address. Beyond the dashboards it is where merchant applications are reviewed and refunds owed
are worked through, so the allowlist is worth keeping short.

Email comparison is case-insensitive, and since migration 063 one address can only have one
account — a `lower(email)` unique index, because normalising in application code is a convention
and a convention holds only as long as every future write path remembers it.

---

## Testing

```bash
pnpm test           # Vitest unit suite
pnpm test:e2e       # Playwright
pnpm lint           # ESLint
pnpm audit:check    # fails only on NEW dependency advisories
npx tsc --noEmit    # type check
```

`pnpm audit:check` compares a fresh `pnpm audit` against `audit-baseline.json` rather than
failing on the whole backlog. Most of the known advisories arrive through transitive React Native
and Solana tooling that this app never executes; a gate that fails every run gets ignored, and
then the one that matters arrives inside noise nobody reads. `pnpm audit:update` is the
deliberate act of accepting a new one.

CI runs all of the above on every push — `.github/workflows/ci.yml`.

Two tests are worth knowing about because they enforce rules rather than behaviour:

- `lib/security/server-action-identity.test.ts` fails the build if any API route has no gate, or
  if a `'use server'` export takes a caller-supplied identity instead of reading the session.
- `lib/web3/chain-coverage.test.ts` talks to live RPC endpoints and can time out under load. It
  passes in isolation; a single failure there is usually the network, not the code.
