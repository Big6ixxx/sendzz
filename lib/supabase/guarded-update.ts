import 'server-only';

import { supabaseAdmin } from '@/lib/supabase/adminClient';
import type { Database } from '@/types/database';

type Tables = Database['public']['Tables'];
/** Tables whose `updated_at` moves on every write, so it can stand guard over one. */
type GuardedTable = 'kyc_verifications' | 'deposits';

/**
 * The query builder, by the shape used here. Its generics do not follow a union of tables, so
 * rows are typed at this boundary instead, from the table's own Row and Update types.
 */
type Result = { data: unknown; error: { message: string } | null };
type Query = PromiseLike<Result> & {
  select(columns: string): Query;
  update(values: unknown): Query;
  eq(column: string, value: unknown): Query;
  maybeSingle(): PromiseLike<Result>;
};
const db = supabaseAdmin as unknown as { from(table: GuardedTable): Query };

/**
 * Read a row, decide its change in code, and write it only if `updated_at` has not moved since
 * the read; on a lost race, read again and decide again. The one way two writers to the same row
 * (a webhook and a poll, two webhooks) can each build on what they read without erasing the
 * other's write.
 *
 * `change` returns the columns to set, or null when the row needs nothing. Resolves "written",
 * "unchanged" or "missing" (no such row). Throws on a database error, and when the row keeps
 * changing, so a caller is never left to treat a failure as "nothing to do".
 */
export async function guardedUpdate<T extends GuardedTable>(params: {
  table: T;
  match: { column: string; value: string };
  change: (row: Tables[T]['Row']) => Tables[T]['Update'] | null;
}): Promise<'written' | 'unchanged' | 'missing'> {
  const { table, match } = params;
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: row, error: readError } = await db
      .from(table)
      .select('*')
      .eq(match.column, match.value)
      .maybeSingle();
    if (readError) throw new Error(`${table}: read failed: ${readError.message}`);
    if (!row) return 'missing';

    const current = row as Tables[T]['Row'];
    const next = params.change(current);
    if (!next) return 'unchanged';

    const { data: written, error } = await db
      .from(table)
      .update(next)
      .eq(match.column, match.value)
      .eq('updated_at', current.updated_at)
      .select('updated_at');
    if (error) throw new Error(`${table}: update failed: ${error.message}`);
    if (Array.isArray(written) && written.length) return 'written';
  }
  throw new Error(`${table}: ${match.column}=${match.value} kept changing; not updated`);
}
