import { createPublicClient, http, type Address, type Hex } from "viem";
import { createBundlerClient } from "viem/account-abstraction";
import {
  toCircleSmartAccount,
  toModularTransport,
} from "@circle-fin/modular-wallets-core";
import {
  chain,
  CIRCLE_CLIENT_KEY,
  CIRCLE_SEND_URL as CIRCLE_CLIENT_URL,
} from "./config";

const CIRCLE_RPC_URL = `${CIRCLE_CLIENT_URL}/base`;

// Build a viem custom account from Privy's provider
// Privy supports eth_signTypedData_v4 but NOT raw signing
function privyToLocalAccount(provider: any, address: Address) {
  return {
    address,
    type: "local" as const,

    // Privy supports signTypedData via eth_signTypedData_v4
    async signTypedData(typedData: any): Promise<Hex> {
      const signature = await provider.request({
        method: "eth_signTypedData_v4",
        params: [address, JSON.stringify(typedData)],
      });
      return signature as Hex;
    },

    // Required by viem account interface but won't be called for permit flow
    async signMessage({ message }: { message: any }): Promise<Hex> {
      const signature = await provider.request({
        method: "personal_sign",
        params: [typeof message === "string" ? message : message.raw, address],
      });
      return signature as Hex;
    },

    // Not supported by Privy embedded wallets — throw a clear error
    async sign(): Promise<never> {
      throw new Error("Raw sign not supported by Privy embedded wallets.");
    },
  };
}

export async function getCircleClient(provider: any) {
  if (!CIRCLE_CLIENT_KEY) throw new Error("Circle Client Key not configured.");
  if (!CIRCLE_CLIENT_URL) throw new Error("Circle Client URL not configured.");

  const modularTransport = toModularTransport(
    CIRCLE_RPC_URL,
    CIRCLE_CLIENT_KEY,
  );

  const publicClient = createPublicClient({
    chain,
    transport: modularTransport,
  });

  // Get the EOA address from Privy
  const [address]: [Address] = await provider.request({
    method: "eth_requestAccounts",
  });

  // Use our custom Privy-compatible local account instead of walletClientToLocalAccount
  const localAccount = privyToLocalAccount(provider, address);

  const account = await toCircleSmartAccount({
    client: publicClient,
    owner: localAccount,
  });

  const bundlerClient = createBundlerClient({
    chain,
    transport: modularTransport,
    account,
  });

  return { bundlerClient, account, localAccount };
}

export async function getCircleAddress(provider: any) {
  if (!CIRCLE_CLIENT_KEY) throw new Error("Circle Client Key not configured.");

  const modularTransport = toModularTransport(
    CIRCLE_RPC_URL,
    CIRCLE_CLIENT_KEY,
  );

  const publicClient = createPublicClient({
    chain,
    transport: http(
      `https://base-mainnet.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_API_KEY}`,
    ),
  });

  const [address]: [Address] = await provider.request({
    method: "eth_requestAccounts",
  });

  const localAccount = privyToLocalAccount(provider, address);

  const account = await toCircleSmartAccount({
    client: publicClient,
    owner: localAccount,
  });

  return account.address;
}
