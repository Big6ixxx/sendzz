import { Activity } from '@/components/HistoryModule';
import { ReceiptData } from './types';

export function activityToReceiptData(activity: Activity): ReceiptData {
  const base: ReceiptData = {
    id: activity.id,
    type: activity.type,
    status: activity.status,
    timestamp: activity.timestamp,
    amountUsdc: activity.amount,
    txHash: activity.txHash,
    note: activity.note,
  };

  switch (activity.type) {
    case 'sent':
      return {
        ...base,
        senderEmail: activity.senderEmail,
        recipientEmail: activity.details.replace('To: ', ''),
      };
    case 'received':
      return {
        ...base,
        senderEmail: activity.details.replace('From: ', ''),
      };
    case 'deposit': {
      const fiatCurrency = activity.fiatCurrency ?? activity.details.replace('Via: ', '').replace(' Gateway', '');
      return {
        ...base,
        fiatCurrency,
        fiatAmount: activity.fiatAmount,
        orderId: activity.txHash,
      };
    }
    case 'withdrawal':
      return {
        ...base,
        bankAccount: activity.details.replace('To: ', ''),
        // The provider's order reference, NOT the on-chain hash. Falling back to `txHash` put
        // the blockchain hash under "Order ID" — printed twice, and neither row correct.
        orderId: activity.providerOrderId ?? activity.txHash,
        fiatCurrency: activity.fiatCurrency,
        fiatPayoutAmount: activity.fiatAmount,
        exchangeRate: activity.exchangeRate,
        sourceChain: activity.settlementNetwork ?? activity.sourceChain,
      };
    case 'bridge':
      return {
        ...base,
        sourceChain: activity.details.replace('From: ', ''),
        burnTxHash: activity.txHash,
        mintTxHash: activity.mintTxHash,
      };
    default:
      return base;
  }
}
