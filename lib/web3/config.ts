import { createPublicClient, http } from "viem";
import { base, baseSepolia } from "viem/chains";

const IS_PROD = process.env.NEXT_PUBLIC_SIMULATION_MODE === "false";

// Default to Base or Base Sepolia based on env
export const chain = IS_PROD ? base : baseSepolia;

export const VIEM_PUBLIC_CLIENT = createPublicClient({
  chain,
  transport: http(process.env.NEXT_PUBLIC_RPC_URL),
});

// const baseUrl =
//   typeof window !== "undefined"
//     ? window.location.origin
//     : process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

export const USDC_ADDRESS = IS_PROD
  ? "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" // Base Mainnet
  : "0x036CbD53842c5426634e7929541eC2318f3dCF7e"; // Base Sepolia

export const CIRCLE_CLIENT_KEY = process.env.NEXT_PUBLIC_CIRCLE_CLIENT_KEY;
export const CIRCLE_READ_URL = process.env.NEXT_PUBLIC_CIRCLE_READ_URL || "";
export const CIRCLE_SEND_URL = process.env.NEXT_PUBLIC_CIRCLE_SEND_URL || "";
