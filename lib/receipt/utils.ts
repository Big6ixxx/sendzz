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
        orderId: activity.txHash,
        fiatCurrency: activity.fiatCurrency,
        fiatPayoutAmount: activity.fiatAmount,
        exchangeRate: activity.exchangeRate,
      };
    case 'bridge':
      return {
        ...base,
        sourceChain: activity.details.replace('From: ', ''),
      };
    default:
      return base;
  }
}
