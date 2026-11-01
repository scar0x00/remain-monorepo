-- better-auth 1.7.3+ no longer writes account.issuer (added as required in 1.7.0 to 1.7.2), so the
-- NOT NULL constraint would reject every sign-up. See
-- https://www.better-auth.com/docs/guides/1-7-upgrade-guide. Accounts are identified by
-- (providerId, accountId) again. The column itself can be dropped later.
ALTER TABLE "account" ALTER COLUMN "issuer" DROP NOT NULL;
DROP INDEX IF EXISTS "account_issuer_accountId_uidx";
