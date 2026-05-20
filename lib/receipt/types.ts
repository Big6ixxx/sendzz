export interface ReceiptData {
  id: string;
  type: 'sent' | 'received' | 'deposit' | 'withdrawal' | 'bridge';
  status: string;
  timestamp: string;
  amountUsdc: number;

  // Transfers
  senderEmail?: string;
  recipientEmail?: string;
  note?: string;
  txHash?: string;

  // Deposits / Withdrawals
  fiatAmount?: number;
  fiatCurrency?: string;
  fiatPayoutAmount?: number;
  exchangeRate?: number;
  bankAccount?: string;
  bankName?: string;
  orderId?: string;

  // Bridge
  sourceChain?: string;
  destChain?: string;
}
