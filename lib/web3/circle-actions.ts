import { getCircleClient } from "./circle-client";
import {
  USDC_ADDRESS,
  chain,
  CIRCLE_CLIENT_KEY,
  CIRCLE_SEND_URL,
} from "./config";
import { parseAbi, encodeFunctionData, parseUnits, type Address } from "viem";
import { toModularTransport } from "@circle-fin/modular-wallets-core";
import { createBundlerClient } from "viem/account-abstraction";

const ERC20_ABI = parseAbi([
  "function transfer(address _to, uint256 _value) returns (bool)",
]);

// Chain slug for Circle modular transport URL
const CHAIN_SLUG = chain.id === 8453 ? "base" : "base-sepolia";

// Circle's bundler + paymaster endpoint — handles gas sponsorship via our policy
const SEND_RPC_URL = `${CIRCLE_SEND_URL}/${CHAIN_SLUG}`;

export async function executeCircleGaslessTransfer(
  provider: any,
  recipientAddress: string,
  amountUSDC: string,
) {
  // 1. Get Circle smart account
  const { account } = await getCircleClient(provider);

  // 2. Create bundler client using Circle's send transport
  // Circle's bundler automatically applies our gas policy when paymaster: true
  const sendTransport = toModularTransport(SEND_RPC_URL, CIRCLE_CLIENT_KEY!);

  const bundlerClient = createBundlerClient({
    chain,
    transport: sendTransport,
    account,
  });

  // 3. Encode the USDC transfer
  const amountParsed = parseUnits(amountUSDC, 6);
  const transferData = encodeFunctionData({
    abi: ERC20_ABI,
    functionName: "transfer",
    args: [recipientAddress as Address, amountParsed],
  });

  // 4. Send UserOperation — paymaster: true tells Circle to use your policy
  console.log("[Transfer] Sending UserOp...", {
    recipient: recipientAddress,
    amount: amountUSDC,
  });

  const userOpHash = await bundlerClient.sendUserOperation({
    calls: [
      {
        to: USDC_ADDRESS as Address,
        data: transferData,
        value: 0n,
      },
    ],
    paymaster: true, // Circle uses our policy ID automatically
  });

  console.log("[Transfer] UserOp Hash:", userOpHash);

  // 5. Wait for transaction
  const receipt = await bundlerClient.waitForUserOperationReceipt({
    hash: userOpHash,
  });

  console.log("[Transfer] Success:", receipt.receipt.transactionHash);
  return receipt.receipt.transactionHash;
}
