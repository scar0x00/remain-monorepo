import { type Auth } from "./auth";

export type SecurityStatus = {
  /** 2FA is on: email + password sign-in asks for a code (authenticator app, email or backup code). */
  twoFactorEnabled: boolean;
  /** An authenticator app is set up and confirmed, so backup codes exist too. */
  authenticatorApp: boolean;
  /** The account has a password. Turning 2FA on or off and new backup codes then need it. */
  hasPassword: boolean;
};

/**
 * What the security settings page needs and better-auth's client can't tell: whether the user has
 * a confirmed authenticator app and a password. Reads Postgres, so only that page calls it.
 */
export async function securityStatus(auth: Auth, userId: string): Promise<SecurityStatus> {
  const { internalAdapter, adapter } = await auth.$context;
  const [user, accounts, totp] = await Promise.all([
    internalAdapter.findUserById(userId) as Promise<{ twoFactorEnabled?: boolean | null } | null>,
    internalAdapter.findAccounts(userId),
    adapter.findOne<{ verified?: boolean | null }>({ model: "twoFactor", where: [{ field: "userId", value: userId }] }),
  ]);
  return {
    twoFactorEnabled: Boolean(user?.twoFactorEnabled),
    // better-auth treats a missing `verified` (rows from before the column) as confirmed.
    authenticatorApp: Boolean(user?.twoFactorEnabled && totp && totp.verified !== false),
    hasPassword: accounts.some((account) => account.providerId === "credential"),
  };
}
