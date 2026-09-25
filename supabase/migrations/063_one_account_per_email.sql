-- One account per email address, enforced by the database rather than by convention.
--
-- Three accounts existed twice, differing only by the capitalisation of their email. Every
-- write path in the app normalises — ensureUserRecord and writeUserAddresses both lowercase,
-- and lib/auth/session.ts lowercases whatever Privy returns — so the duplicates are residue
-- from a path that has since been fixed rather than an ongoing leak.
--
-- But normalising in application code is a convention, and a convention holds only as long as
-- every future write path remembers it. `users.email` has a plain UNIQUE, and Postgres text
-- comparison is case-sensitive, so 'Foo@gmail.com' and 'foo@gmail.com' were two different
-- values as far as the constraint was concerned. `contacts` has had a lower(email) unique index
-- since migration 005; the table that actually identifies people did not.
--
-- What the duplicates cost, so the reason for this index is on the record: the capitalised row
-- is unreachable, because every login resolves to the lowercase spelling. Deposits and received
-- transfers filed under it are missing from its owner's history — in the worst case 148 USDC of
-- deposits invisible to the person who made them. Both rows shared one wallet, so no money was
-- ever at risk, but the same on-chain transfer was recorded twice under two ids, because the
-- scanner de-duplicates on (user_id, tx_hash) and that pair does not collide across rows.
--
-- APPLYING THIS TO A DATABASE THAT STILL HAS DUPLICATES WILL FAIL, and that is the intended
-- behaviour: it refuses rather than silently doing nothing. Merge them first — see
-- merge_case_duplicate() — then run this. To check before applying:
--
--     select lower(email), count(*) from public.users group by 1 having count(*) > 1;
--
-- A fresh database built from these migrations has no rows and no duplicates, so the index
-- simply builds.

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_key
  ON public.users (lower(btrim(email)));

-- Same argument, same table of record. user_profiles is keyed by id and carries its own UNIQUE
-- on email, equally case-sensitive, and it holds the PIN and the TOTP secret — so a second row
-- under a different casing is a second set of credentials for one person.
CREATE UNIQUE INDEX IF NOT EXISTS user_profiles_email_lower_key
  ON public.user_profiles (lower(btrim(email)));

COMMENT ON INDEX public.users_email_lower_key IS
  'One account per address, case-insensitively. Application code also normalises; this is what makes that reliable rather than customary.';
