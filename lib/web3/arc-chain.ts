import { defineChain } from 'viem';

/**
 * Circle Arc Testnet viem chain definition.
 *
 * Arc is an EVM-compatible L1 from Circle, built for stablecoin payments, with USDC as
 * its native gas token and sub-second finality. Chain ID 5042002 (0x4CEF52).
 *
 * The native balance is 18 decimals, not 6. Arc presents one USDC balance through two
 * interfaces: the native token (18 decimals, used for gas and `msg.value`) and an ERC-20
 * system contract at 0x3600…0000 (6 decimals, used for transfers and balance reads).
 * `nativeCurrency.decimals` describes the former, so it must be 18 — viem uses it to
 * format gas, and declaring 6 here misreports every fee by a factor of 10^12.
 *
 * App-level code should not use the native interface at all: read balances and move
 * funds through the ERC-20 at USDC_ADDRESSES.arc, exactly as on any other chain.
 */
export const arcTestnet = defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: {
    name: 'USD Coin',
    symbol: 'USDC',
    decimals: 18,
  },
  rpcUrls: {
    default: { http: ['https://rpc.testnet.arc.network'] },
    public: { http: ['https://rpc.testnet.arc.network'] },
  },
  blockExplorers: {
    default: { name: 'ArcScan', url: 'https://testnet.arcscan.app' },
  },
  contracts: {
    multicall3: {
      address: '0xca11bde05977b3631167028862be2a173976ca11',
    },
  },
});
