/**
 * Single source of truth for which network family the app is pointed at.
 *
 * Everything chain-shaped derives from this one flag — RPC endpoints, USDC addresses,
 * CCTP domains and contracts, Circle bundler endpoints, the home settlement chain — so
 * moving between testnet and mainnet is an env change and never a code change.
 *
 *   NEXT_PUBLIC_SIMULATION_MODE="true"   → testnet (Arc Testnet + the Sepolia family)
 *   NEXT_PUBLIC_SIMULATION_MODE="false"  → mainnet (Base, Arbitrum, Polygon, …)
 *
 * Unset defaults to testnet: a missing variable must never quietly point a preview build
 * at real funds. The codebase used to mix `!== 'false'` and `=== 'true'` checks, which
 * disagreed with each other whenever the variable was absent — that is why every call
 * site now imports this constant instead of reading the environment directly.
 */
export const IS_TESTNET = process.env.NEXT_PUBLIC_SIMULATION_MODE !== 'false';

/** Inverse of {@link IS_TESTNET}, for call sites that read better as a positive check. */
export const IS_MAINNET = !IS_TESTNET;

/**
 * Whether Arc is reachable at all.
 *
 * Circle has not launched an Arc mainnet — Arc exists only as a public testnet. Rather
 * than let Arc leak into a mainnet build and point at a chain that does not exist, every
 * runtime chain list gates its Arc entry on this. When Arc mainnet ships, give Arc real
 * mainnet values in the maps below and change this to `true`.
 */
export const IS_ARC_ENABLED = IS_TESTNET;
