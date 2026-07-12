import { NextResponse } from 'next/server';
import { Keypair, TransactionBuilder, Contract, xdr, Networks } from '@stellar/stellar-sdk';
import { rpc as SorobanRpc } from '@stellar/stellar-sdk';
import { loadStellarAccount } from '@/lib/circle/stellar-gateway';
import { CCTP_DOMAINS } from '@/lib/circle/gateway';

const STELLAR_RPC_URL = process.env.NEXT_PUBLIC_STELLAR_RPC_URL || 'https://soroban-rpc.mainnet.stellar.gateway.fm';
const STELLAR_CCTP_FORWARDER = 'CBZL2IH7F6BIDAA3WBNXYKIXSATJGMSW7K5P5MJ6STX5RXN47TZJDF5T';
const STELLAR_NETWORK_PASSPHRASE = Networks.PUBLIC;

export async function POST(req: Request) {
  try {
    const { txHash, sourceChain } = await req.json() as { txHash: string; sourceChain: string };

    if (!txHash || !sourceChain) {
      return NextResponse.json(
        { error: 'txHash and sourceChain are required' },
        { status: 400 },
      );
    }

    const domain = CCTP_DOMAINS[sourceChain as keyof typeof CCTP_DOMAINS];
    if (domain === undefined) {
      return NextResponse.json(
        { error: `Unsupported source chain: ${sourceChain}` },
        { status: 400 },
      );
    }

    console.log(`[Stellar/Claim] Claiming CCTP tx: ${txHash} from domain ${domain} to Stellar...`);

    // 1. Fetch attestation from Iris API
    const irisRes = await fetch(`https://iris-api.circle.com/v2/messages/${domain}?transactionHash=${txHash}`);
    if (!irisRes.ok) {
      throw new Error(`Iris API query failed: ${irisRes.statusText}`);
    }
    const irisData = await irisRes.json() as any;
    if (!irisData.messages || irisData.messages.length === 0) {
      throw new Error('No attestation found on Circle Iris API yet');
    }

    const { message, attestation, status } = irisData.messages[0];
    if (status !== 'complete') {
      return NextResponse.json(
        { error: 'Attestation is still pending on Circle. Please wait 1-2 minutes and try again.' },
        { status: 400 },
      );
    }

    const messageBytes = Buffer.from(message.startsWith('0x') ? message.slice(2) : message, 'hex');
    const attestationBytes = Buffer.from(attestation.startsWith('0x') ? attestation.slice(2) : attestation, 'hex');

    // 2. Setup Sponsor Keypair
    const sponsorSecret = process.env.STELLAR_SPONSOR_SECRET_KEY;
    if (!sponsorSecret) {
      throw new Error('STELLAR_SPONSOR_SECRET_KEY is not configured on the server');
    }
    const sponsorKeypair = Keypair.fromSecret(sponsorSecret);
    const sponsorAddress = sponsorKeypair.publicKey();

    // 3. Load Sponsor Account sequence number
    console.log('[Stellar/Claim] Loading sponsor account...');
    const txAccount = await loadStellarAccount(sponsorAddress);

    // 4. Build Soroban transaction
    const server = new SorobanRpc.Server(STELLAR_RPC_URL);
    const contract = new Contract(STELLAR_CCTP_FORWARDER);
    const tx = new TransactionBuilder(txAccount, {
      fee: '100000', // start with high fee limit, simulation will update it
      networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
    })
      .addOperation(
        contract.call(
          'mint_and_forward',
          xdr.ScVal.scvBytes(messageBytes),
          xdr.ScVal.scvBytes(attestationBytes)
        )
      )
      .setTimeout(120)
      .build();

    // 5. Simulate transaction
    console.log('[Stellar/Claim] Simulating transaction on Soroban RPC...');
    const sim = await server.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(sim)) {
      throw new Error(`Soroban simulation failed: ${sim.error}`);
    }
    console.log('[Stellar/Claim] Simulation succeeded. Assembling transaction...');
    const preppedTx = SorobanRpc.assembleTransaction(tx, sim).build();

    // 6. Sign transaction
    preppedTx.sign(sponsorKeypair);
    
    // 7. Submit to Soroban RPC
    console.log('[Stellar/Claim] Submitting transaction to Soroban RPC...');
    const submitResult = await server.sendTransaction(preppedTx);
    
    if (submitResult.status === 'ERROR') {
      throw new Error(`Soroban send failed: ${(submitResult as any).errorResultXdr || (submitResult as any).errorResult}`);
    }
    
    const stellarTxHash = submitResult.hash;
    console.log('[Stellar/Claim] Transaction submitted. Hash:', stellarTxHash);

    // 8. Poll for result
    console.log('[Stellar/Claim] Polling for execution result...');
    let attempts = 0;
    while (attempts < 10) {
      attempts++;
      const statusResult = await server.getTransaction(stellarTxHash);
      if (statusResult.status === 'SUCCESS') {
        console.log(`[Stellar/Claim] ✓ Claim transaction successful: ${stellarTxHash}`);
        return NextResponse.json({ success: true, txHash: stellarTxHash });
      } else if (statusResult.status === 'FAILED') {
        throw new Error(`Transaction execution failed on-chain: ${statusResult.resultXdr}`);
      }
      await new Promise((r) => setTimeout(r, 2000));
    }

    // If timeout, return the tx hash anyway
    return NextResponse.json({ success: true, txHash: stellarTxHash, pending: true });
  } catch (error) {
    console.error('[Stellar/Claim] Error claiming transaction:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to claim Stellar transaction' },
      { status: 500 },
    );
  }
}
