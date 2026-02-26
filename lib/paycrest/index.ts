/**
 * Paycrest Integration Module
 *
 * Centralized exports for Paycrest API functionality.
 */

// Client
export {
  createPaycrestClient,
  getPaycrestClient,
  PaycrestAPIError,
  PaycrestClient,
} from './client';

// Orders
export {
  createPayoutOrder,
  getPayoutOrder,
  getSenderStats,
  listPayoutOrders,
} from './orders';

// Currencies
export {
  clearCurrenciesCache,
  getCurrencyByCode,
  getSupportedCurrencies,
} from './currencies';

// Institutions
export {
  clearInstitutionsCache,
  getInstitutionByCode,
  getInstitutions,
  searchInstitutions,
} from './institutions';

// Webhooks
export {
  isTerminalStatus,
  mapEventToWithdrawalStatus,
  parseWebhookPayload,
  verifyWebhookSignature,
} from './webhook';

// Account Verification
export { verifyAccount } from './verifyAccount';

// Rates
export { clearRatesCache, getExchangeRate, type RateInfo } from './rates';

// Types
export type {
  CreateOrderRequest,
  CurrenciesResponse,
  Currency,
  Institution,
  Order,
  OrdersListResponse,
  OrderStatus,
  PaycrestClientOptions,
  PaycrestError,
  PaycrestResponse,
  RecipientDetails,
  SenderStats,
  VerifyAccountRequest,
  VerifyAccountResponse,
  WebhookEventType,
  WebhookPayload,
} from './types';

