/**
 * Paycrest Institutions API
 *
 * Endpoint for fetching banks/institutions per currency.
 */

import { getPaycrestClient } from './client';
import type { Institution, InstitutionsResponse } from './types';

// Cache for institutions per currency (refresh every hour)
const institutionsCache = new Map<
  string,
  {
    institutions: Institution[];
    timestamp: number;
  }
>();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

/**
 * Get supported institutions/banks for a currency
 * GET /institutions/{currency_code}
 */
export async function getInstitutions(
  currencyCode: string,
): Promise<Institution[]> {
  const cacheKey = currencyCode.toUpperCase();
  const cached = institutionsCache.get(cacheKey);

  // Return cached if still valid
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.institutions;
  }

  const client = getPaycrestClient();
  const response = await client.get<InstitutionsResponse>(
    `/institutions/${cacheKey}`,
  );

  // Update cache
  institutionsCache.set(cacheKey, {
    institutions: response.institutions,
    timestamp: Date.now(),
  });

  return response.institutions;
}

/**
 * Get a specific institution by code
 */
export async function getInstitutionByCode(
  currencyCode: string,
  institutionCode: string,
): Promise<Institution | null> {
  const institutions = await getInstitutions(currencyCode);
  return institutions.find((i) => i.code === institutionCode) || null;
}

/**
 * Search institutions by name
 */
export async function searchInstitutions(
  currencyCode: string,
  query: string,
): Promise<Institution[]> {
  const institutions = await getInstitutions(currencyCode);
  const lowerQuery = query.toLowerCase();
  return institutions.filter(
    (i) =>
      i.name.toLowerCase().includes(lowerQuery) ||
      i.code.toLowerCase().includes(lowerQuery),
  );
}

/**
 * Clear institutions cache (useful for testing)
 */
export function clearInstitutionsCache(): void {
  institutionsCache.clear();
}
