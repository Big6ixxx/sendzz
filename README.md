# Sendzz

A cross-border payment platform built on Base. Send USDC to anyone via email, deposit fiat from African bank accounts, withdraw to any supported bank, and bridge USDC from other chains — all gasless.

---

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Architecture Overview](#architecture-overview)
- [Database Schema](#database-schema)
- [API Routes](#api-routes)
- [Pages & Routes](#pages--routes)
- [Email Templates](#email-templates)
- [Environment Variables](#environment-variables)
- [Local Development Setup](#local-development-setup)
- [Paycrest Webhook Configuration](#paycrest-webhook-configuration)
- [Admin Access](#admin-access)
- [Testing](#testing)

---

## Features

### Gasless USDC Transfers

Send USDC to any email address with zero gas fees. Transfers are executed via Circle's ERC-4337 smart accounts and a sponsored paymaster policy. If the recipient is not yet registered, the USDC is held in escrow and they receive a claim link by email.

### Fiat On-Ramp (Deposit)

Convert local fiat currency into USDC directly from a Nigerian, Kenyan, or Ghanaian bank account via Paycrest. Users provide their refund bank account, initiate the on-ramp order, and transfer fiat via normal bank transfer. The app polls Paycrest for confirmation and credits the wallet automatically.

Supported currencies: **NGN** (Nigerian Naira), **KES** (Kenyan Shilling), **GHS** (Ghanaian Cedi).

### Fiat Off-Ramp (Withdrawal)

Convert USDC back to fiat. Users enter an amount, preview the exchange rate and payout, verify a destination bank account, and confirm. The USDC is transferred gaslessly to Paycrest's receive address. Status is tracked via both the Paycrest webhook and a client-side polling fallback, ensuring the database always reflects the final state.

### Cross-Chain USDC Bridge

Bridge USDC from any supported EVM chain to Base using Circle's Cross-Chain Transfer Protocol V2 (CCTP V2). No custodial bridge — the protocol burns USDC on the source chain and Circle's Iris attestation service triggers a mint on Base.

Supported source chains: **Ethereum**, **Arbitrum**, **Polygon**, **Optimism**, **Avalanche**.

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
- Webhook event and audit log viewer

### Email Notifications

Transactional emails for OTP login, incoming transfer alerts with claim links, withdrawal completion receipts, and unclaimed transfer reminders — all sent via Resend.

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
| Database             | Supabase — PostgreSQL, Row Level Security, stored procedures |
| Blockchain           | Viem, Circle Modular Wallets Core (ERC-4337 smart accounts)  |
| Bridge               | Circle CCTP V2 via Iris attestation API                      |
| RPC                  | Alchemy                                                      |
| Fiat Rails           | Paycrest API (on-ramp + off-ramp)                            |
| Email                | Resend                                                       |
| State                | TanStack Query v5                                            |
| Charts               | Recharts                                                     |
| Validation           | Zod, React Hook Form                                         |
| Webhook Verification | standardwebhooks                                             |
| Package Manager      | pnpm                                                         |
| Testing              | Vitest (unit), Playwright (e2e)                              |

---

## Architecture Overview

```text
Browser (Next.js App Router)
│
├── Privy embedded wallet  ──────────────────────────► Base (L2)
│     ERC-4337 smart account                              │
│     Circle paymaster (gasless)                         USDC
│                                                         │
├── Server Actions ('use server')                         │
│     ├── ramp.ts          ◄──── Paycrest API ────────────┤
│     └── supabase/actions.ts ◄── Supabase (Postgres)    │
│                                                         │
├── API Routes (Node.js)                                  │
│     ├── /api/transfer/send     (atomic RPC + email)     │
│     ├── /api/bridge/status     (Iris attestation poll)  │
│     ├── /api/webhook/paycrest  (signed webhook handler) │
│     └── /api/batch-send        (multi-recipient)        │
│                                                         │
└── Supabase                                              │
      ├── Row Level Security on all tables                │
      ├── finalize_withdrawal_success / _failed RPCs      │
      ├── claim_transfer atomic RPC                       │
      └── audit_logs + webhook_events tables              │
                                                          │
Circle CCTP V2 ◄──────────── source chain ───────────────┘
(burn → Iris attestation → auto-mint on Base)
```

### Withdrawal Status Flow

The withdrawal status is updated by two complementary mechanisms to guarantee consistency:

1. **Paycrest Webhook** (`/api/webhook/paycrest`) — primary path. Paycrest POSTs a signed event when the off-ramp order reaches a terminal state. The handler calls the `finalize_withdrawal_success` or `finalize_withdrawal_failed` Supabase RPC.
2. **Client-Side Polling** — fallback. After the user's USDC transfer is confirmed, the frontend polls the Paycrest order status every 8 seconds and calls `updateWithdrawalStatus` directly if the webhook hasn't fired.

---

## Database Schema

Key tables (all in the `public` schema with RLS enabled):

| Table                 | Description                                                        |
| --------------------- | ------------------------------------------------------------------ |
| `users`               | Internal user registry keyed by email with `smart_account_address` |
| `balances`            | Per-user `available_balance` and `locked_balance` (USDC)           |
| `deposits`            | On-ramp records linked by `paycrest_tx_id`                         |
| `withdrawals`         | Off-ramp records linked by `paycrest_order_id`                     |
| `transfers`           | Peer-to-peer USDC sends; supports `pending_claim` state            |
| `bridge_transactions` | CCTP V2 burns tracked by `burn_tx_hash`                            |
| `webhook_events`      | Idempotency log for all inbound webhooks                           |
| `audit_logs`          | Append-only record of all sensitive state changes                  |
| `platform_admins`     | Email-based admin allowlist                                        |
| `contacts`            | User address book                                                  |

Migrations live in `supabase/migrations/` and must be applied in order.

---

## API Routes

| Method | Path                        | Description                                                          |
| ------ | --------------------------- | -------------------------------------------------------------------- |
| `POST` | `/api/transfer/send`        | Initiate a USDC transfer to an email; locks funds atomically via RPC |
| `GET`  | `/api/bridge/status`        | Poll Circle Iris for CCTP attestation status                         |
| `GET`  | `/api/bridge/monitor`       | Monitor in-flight bridge transactions                                |
| `POST` | `/api/wallets/pre-generate` | Pre-generate a Circle smart account for a new user                   |
| `POST` | `/api/webhook/paycrest`     | Receive and verify signed Paycrest webhook events                    |
| `POST` | `/api/batch-send`           | Gasless multi-recipient USDC transfer in one UserOperation           |

---

## Pages & Routes

| Path                  | Description                          |
| --------------------- | ------------------------------------ |
| `/`                   | Marketing landing page               |
| `/features`           | Feature showcase                     |
| `/pricing`            | Pricing page                         |
| `/documentation`      | Public documentation                 |
| `/security`           | Security overview                    |
| `/privacy`            | Privacy policy                       |
| `/dashboard`          | Main wallet dashboard                |
| `/dashboard/transfer` | Send USDC to an email                |
| `/dashboard/history`  | Full transaction history             |
| `/dashboard/settings` | Account settings                     |
| `/tx/[orderId]`       | Individual transaction status page   |
| `/admin`              | Admin overview with analytics charts |
| `/admin/transactions` | All platform transactions            |
| `/admin/users`        | User list with volume metrics        |
| `/admin/logs`         | Webhook events and audit trail       |

---

## Email Templates

Emails are sent via **Resend** using custom HTML templates (`lib/email/templates.ts`):

| Trigger              | Template                                      |
| -------------------- | --------------------------------------------- |
| Login                | OTP code                                      |
| Transfer received    | Amount + sender + claim link (if unclaimed)   |
| Withdrawal OTP       | Verification code for withdrawal confirmation |
| Withdrawal completed | Receipt with amount and destination bank      |

---

## Environment Variables

Create a `.env.local` file in the project root with the following variables:

```env
# ─── App ────────────────────────────────────────────────────────────────────
NEXT_PUBLIC_APP_URL=http://localhost:3000

# ─── Supabase ───────────────────────────────────────────────────────────────
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>

# ─── Privy ──────────────────────────────────────────────────────────────────
NEXT_PUBLIC_PRIVY_APP_ID=<privy-app-id>
NEXT_PUBLIC_PRIVY_SYNC_CHANNEL_ID=<privy-sync-channel-id>
PRIVY_APP_SECRET=<privy-app-secret>

# ─── Circle ─────────────────────────────────────────────────────────────────
CIRCLE_API_KEY=<circle-api-key>
NEXT_PUBLIC_CIRCLE_CLIENT_KEY=<circle-client-key>
NEXT_PUBLIC_CIRCLE_READ_URL=https://modular-sdk.circle.com/v1/rpc/w3s/buidl/<project-id>
NEXT_PUBLIC_CIRCLE_SEND_URL=https://modular-sdk.circle.com/v1/rpc/w3s/sponsored-buidl/<project-id>

# ─── Paycrest ───────────────────────────────────────────────────────────────
PAYCREST_API_KEY=<paycrest-api-key>
PAYCREST_API_SECRET=<paycrest-webhook-secret>
NEXT_PUBLIC_PAYCREST_API_URL=https://api.paycrest.io

# ─── Resend (Email) ──────────────────────────────────────────────────────────
RESEND_API_KEY=<resend-api-key>

# ─── Alchemy (RPC) ──────────────────────────────────────────────────────────
NEXT_PUBLIC_ALCHEMY_API_KEY=<alchemy-api-key>
NEXT_PUBLIC_RPC_URL=https://base-mainnet.g.alchemy.com/v2/<api-key>

# ─── Bitnob (legacy, optional) ───────────────────────────────────────────────
BITNOB_API_KEY=<bitnob-api-key>

# ─── Feature Flags ──────────────────────────────────────────────────────────
# Set to "false" to use Base Mainnet. Any other value uses Base Sepolia (testnet).
NEXT_PUBLIC_SIMULATION_MODE=true

# ─── Admin ──────────────────────────────────────────────────────────────────
# Comma-separated fallback admin emails (used if the platform_admins DB table is unavailable)
ADMIN_EMAILS=admin@example.com
```

---

## Local Development Setup

### Prerequisites

- Node.js 20+
- pnpm (`npm install -g pnpm`)
- A Supabase project
- A Privy application
- A Circle developer account (Modular Wallets)
- A Paycrest sender account

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
   cp .env.example .env.local
   ```

4. **Apply Supabase migrations**

   Using the Supabase CLI:

   ```bash
   npx supabase link --project-ref sendzz
   npx supabase db push
   ```

   Or apply the SQL files manually in the Supabase SQL editor, in order from `001` to the latest migration inside `supabase/migrations/`.

5. **Start the development server**

   ```bash
   pnpm dev
   ```

   The app will be available at `http://localhost:3000`.

---

## Paycrest Webhook Configuration

The Paycrest webhook notifies Sendzz when on-ramp and off-ramp orders reach a terminal state. It must be configured in the Paycrest dashboard.

1. Set the webhook endpoint URL to:

   ```text
   https://sendzz.io/api/webhook/paycrest
   ```

2. Copy the signing secret from Paycrest and set it as `PAYCREST_API_SECRET` in your environment.
3. The handler verifies every inbound request using the `standardwebhooks` library before processing. Invalid signatures are rejected with `400`.
4. Webhook events are stored in the `webhook_events` table with a unique constraint on `event_id` for idempotency — duplicate deliveries are silently ignored.

---

## Admin Access

Admin access is controlled by the `platform_admins` table in Supabase. To grant access:

```sql
insert into public.platform_admins (email) values ('your@email.com');
```

As a disaster-recovery fallback, the `ADMIN_EMAILS` environment variable accepts a comma-separated list of admin emails that bypasses the database check if the table query fails.

Admin users see a protected `/admin` section in the sidebar after logging in with a listed email.

---

## Testing

**Unit tests** (Vitest):

```bash
pnpm test
```

**End-to-end tests** (Playwright):

```bash
pnpm test:e2e
```

**Type checking:**

```bash
npx tsc --noEmit
```

**Linting:**

```bash
pnpm lint
```
