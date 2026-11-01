import { passkey } from "@better-auth/passkey";
import { type BetterAuthOptions, type SecondaryStorage, betterAuth } from "better-auth";
import { twoFactor } from "better-auth/plugins";
import { Pool } from "pg";
import { TWO_FACTOR_CODE_MINUTES, resetPasswordEmail, sendMail, twoFactorCodeEmail, verificationEmail } from "./email";
import { createSecondaryStorage } from "./session-storage";
import { type Bindings } from "../types";

/** Under the existing `remain.scar0x00.click/api/v1/*` worker route and the dev proxy. */
export const AUTH_BASE_PATH = "/api/v1/auth";

/**
 * How long a signed session cookie is trusted without asking the session store. It is also the
 * longest a revoked session (sign-out elsewhere, password reset) keeps working on another device.
 * Sensitive better-auth endpoints (password change, account deletion, ...) always bypass the cache.
 */
export const SESSION_COOKIE_CACHE_SECONDS = 5 * 60;

/** Bump to invalidate every cached session cookie at once, e.g. after a secret leak. */
const SESSION_COOKIE_CACHE_VERSION = "1";

export type AuthEnv = Pick<
  Bindings,
  | "PG"
  | "EMAIL"
  | "DEV_LOG_EMAILS"
  | "BETTER_AUTH_SECRET"
  | "BETTER_AUTH_URL"
  | "GITHUB_CLIENT_ID"
  | "GITHUB_CLIENT_SECRET"
  | "UPSTASH_REDIS_REST_URL"
  | "UPSTASH_REDIS_REST_TOKEN"
>;

export type AuthOverrides = {
  /** Defaults to a `pg` Pool on Hyperdrive. Tests pass an in-memory adapter. */
  database?: BetterAuthOptions["database"];
  /** Defaults to Upstash when configured. */
  secondaryStorage?: SecondaryStorage;
  /** Keeps emails sending after the response is returned (`ctx.waitUntil` on Workers). */
  waitUntil?: (promise: Promise<unknown>) => void;
};

export function authOptions(env: AuthEnv, overrides: AuthOverrides = {}) {
  const secondaryStorage = "secondaryStorage" in overrides ? overrides.secondaryStorage : createSecondaryStorage(env);
  const github =
    env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
      ? { github: { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET } }
      : undefined;

  const site = new URL(env.BETTER_AUTH_URL);

  return {
    appName: "Remain",
    baseURL: env.BETTER_AUTH_URL,
    basePath: AUTH_BASE_PATH,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [site.origin],
    database: overrides.database,
    secondaryStorage,
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 10,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => sendMail(env, resetPasswordEmail(user, url)),
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60,
      sendVerificationEmail: async ({ user, url }) => sendMail(env, verificationEmail(user, url)),
    },
    ...(github && { socialProviders: github }),
    account: {
      // A GitHub sign-in with the same, GitHub-verified email joins the existing account.
      accountLinking: { enabled: true, trustedProviders: ["github"] },
    },
    session: {
      cookieCache: {
        enabled: true,
        maxAge: SESSION_COOKIE_CACHE_SECONDS,
        // Encrypted, so the cookie doesn't expose the user's email if it ever leaks into a log.
        strategy: "jwe",
        // Never extend the cache without asking the store: that would make revocation impossible.
        refreshCache: false,
        version: SESSION_COOKIE_CACHE_VERSION,
      },
      // With Upstash, it is the authority for sessions: lookups never read Postgres. Postgres keeps
      // a row per session (written on sign-in, refresh and sign-out only) for auditing.
      storeSessionInDatabase: true,
      preserveSessionInDatabase: true,
    },
    rateLimit: {
      enabled: true,
      // Counters must be shared by every isolate; memory is per isolate, so it's only a fallback.
      storage: secondaryStorage ? "secondary-storage" : "memory",
      window: 60,
      max: 100,
      // Every sign-up and resend sends an email.
      customRules: {
        "/sign-up/email": { window: 60 * 60, max: 5 },
        "/send-verification-email": { window: 60 * 60, max: 5 },
        "/request-password-reset": { window: 60 * 60, max: 5 },
        "/sign-in/email": { window: 60, max: 10 },
        // Sends an email. The plugin's own limit (3 per 10 s for every /two-factor/* path) still
        // applies to the verify endpoints.
        "/two-factor/send-otp": { window: 10 * 60, max: 5 },
      },
    },
    advanced: {
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
      ...(overrides.waitUntil && { backgroundTasks: { handler: overrides.waitUntil } }),
    },
    plugins: [
      // Gates email + password sign-in only. GitHub (GitHub's own 2FA) and passkeys (already a
      // second factor) are not asked for a code.
      twoFactor({
        issuer: "Remain",
        // Without a password (GitHub- or passkey-only accounts) 2FA can still be managed. Accounts
        // with a password must give it.
        allowPasswordless: true,
        // Any user with 2FA on can ask for a code by email, alongside their authenticator app.
        otpOptions: {
          sendOTP: async ({ user, otp }) => sendMail(env, twoFactorCodeEmail(user, otp)),
          period: TWO_FACTOR_CODE_MINUTES,
          storeOTP: "hashed",
        },
        backupCodeOptions: { storeBackupCodes: "encrypted" },
        // On by default; stated so it isn't lost: 10 failed codes of any kind lock 2FA sign-in for
        // 15 minutes.
        accountLockout: { enabled: true },
      }),
      passkey({
        // The exact host, not the parent zone, so the passkeys are only valid on this site. Changing
        // the hostname later invalidates every passkey. `localhost` in dev.
        rpID: site.hostname,
        rpName: "Remain",
        origin: site.origin,
      }),
    ],
  } satisfies BetterAuthOptions;
}

/**
 * One better-auth instance per request. A Workers isolate can't reuse a connection opened by
 * another request, so the database handle can't be cached across requests. The Pool connects
 * lazily: a request answered from the cookie cache or Upstash never opens a connection. Call
 * `close` once the response is done (under `waitUntil`).
 */
export function createAuth(env: AuthEnv, overrides: AuthOverrides = {}) {
  const pool = overrides.database ? undefined : postgres(env);
  const auth = betterAuth(authOptions(env, { ...overrides, database: overrides.database ?? pool }));
  return { auth, close: async () => void (await pool?.end()) };
}

export type Auth = ReturnType<typeof createAuth>["auth"];

function postgres(env: Pick<Bindings, "PG">) {
  // Small: Hyperdrive does the real pooling. More than 1 so a transaction can't starve a query.
  return new Pool({ connectionString: env.PG.connectionString, max: 3 });
}
