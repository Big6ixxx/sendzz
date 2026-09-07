# Sendzz on Dune

Queries behind <https://dune.com/sendzz8533/sendzz-dashboard>. Every figure is derived from chain
data and recomputable by anyone; nothing is uploaded except the wallet roster.

| file | drives | dune query |
|---|---|---|
| `10_summary.sql` | Summary table (metric/value) | 8618302 |
| `01_evm_activity.sql` | volume-by-chain chart + per-chain table | 8618277 |
| `00_stellar_activity.sql` | Stellar table | 8607596 |

All three are public and forkable, which is what makes the dashboard checkable: a reader can open
any panel, read the SQL, fork it and re-run it themselves. The roster is public too --
`SELECT * FROM dune.sendzz8533.dataset_sendzz_wallets`.

## The one maintenance task

**New users do not appear on their own.** EVM addresses are inline in the SQL (a roster join costs
~96s against Dune's 120s ceiling; inline runs in ~45s), so a signup after the list was generated is
invisible -- silently, with no error. Regenerate from `/api/cron/sync-dune-roster` and re-paste into
`01_evm_activity.sql` and `10_summary.sql`.

This can be automated: `PATCH /api/v1/query/{id}` updates a query's SQL and costs no credits, so
the cron could rewrite both queries after it uploads the roster. Not built yet.

Everything else refreshes itself -- Dune re-runs dashboard queries on a schedule at no credit cost.

## Things that bite

All of these failed silently or misleadingly rather than erroring.

- **`from_hex()` rejects nothing.** Given a `0x`-prefixed string it returns wrong bytes, the join
  matches nothing, and the query reports success with zero rows. Use `substr(address, 3)`.
- **`stellar.history_operations` is flat** -- `amount` and `asset_code` are real columns, not a
  `details` JSON blob. It has no `transaction_hash`: operations carry `transaction_id`, which joins
  to `history_transactions.id`.
- **Filtering Stellar by `fee_account` alone loses every deposit.** We only pay the fee on
  transactions we send; an inbound payment is paid for by the sender. That filter hid 80 payments
  worth 12,502.79 USDC -- more than it reported. Coverage must be gas station OR either side ours.
- **Every scan must be date- and chain-bounded** or it dies on the 120s ceiling.
- Chain names are `base`, `arbitrum`, `optimism`, `polygon`, `ethereum` and **`avalanche_c`**.
- A one-row query can only be a Counter or a Table. Give a pie chart one row and it plots a
  timestamp's epoch milliseconds as a quantity.

## Reading the numbers

`bridge_movements` counts LEGS. One bridge is two events on two chains -- burned where it leaves,
minted where it arrives. Never show `bridge_in` and `bridge_out` as separate headline figures: they
do not balance, because 86 bridges begin on Stellar where the burn is a Soroban call and invisible
to a payments query, and a reader takes that gap for an error. Per chain the split is fine.

`transfer` merges user-to-user sends with sends to outside addresses, including off-ramp payouts.

Fees to our own treasuries are classified but excluded -- the dashboard is user money, not revenue.

Solana is excluded (3 deposits, 7 bridges as of 2026-09-04).
