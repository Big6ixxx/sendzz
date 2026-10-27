/**
 * Didit reports the issuing state as alpha-3; Brails takes alpha-2. Africa in full, plus the
 * countries our users most often hold documents from. A document from anywhere else has no
 * sender here, and the corridor falls through to the next provider rather than guessing.
 */
const ALPHA3_TO_ALPHA2: Record<string, string> = {
  DZA: 'DZ', AGO: 'AO', BEN: 'BJ', BWA: 'BW', BFA: 'BF', BDI: 'BI', CPV: 'CV', CMR: 'CM',
  CAF: 'CF', TCD: 'TD', COM: 'KM', COG: 'CG', COD: 'CD', CIV: 'CI', DJI: 'DJ', EGY: 'EG',
  GNQ: 'GQ', ERI: 'ER', SWZ: 'SZ', ETH: 'ET', GAB: 'GA', GMB: 'GM', GHA: 'GH', GIN: 'GN',
  GNB: 'GW', KEN: 'KE', LSO: 'LS', LBR: 'LR', LBY: 'LY', MDG: 'MG', MWI: 'MW', MLI: 'ML',
  MRT: 'MR', MUS: 'MU', MAR: 'MA', MOZ: 'MZ', NAM: 'NA', NER: 'NE', NGA: 'NG', RWA: 'RW',
  STP: 'ST', SEN: 'SN', SYC: 'SC', SLE: 'SL', SOM: 'SO', ZAF: 'ZA', SSD: 'SS', SDN: 'SD',
  TZA: 'TZ', TGO: 'TG', TUN: 'TN', UGA: 'UG', ZMB: 'ZM', ZWE: 'ZW',
  USA: 'US', GBR: 'GB', CAN: 'CA', IRL: 'IE', FRA: 'FR', DEU: 'DE', NLD: 'NL', BEL: 'BE',
  ITA: 'IT', ESP: 'ES', PRT: 'PT', CHE: 'CH', SWE: 'SE', NOR: 'NO', DNK: 'DK', FIN: 'FI',
  AUT: 'AT', POL: 'PL', ARE: 'AE', SAU: 'SA', QAT: 'QA', TUR: 'TR', IND: 'IN', CHN: 'CN',
  JPN: 'JP', KOR: 'KR', SGP: 'SG', MYS: 'MY', AUS: 'AU', NZL: 'NZ', BRA: 'BR', MEX: 'MX',
};

export function alpha2FromAlpha3(code: string): string | null {
  return ALPHA3_TO_ALPHA2[code.trim().toUpperCase()] ?? null;
}
