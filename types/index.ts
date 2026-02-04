/**
 * Types Module
 *
 * Centralized exports for all TypeScript types.
 */

export {
    type AssetType, type Database, type DepositStatus, type Enums, type Json, type OtpPurpose, type Tables,
    type TablesInsert,
    type TablesUpdate, type TransferStatus, type WebhookProvider, type WithdrawalStatus,
    type WithdrawalVerificationStatus
} from './database';

// Paycrest webhook payload type for service layer
export interface WebhookPayload {
  eventId: string;
  eventType: string;
  data: {
    id: string;
    status?: string;
    fiatAmount?: string;
    [key: string]: unknown;
  };
}
