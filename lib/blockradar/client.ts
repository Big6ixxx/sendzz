/**
 * BlockRadar API Client
 *
 * A typed client for interacting with the BlockRadar API.
 * Base URL: https://api.blockradar.co/v1
 */

import type {
  BlockRadarClientOptions,
  BlockRadarError,
  BlockRadarResponse,
} from './types';

const DEFAULT_BASE_URL = 'https://api.blockradar.co/v1';
const DEFAULT_TIMEOUT = 30000; // 30 seconds

export class BlockRadarAPIError extends Error {
  public readonly statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = 'BlockRadarAPIError';
    this.statusCode = statusCode;
  }
}

function isBlockRadarError<T>(
  response: BlockRadarResponse<T>,
): response is BlockRadarError {
  return (response as BlockRadarError).statusCode >= 400;
}

export class BlockRadarClient {
  private readonly apiKey: string;
  private readonly walletId: string;
  private readonly baseUrl: string;
  private readonly timeout: number;

  constructor(options: BlockRadarClientOptions) {
    this.apiKey = options.apiKey;
    this.walletId = options.walletId;
    this.baseUrl = options.baseUrl || DEFAULT_BASE_URL;
    this.timeout = options.timeout || DEFAULT_TIMEOUT;
  }

  /**
   * Make a GET request to the BlockRadar API.
   */
  async get<T>(endpoint: string): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'x-api-key': this.apiKey,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });

      const data: BlockRadarResponse<T> = await response.json();

      if (isBlockRadarError(data)) {
        throw new BlockRadarAPIError(data.message, data.statusCode);
      }

      return data.data;
    } catch (error) {
      if (error instanceof BlockRadarAPIError) {
        throw error;
      }
      if (error instanceof Error && error.name === 'AbortError') {
        throw new BlockRadarAPIError('Request timeout', 408);
      }
      throw new BlockRadarAPIError(
        error instanceof Error ? error.message : 'Unknown error',
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Make a POST request to the BlockRadar API.
   */
  async post<T>(endpoint: string, body: unknown): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const data: BlockRadarResponse<T> = await response.json();

      if (isBlockRadarError(data)) {
        throw new BlockRadarAPIError(data.message, data.statusCode);
      }

      return data.data;
    } catch (error) {
      if (error instanceof BlockRadarAPIError) {
        throw error;
      }
      if (error instanceof Error && error.name === 'AbortError') {
        throw new BlockRadarAPIError('Request timeout', 408);
      }
      throw new BlockRadarAPIError(
        error instanceof Error ? error.message : 'Unknown error',
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Get the wallet ID for this client.
   */
  getWalletId(): string {
    return this.walletId;
  }
}

// Singleton client instance
let solanaClientInstance: BlockRadarClient | null = null;

export function getBlockRadarSolanaClient(): BlockRadarClient {
  if (!solanaClientInstance) {
    const apiKey = process.env.BLOCKRADAR_API_KEY;
    const walletId = process.env.BLOCKRADAR_SOLANA_WALLET_ID;

    if (!apiKey)
      throw new Error('BLOCKRADAR_API_KEY environment variable is not set');
    if (!walletId)
      throw new Error(
        'BLOCKRADAR_SOLANA_WALLET_ID environment variable is not set',
      );

    solanaClientInstance = new BlockRadarClient({ apiKey, walletId });
  }
  return solanaClientInstance;
}

export function getBlockRadarClient(): BlockRadarClient {
  // Default backward compatible implementation
  return getBlockRadarSolanaClient();
}

/**
 * Reset the client instance (useful for testing).
 */
export function resetBlockRadarClient(): void {
  solanaClientInstance = null;
}
