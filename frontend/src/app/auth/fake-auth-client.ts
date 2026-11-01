import { type RemainAuthClient } from './auth-client';

type Result = { data?: unknown; error?: { message?: string; code?: string; status?: number } | null };

/** A stand-in for the better-auth client in specs. Set the next results, read the calls. */
export function createFakeAuthClient(session: { user: Record<string, unknown> } | null = null) {
  const calls: [string, unknown][] = [];
  const results: Record<string, Result> = {};
  const call = (name: string) => async (input?: unknown) => {
    calls.push([name, input]);
    return results[name] ?? { data: null, error: null };
  };
  const state = { session };

  const client = {
    getSession: async () => {
      calls.push(['getSession', undefined]);
      return { data: state.session, error: null };
    },
    signUp: { email: call('signUp.email') },
    signIn: { email: call('signIn.email'), social: call('signIn.social'), passkey: call('signIn.passkey') },
    signOut: call('signOut'),
    sendVerificationEmail: call('sendVerificationEmail'),
    requestPasswordReset: call('requestPasswordReset'),
    resetPassword: call('resetPassword'),
    twoFactor: {
      enable: call('twoFactor.enable'),
      disable: call('twoFactor.disable'),
      verifyTotp: call('twoFactor.verifyTotp'),
      verifyOtp: call('twoFactor.verifyOtp'),
      verifyBackupCode: call('twoFactor.verifyBackupCode'),
      sendOtp: call('twoFactor.sendOtp'),
      generateBackupCodes: call('twoFactor.generateBackupCodes'),
    },
    passkey: {
      listUserPasskeys: call('passkey.listUserPasskeys'),
      addPasskey: call('passkey.addPasskey'),
      updatePasskey: call('passkey.updatePasskey'),
      deletePasskey: call('passkey.deletePasskey'),
    },
  };
  return { client: client as unknown as RemainAuthClient, calls, results, state };
}

export const ADA = { id: 'u1', name: 'Ada', email: 'ada@example.com', emailVerified: true };
