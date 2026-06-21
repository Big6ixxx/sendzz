# Dune Analytics Dashboard Setup for Sendzz

This guide provides instructions, SQL queries, expected outputs, and verification checks to set up a comprehensive Dune Analytics dashboard for **Sendzz** on the **Base Mainnet** (L2) and supported source EVM chains.

---

## ⚠️ Important: The Shared Factory Challenge

Sendzz uses **Circle's Modular Wallets** which are deployed via a shared global factory contract on Base:
*   **Circle modular wallet factory:** `0x0000000DF7E6c9Dc387cAFc5eCBfa6c3a6179AdD`

Because this factory is shared by all dapps building on Circle's platform, querying the factory alone will return data for other dapps as well.

To filter the dashboard for **only Sendzz's users and transactions**, you must use one of the two methods below.

---

## Method 1: Uploading Sendzz Wallets from Supabase (100% Accurate & Recommended)

This method exports your users' smart account addresses from the Sendzz Supabase database and uploads them directly to Dune.

### Step 1: Export your Smart Accounts from Supabase
Run the following SQL query in your **Supabase SQL Editor** to fetch all Sendzz user smart accounts:
```sql
SELECT smart_account_address 
FROM public.users 
WHERE smart_account_address IS NOT NULL;
```
Export the results as a **CSV file** (e.g., `sendzz_wallets.csv`).

### Step 2: Upload CSV to Dune
1. Go to your [Dune Dashboard](https://dune.com/).
2. Click **Create** -> **Upload CSV**.
3. Select your CSV file and name the table `sendzz_wallets` (the full table name will be `dune.<username>.dataset_sendzz_wallets`).
4. Set the column type of `smart_account_address` to `varchar` or `varbinary` (Dune handles it as a string).

### Step 3: Run these SQL Queries on Dune V3 (Trino)

#### Query 1.1: User Growth (Daily & Cumulative Deployed Wallets)
Tracks only Sendzz wallets that have been deployed.
```sql
-- Replace <username> with your Dune username
WITH sendzz_wallets AS (
    -- Select the pre-parsed varbinary addresses directly (Dune parsed the CSV column as varbinary)
    SELECT smart_account_address AS wallet_address
    FROM dune.sendzz8533.dataset_supabase_snippet_enforce_unique_user_email_contacts
),
deployments AS (
    SELECT 
        date_trunc('day', block_time) AS day,
        varbinary_substring(topic2, 13, 20) AS wallet_address
    FROM base.logs
    WHERE contract_address = 0x0000000071727de22e5e9d8baf0edac6f37da032 -- EntryPoint v0.7
      AND topic0 = 0xd51a9c61267aa6196961883ecf5ff2da6619c37dac0fa92122513fb32c032d2d -- AccountDeployed
)
SELECT 
    d.day,
    count(distinct d.wallet_address) AS new_wallets,
    sum(count(distinct d.wallet_address)) OVER (ORDER BY d.day ASC) AS cumulative_wallets
FROM deployments d
INNER JOIN sendzz_wallets w ON d.wallet_address = w.wallet_address
GROUP BY 1
ORDER BY d.day DESC;
```

*   **Expected Output Format:**
    | Column | Data Type | Description / Sample Value |
    | :--- | :--- | :--- |
    | `day` | Timestamp | `2026-06-19 00:00:00.000 UTC` |
    | `new_wallets` | Integer | `24` |
    | `cumulative_wallets` | Integer | `1250` |

---

#### Query 1.2: USDC Transaction Volume (Sent/Received)
Tracks USDC transactions moving to and from Sendzz user smart accounts.
```sql
WITH sendzz_wallets AS (
    SELECT smart_account_address AS wallet_address
    FROM dune.sendzz8533.dataset_supabase_snippet_enforce_unique_user_email_contacts
),
usdc_transfers AS (
    SELECT 
        block_time,
        varbinary_substring(topic1, 13, 20) AS from_address,
        varbinary_substring(topic2, 13, 20) AS to_address,
        varbinary_to_uint256(data) / 1000000.0 AS amount_usdc
    FROM base.logs
    WHERE contract_address = 0x833589fcd6edb6e08f4c7c32d4f71b54bda02913 -- USDC on Base (Corrected to 40 characters)
      AND topic0 = 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef -- Transfer
)
SELECT 
    date_trunc('day', t.block_time) AS day,
    sum(case when w_from.wallet_address IS NOT NULL then t.amount_usdc else 0 end) AS sent_volume_usdc,
    sum(case when w_to.wallet_address IS NOT NULL then t.amount_usdc else 0 end) AS received_volume_usdc,
    sum(t.amount_usdc) AS total_volume_usdc,
    count(*) AS transfer_count
FROM usdc_transfers t
LEFT JOIN sendzz_wallets w_from ON t.from_address = w_from.wallet_address
LEFT JOIN sendzz_wallets w_to ON t.to_address = w_to.wallet_address
WHERE w_from.wallet_address IS NOT NULL OR w_to.wallet_address IS NOT NULL
GROUP BY 1
ORDER BY day DESC;
```

*   **Expected Output Format:**
    | Column | Data Type | Description / Sample Value |
    | :--- | :--- | :--- |
    | `day` | Timestamp | `2026-06-19 00:00:00.000 UTC` |
    | `sent_volume_usdc` | Double | `1500.50` (USDC transferred out of Sendzz accounts) |
    | `received_volume_usdc` | Double | `1200.00` (USDC received by Sendzz accounts) |
    | `total_volume_usdc` | Double | `2700.50` (Total USDC processed) |
    | `transfer_count` | Integer | `87` (Number of transactions) |

#### Query 1.3: Cross-Chain Bridging Volume (Circle CCTP Mints into Sendzz)
Tracks USDC bridging originating from all other source chains (Ethereum, Arbitrum, Optimism, Avalanche, Polygon) using Circle's CCTP contract to transfer funds into Sendzz wallets on Base.
```sql
WITH sendzz_wallets AS (
    SELECT smart_account_address AS wallet_address
    FROM dune.sendzz8533.dataset_supabase_snippet_enforce_unique_user_email_contacts
),
cctp_burns AS (
    SELECT 'ethereum' AS source_chain, block_time, data, topic2, topic3 FROM ethereum.logs 
    WHERE contract_address IN (0xBd3fa81B58Ba92a82136038B25aDec7066af3155, 0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d)
      AND topic0 = 0x2fa9ca894982930190727e75500a97d8dc500233a5065e0f3126c48fbe0343c0
    UNION ALL
    SELECT 'arbitrum' AS source_chain, block_time, data, topic2, topic3 FROM arbitrum.logs 
    WHERE contract_address IN (0x19330d10D9Cc8751218eaf51E8885D058642E08A, 0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d)
      AND topic0 = 0x2fa9ca894982930190727e75500a97d8dc500233a5065e0f3126c48fbe0343c0
    UNION ALL
    SELECT 'optimism' AS source_chain, block_time, data, topic2, topic3 FROM optimism.logs 
    WHERE contract_address IN (0x2B4069517957735bE00ceE0fadAE88a26365528f, 0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d)
      AND topic0 = 0x2fa9ca894982930190727e75500a97d8dc500233a5065e0f3126c48fbe0343c0
    UNION ALL
    SELECT 'polygon' AS source_chain, block_time, data, topic2, topic3 FROM polygon.logs 
    WHERE contract_address IN (0x9daF8c91AEFAE50b9c0E69629D3F6Ca40cA3B3FE, 0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d)
      AND topic0 = 0x2fa9ca894982930190727e75500a97d8dc500233a5065e0f3126c48fbe0343c0
    UNION ALL
    SELECT 'avalanche' AS source_chain, block_time, data, topic2, topic3 FROM avalanche_c.logs 
    WHERE contract_address IN (0x6B25532e1060CE10cc3B0A99e5683b91BFDe6982, 0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d)
      AND topic0 = 0x2fa9ca894982930190727e75500a97d8dc500233a5065e0f3126c48fbe0343c0
    UNION ALL
    SELECT 'base' AS source_chain, block_time, data, topic2, topic3 FROM base.logs 
    WHERE contract_address IN (0x1682Ae6375C4E4A97e4B583BC394c861A46D8962, 0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d)
      AND topic0 = 0x2fa9ca894982930190727e75500a97d8dc500233a5065e0f3126c48fbe0343c0
),
parsed_burns AS (
    SELECT 
        source_chain,
        block_time,
        varbinary_to_uint256(varbinary_substring(data, 1, 32)) / 1000000.0 AS amount_usdc,
        varbinary_substring(data, 45, 20) AS recipient_address,
        varbinary_substring(topic3, 13, 20) AS depositor_address,
        varbinary_to_uint256(varbinary_substring(data, 65, 32)) AS destination_domain
    FROM cctp_burns
)
SELECT 
    date_trunc('day', b.block_time) AS day,
    b.source_chain,
    CASE WHEN b.source_chain = 'base' THEN 'OUT (Base to Chain)' ELSE 'IN (Chain to Base)' END AS direction,
    sum(b.amount_usdc) AS bridged_volume_usdc,
    count(*) AS tx_count
FROM parsed_burns b
INNER JOIN sendzz_wallets w 
  ON (b.source_chain != 'base' AND b.destination_domain = 6 AND b.recipient_address = w.wallet_address)
  OR (b.source_chain = 'base' AND b.destination_domain != 6 AND b.depositor_address = w.wallet_address)
GROUP BY 1, 2, 3
ORDER BY day DESC, source_chain;
```

*   **Expected Output Format:**
    | Column | Data Type | Description / Sample Value |
    | :--- | :--- | :--- |
    | `day` | Timestamp | `2026-06-19 00:00:00.000 UTC` |
    | `source_chain` | Varchar | `'ethereum'` or `'arbitrum'`, etc. |
    | `bridged_volume_usdc` | Double | `500.00` (Bridged volume from that chain) |
    | `tx_count` | Integer | `3` (Number of bridge transfers) |

---


## Method 2: Filtering by Sendzz Paymaster Address (Purely On-Chain & Instant)

Since Sendzz pays for all gas via its own **Circle Gas Station Policy**, every single transaction executed on Sendzz is sponsored by your unique Paymaster contract address:
*   **Sendzz Paymaster Address:** `0x03df76c8c30a88f424cf3cbbc36a1ca02763103b`

These queries are fully configured with your paymaster address and can be pasted into Dune to query your data instantly.

### SQL Queries (Pre-configured for Sendzz)

#### Query 2.1: User Growth (Daily & Cumulative Deployed Wallets)
Filters modular wallet deployments sponsored by the Sendzz Paymaster.
```sql
WITH deployments AS (
    SELECT 
        date_trunc('day', block_time) AS day,
        varbinary_substring(topic2, 13, 20) AS wallet_address,
        -- Extract paymaster parameter from AccountDeployed data section (third 32-byte word)
        varbinary_substring(data, 45, 20) AS paymaster_address
    FROM base.logs
    WHERE contract_address = 0x0000000071727de22e5e9d8baf0edac6f37da032 -- EntryPoint v0.7
      AND topic0 = 0xd51a9c61267aa6196961883ecf5ff2da6619c37dac0fa92122513fb32c032d2d -- AccountDeployed
      AND varbinary_substring(data, 13, 20) = 0x0000000DF7E6c9Dc387cAFc5eCBfa6c3a6179AdD -- Circle Factory
)
SELECT 
    day,
    count(*) AS new_wallets,
    sum(count(*)) OVER (ORDER BY day ASC) AS cumulative_wallets
FROM deployments
WHERE paymaster_address = 0x03df76c8c30a88f424cf3cbbc36a1ca02763103b -- Sendzz Paymaster
GROUP BY 1
ORDER BY day DESC;
```

*   **Expected Output Format:**
    | Column | Data Type | Description / Sample Value |
    | :--- | :--- | :--- |
    | `day` | Timestamp | `2026-06-19 00:00:00.000 UTC` |
    | `new_wallets` | Integer | `12` |
    | `cumulative_wallets` | Integer | `980` |

---

#### Query 2.2: Daily Active Wallets (DAU) & Platform Operations
Counts transactions and unique user smart wallets interacting through the Sendzz Paymaster.
```sql
SELECT 
    date_trunc('day', block_time) AS day,
    count(distinct varbinary_substring(topic2, 13, 20)) AS active_wallets,
    count(*) AS transaction_count,
    -- actualGasCost in ETH (third 32-byte word in the data section of EntryPoint v0.7)
    sum(varbinary_to_uint256(varbinary_substring(data, 65, 32)) / 1e18) AS total_sponsored_cost_eth
FROM base.logs
WHERE contract_address = 0x0000000071727de22e5e9d8baf0edac6f37da032 -- EntryPoint v0.7
  AND topic0 = 0x49628fd1471006c1482da88028e9ce4dbb080b815c9b0344d39e5a8e6ec1419f -- UserOperationEvent
  -- Filter by Sendzz Paymaster (topic3 is the indexed paymaster address in EntryPoint v0.7)
  AND varbinary_substring(topic3, 13, 20) = 0x03df76c8c30a88f424cf3cbbc36a1ca02763103b
GROUP BY 1
ORDER BY day DESC;
```

*   **Expected Output Format:**
    | Column | Data Type | Description / Sample Value |
    | :--- | :--- | :--- |
    | `day` | Timestamp | `2026-06-19 00:00:00.000 UTC` |
    | `active_wallets` | Integer | `54` (Unique active wallets today) |
    | `transaction_count` | Integer | `112` (Total user operations executed) |
    | `total_sponsored_cost_eth` | Double | `0.0245` (Total sponsored gas cost paid in ETH) |

---

#### Query 2.3: USDC Transaction Volume (Sent/Received)
Identifies all USDC transfers originating from or received by Sendzz smart wallets (mapped via transactions using your paymaster).
```sql
WITH sendzz_wallets AS (
    SELECT DISTINCT varbinary_substring(topic2, 13, 20) AS wallet_address
    FROM base.logs
    WHERE contract_address = 0x0000000071727de22e5e9d8baf0edac6f37da032 -- EntryPoint v0.7
      AND topic0 = 0x49628fd1471006c1482da88028e9ce4dbb080b815c9b0344d39e5a8e6ec1419f -- UserOperationEvent
      AND varbinary_substring(topic3, 13, 20) = 0x03df76c8c30a88f424cf3cbbc36a1ca02763103b -- Sendzz Paymaster
),
usdc_transfers AS (
    SELECT 
        block_time,
        varbinary_substring(topic1, 13, 20) AS from_address,
        varbinary_substring(topic2, 13, 20) AS to_address,
        varbinary_to_uint256(data) / 1000000.0 AS amount_usdc
    FROM base.logs
    WHERE contract_address = 0x833589fcd6edb6e08f4c7c32d4f71b54bda02913 -- USDC on Base (Corrected to 40 characters)
      AND topic0 = 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef -- Transfer
)
SELECT 
    date_trunc('day', t.block_time) AS day,
    sum(case when w_from.wallet_address IS NOT NULL then t.amount_usdc else 0 end) AS sent_volume_usdc,
    sum(case when w_to.wallet_address IS NOT NULL then t.amount_usdc else 0 end) AS received_volume_usdc,
    sum(t.amount_usdc) AS total_volume_usdc,
    count(*) AS transfer_count
FROM usdc_transfers t
LEFT JOIN sendzz_wallets w_from ON t.from_address = w_from.wallet_address
LEFT JOIN sendzz_wallets w_to ON t.to_address = w_to.wallet_address
WHERE w_from.wallet_address IS NOT NULL OR w_to.wallet_address IS NOT NULL
GROUP BY 1
ORDER BY day DESC;
```

*   **Expected Output Format:**
    | Column | Data Type | Description / Sample Value |
    | :--- | :--- | :--- |
    | `day` | Timestamp | `2026-06-19 00:00:00.000 UTC` |
    | `sent_volume_usdc` | Double | `980.00` |
    | `received_volume_usdc` | Double | `640.50` |
    | `total_volume_usdc` | Double | `1620.50` |
    | `transfer_count` | Integer | `45` |

---

#### Query 2.4: Cross-Chain Bridging Volume (Circle CCTP Mints into Sendzz)
Tracks USDC bridging originating from all other source chains (Ethereum, Arbitrum, Optimism, Avalanche, Polygon) using Circle's CCTP contract to transfer funds into Sendzz wallets on Base.
```sql
WITH sendzz_wallets AS (
    SELECT DISTINCT varbinary_substring(topic2, 13, 20) AS wallet_address
    FROM base.logs
    WHERE contract_address = 0x0000000071727de22e5e9d8baf0edac6f37da032 -- EntryPoint v0.7
      AND topic0 = 0x49628fd1471006c1482da88028e9ce4dbb080b815c9b0344d39e5a8e6ec1419f -- UserOperationEvent
      AND varbinary_substring(topic3, 13, 20) = 0x03df76c8c30a88f424cf3cbbc36a1ca02763103b -- Sendzz Paymaster
),
cctp_burns AS (
    SELECT 'ethereum' AS source_chain, block_time, data, topic2, topic3 FROM ethereum.logs 
    WHERE contract_address IN (0xBd3fa81B58Ba92a82136038B25aDec7066af3155, 0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d)
      AND topic0 = 0x2fa9ca894982930190727e75500a97d8dc500233a5065e0f3126c48fbe0343c0
    UNION ALL
    SELECT 'arbitrum' AS source_chain, block_time, data, topic2, topic3 FROM arbitrum.logs 
    WHERE contract_address IN (0x19330d10D9Cc8751218eaf51E8885D058642E08A, 0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d)
      AND topic0 = 0x2fa9ca894982930190727e75500a97d8dc500233a5065e0f3126c48fbe0343c0
    UNION ALL
    SELECT 'optimism' AS source_chain, block_time, data, topic2, topic3 FROM optimism.logs 
    WHERE contract_address IN (0x2B4069517957735bE00ceE0fadAE88a26365528f, 0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d)
      AND topic0 = 0x2fa9ca894982930190727e75500a97d8dc500233a5065e0f3126c48fbe0343c0
    UNION ALL
    SELECT 'polygon' AS source_chain, block_time, data, topic2, topic3 FROM polygon.logs 
    WHERE contract_address IN (0x9daF8c91AEFAE50b9c0E69629D3F6Ca40cA3B3FE, 0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d)
      AND topic0 = 0x2fa9ca894982930190727e75500a97d8dc500233a5065e0f3126c48fbe0343c0
    UNION ALL
    SELECT 'avalanche' AS source_chain, block_time, data, topic2, topic3 FROM avalanche_c.logs 
    WHERE contract_address IN (0x6B25532e1060CE10cc3B0A99e5683b91BFDe6982, 0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d)
      AND topic0 = 0x2fa9ca894982930190727e75500a97d8dc500233a5065e0f3126c48fbe0343c0
    UNION ALL
    SELECT 'base' AS source_chain, block_time, data, topic2, topic3 FROM base.logs 
    WHERE contract_address IN (0x1682Ae6375C4E4A97e4B583BC394c861A46D8962, 0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d)
      AND topic0 = 0x2fa9ca894982930190727e75500a97d8dc500233a5065e0f3126c48fbe0343c0
),
parsed_burns AS (
    SELECT 
        source_chain,
        block_time,
        varbinary_to_uint256(varbinary_substring(data, 1, 32)) / 1000000.0 AS amount_usdc,
        varbinary_substring(data, 45, 20) AS recipient_address,
        varbinary_substring(topic3, 13, 20) AS depositor_address,
        varbinary_to_uint256(varbinary_substring(data, 65, 32)) AS destination_domain
    FROM cctp_burns
)
SELECT 
    date_trunc('day', b.block_time) AS day,
    b.source_chain,
    CASE WHEN b.source_chain = 'base' THEN 'OUT (Base to Chain)' ELSE 'IN (Chain to Base)' END AS direction,
    sum(b.amount_usdc) AS bridged_volume_usdc,
    count(*) AS tx_count
FROM parsed_burns b
INNER JOIN sendzz_wallets w 
  ON (b.source_chain != 'base' AND b.destination_domain = 6 AND b.recipient_address = w.wallet_address)
  OR (b.source_chain = 'base' AND b.destination_domain != 6 AND b.depositor_address = w.wallet_address)
GROUP BY 1, 2, 3
ORDER BY day DESC, source_chain;
```

*   **Expected Output Format:**
    | Column | Data Type | Description / Sample Value |
    | :--- | :--- | :--- |
    | `day` | Timestamp | `2026-06-19 00:00:00.000 UTC` |
    | `source_chain` | Varchar | `'ethereum'` or `'arbitrum'`, etc. |
    | `bridged_volume_usdc` | Double | `500.00` (Bridged volume from that chain) |
    | `tx_count` | Integer | `3` (Number of bridge transfers) |

---

## 🛠️ Data Verification & Reconciliation Guide

To check if the on-chain metrics generated by Dune match your platform exactly, you can run verification queries directly inside the **Supabase SQL Editor** and compare them.

### Verification Check 1: User Growth (Dune vs Supabase)
Run this query in Supabase to compare your total registered users with Query 1.1 / 2.1 on Dune:
```sql
SELECT 
    date_trunc('day', created_at) AS day, 
    count(*) AS daily_users,
    sum(count(*)) OVER (ORDER BY date_trunc('day', created_at) ASC) AS cumulative_users
FROM public.users
WHERE smart_account_address IS NOT NULL
GROUP BY 1
ORDER BY day DESC;
```
> [!TIP]
> **Why they should match:** Since every Sendzz user generates a smart account upon signup/login, the cumulative sum here should align with the Dune cumulative wallets count.

### Verification Check 2: USDC Volume (Dune vs Supabase)
Run this query in Supabase to verify completed transfers match the Dune USDC transfers volume (Query 1.2 / 2.3):
```sql
SELECT 
    date_trunc('day', created_at) AS day, 
    sum(amount) AS local_usdc_volume,
    count(*) AS local_tx_count
FROM public.transfers
WHERE status = 'completed'
GROUP BY 1
ORDER BY day DESC;
```
> [!NOTE]
> **Minor differences:** Dune tracks transfers on-chain, whereas Supabase tracks database states. Unclaimed escrowed transfers (which are in `pending_claim` state in the database) are already on-chain from the sender's perspective, so Dune volume might look slightly higher than Supabase's completed volume.

### Verification Check 3: Bridging Transactions (Dune vs Supabase)
Verify bridging transactions match Query 2.4 on Dune:
```sql
SELECT 
    date_trunc('day', created_at) AS day, 
    sum(amount_usdc) AS local_bridged_volume,
    count(*) AS local_bridge_count
FROM public.bridge_transactions
WHERE status = 'completed'
GROUP BY 1
ORDER BY day DESC;
```
