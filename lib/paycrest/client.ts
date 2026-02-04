/**
 * Paycrest API Client
 *
 * A typed client for interacting with the Paycrest API.
 * Base URL: https://api.paycrest.io/v1
 */

import type {
  PaycrestClientOptions,
  PaycrestError,
  PaycrestResponse,
} from './types';

const DEFAULT_BASE_URL = 'https://api.paycrest.io/v1';
const DEFAULT_TIMEOUT = 30000; // 30 seconds
const DEFAULT_RETRIES = 3;

export class PaycrestAPIError extends Error {
  public readonly code?: string;
  public readonly status?: number;

  constructor(message: string, code?: string, status?: number) {
    super(message);
    this.name = 'PaycrestAPIError';
    this.code = code;
    this.status = status;
  }
}

export class PaycrestClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly retries: number;

  constructor(options: PaycrestClientOptions) {
    if (!options.apiKey) {
      throw new Error('Paycrest API key is required');
    }
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl || DEFAULT_BASE_URL;
    this.timeout = options.timeout || DEFAULT_TIMEOUT;
    this.retries = options.retries ?? DEFAULT_RETRIES;
  }

  /**
   * Make an authenticated request to the Paycrest API
   */
  async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    endpoint: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        const headers: Record<string, string> = {
          'API-Key': this.apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        };

        const response = await fetch(url, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        const data = (await response.json()) as PaycrestResponse<T>;

        // Check for API-level errors
        if (!response.ok || data.status === 'error') {
          const errorData = data as PaycrestError;
          throw new PaycrestAPIError(
            errorData.message || `HTTP ${response.status}`,
            errorData.code,
            response.status,
          );
        }

        // Success response
        return (data as { status: 'success'; data: T }).data;
      } catch (error) {
        lastError = error as Error;

        // Don't retry on client errors (4xx)
        if (
          error instanceof PaycrestAPIError &&
          error.status &&
          error.status < 500
        ) {
          throw error;
        }

        // Don't retry on abort (timeout)
        if (error instanceof Error && error.name === 'AbortError') {
          throw new PaycrestAPIError('Request timed out', 'TIMEOUT');
        }

        // Wait before retrying (exponential backoff)
        if (attempt < this.retries) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    // All retries exhausted
    throw lastError || new PaycrestAPIError('Request failed after retries');
  }

  /**
   * GET request helper
   */
  async get<T>(endpoint: string): Promise<T> {
    return this.request<T>('GET', endpoint);
  }

  /**
   * POST request helper
   */
  async post<T>(endpoint: string, body: unknown): Promise<T> {
    return this.request<T>('POST', endpoint, body);
  }
}

// ===========================================
// SINGLETON INSTANCE
// ===========================================

let clientInstance: PaycrestClient | null = null;

/**
 * Get or create Paycrest client singleton
 */
export function getPaycrestClient(): PaycrestClient {
  if (!clientInstance) {
    const apiKey = process.env.PAYCREST_API_KEY;
    if (!apiKey) {
      throw new Error('PAYCREST_API_KEY environment variable is not set');
    }
    clientInstance = new PaycrestClient({ apiKey });
  }
  return clientInstance;
}

/**
 * Create a new Paycrest client (for testing or custom configs)
 */
export function createPaycrestClient(
  options: PaycrestClientOptions,
): PaycrestClient {
  return new PaycrestClient(options);
}
