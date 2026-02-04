/**
 * Paycrest Integration Module
 *
 * Centralized exports for Paycrest API functionality.
 */

// Client
export {
    PaycrestAPIError, PaycrestClient, createPaycrestClient, getPaycrestClient
} from './client';

// Orders
export {
    createPayoutOrder,
    getPayoutOrder, getSenderStats, listPayoutOrders
} from './orders';

// Currencies
export {
    clearCurrenciesCache, getCurrencyByCode, getSupportedCurrencies
} from './currencies';

// Institutions
export {
    clearInstitutionsCache, getInstitutionByCode, getInstitutions, searchInstitutions
} from './institutions';

// Webhooks
export {
    isTerminalStatus,
    mapEventToWithdrawalStatus, parseWebhookPayload, verifyWebhookSignature
} from './webhook';

// Types
export type {
    CreateOrderRequest, CurrenciesResponse, Currency, Institution,
    InstitutionsResponse, Order, OrderStatus, OrdersListResponse, PaycrestClientOptions, PaycrestError, PaycrestResponse, RecipientDetails, SenderStats,
    WebhookEventType,
    WebhookPayload
} from './types';

