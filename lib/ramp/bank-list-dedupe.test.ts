import { describe, it, expect, vi } from 'vitest';
import type { RampInstitution } from './types';

/**
 * Two providers, one bank list. A bank both providers carry appears once — whatever each calls
 * it — and the pick is mapped to the paying provider's code later (see pickBank).
 */

const bank = (name: string, code: string): RampInstitution => ({ name, code, institutionCode: code, currency: 'NGN' });

const BITNOB = [
  bank('Guaranty Trust Bank', '000013'),
  bank('Kuda Bank', '090267'),
  bank('Access Bank', '000014'),
  bank('Access Bank', '000014'),
  bank('Access Bank (Diamond)', '000005'),
];
const PAYCREST = [
  bank('GTBank Plc', 'GTBINGLA'),
  bank('Kuda Microfinance Bank', 'KUDANGPC'),
  bank('Moniepoint MFB', 'MONINGPC'),
];

const fake = (name: string, list: RampInstitution[]) =>
  class {
    name = name;
    capabilities = { institutions: true };
    getInstitutions = async () => ({ data: list });
  };

vi.mock('./providers/bitnob', () => ({ BitnobProvider: fake('bitnob', BITNOB) }));
vi.mock('./providers/paycrest', () => ({ PaycrestProvider: fake('paycrest', PAYCREST) }));

const { Ramp } = await import('./index');

describe('the merged bank list', () => {
  it('lists each bank once, keeping the first provider\'s entry', async () => {
    const names = (await Ramp.getInstitutions('NGN')).data.map((b) => `${b.name}:${b.code}`);
    expect(names).toEqual([
      'Guaranty Trust Bank:000013',
      'Kuda Bank:090267',
      'Access Bank:000014',
      'Access Bank (Diamond):000005',
      'Moniepoint MFB:MONINGPC',
    ]);
  });
});
