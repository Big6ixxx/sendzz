import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const db = vi.hoisted(() => ({
  users: [] as Record<string, string>[],
  asked: [] as { column: string; values: string[] }[],
  error: null as null | { message: string },
}));
vi.mock('./adminClient', () => ({
  supabaseAdmin: {
    from: () => {
      let hit: Record<string, string>[] = [];
      const q = {
        select: () => q,
        in: (column: string, values: string[]) => {
          db.asked.push({ column, values });
          hit = db.users.filter((u) => values.includes(u[column]));
          return q;
        },
        limit: async () => (db.error ? { data: null, error: db.error } : { data: hit, error: null }),
      };
      return q;
    },
  },
}));

const { accountForAddress } = await import('./address-owner');

const EVM = '0x52908400098527886E0F7030069857D2E4169EE7';
const STELLAR = 'GCMG3EVLUQ5WXQKXHMHLTHXF7HJ4UK2T6MLU3YQRSCUKNQ5RFCPHPDS7';
const SOLANA = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';

beforeEach(() => {
  db.users = [];
  db.asked = [];
  db.error = null;
});

describe('accountForAddress', () => {
  it('finds the owner of an EVM address typed in lowercase, stored checksummed', async () => {
    db.users = [{ id: 'u2', email: 'bola@example.com', smart_account_address: EVM }];
    await expect(accountForAddress(EVM.toLowerCase())).resolves.toEqual(db.users[0]);
    expect(db.asked[0]).toEqual({ column: 'smart_account_address', values: [EVM.toLowerCase(), EVM] });
  });

  it('matches Stellar and Solana addresses exactly, case and all', async () => {
    db.users = [
      { id: 'u3', email: 'c@example.com', stellar_address: STELLAR },
      { id: 'u4', email: 'd@example.com', solana_address: SOLANA },
    ];
    await expect(accountForAddress(STELLAR)).resolves.toMatchObject({ id: 'u3' });
    await expect(accountForAddress(SOLANA)).resolves.toMatchObject({ id: 'u4' });
    await expect(accountForAddress(SOLANA.toLowerCase())).resolves.toBeNull();
  });

  it('is null for an outside address, an email, or a failed lookup', async () => {
    await expect(accountForAddress(EVM)).resolves.toBeNull();
    await expect(accountForAddress('bola@example.com')).resolves.toBeNull();
    db.users = [{ id: 'u2', email: 'bola@example.com', smart_account_address: EVM }];
    db.error = { message: 'db down' };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(accountForAddress(EVM)).resolves.toBeNull();
  });

  it('links no one when two accounts claim the same address', async () => {
    db.users = [
      { id: 'u2', email: 'a@example.com', smart_account_address: EVM },
      { id: 'u5', email: 'b@example.com', smart_account_address: EVM },
    ];
    await expect(accountForAddress(EVM)).resolves.toBeNull();
  });
});
