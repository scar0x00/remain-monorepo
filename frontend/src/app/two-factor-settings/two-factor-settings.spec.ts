import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { AUTH_CLIENT } from '../auth/auth-client';
import { type SecurityStatus } from '../auth/account-security.service';
import { createFakeAuthClient } from '../auth/fake-auth-client';
import { TwoFactorSettings } from './two-factor-settings';

const OFF: SecurityStatus = { twoFactorEnabled: false, authenticatorApp: false, hasPassword: true };
const URI = 'otpauth://totp/Remain:ada%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Remain&digits=6&period=30';
const CODES = ['aaaaa-11111', 'bbbbb-22222'];

describe('TwoFactorSettings', () => {
  const setup = async (status: SecurityStatus = OFF) => {
    const fake = createFakeAuthClient();
    TestBed.configureTestingModule({
      imports: [TwoFactorSettings],
      providers: [provideHttpClient(), { provide: AUTH_CLIENT, useValue: fake.client }],
    });
    const fixture = TestBed.createComponent(TwoFactorSettings);
    fixture.componentRef.setInput('status', status);
    const changed = vi.fn();
    fixture.componentInstance.changed.subscribe(changed);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const settle = async () => {
      await new Promise((resolve) => setTimeout(resolve));
      await fixture.whenStable();
    };
    const click = async (text: string) => {
      const button = [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);
      if (!button) throw new Error(`no button "${text}" in: ${el.textContent}`);
      button.click();
      await settle();
    };
    const fill = (selector: string, value: string) => {
      const input = el.querySelector(selector) as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };
    const submit = async () => {
      el.querySelector('form')!.dispatchEvent(new Event('submit'));
      await settle();
    };
    return { ...fake, fixture, el, click, fill, submit, changed };
  };

  it('sets up an authenticator app: password, QR code, first code, then the backup codes once', async () => {
    const { el, click, fill, submit, calls, results, changed } = await setup();
    results['twoFactor.enable'] = { data: { method: 'totp', totpURI: URI, backupCodes: CODES } };

    await click('Set up');
    fill('#two-factor-password', 'my password');
    await submit();
    expect(calls).toContainEqual(['twoFactor.enable', { password: 'my password' }]);
    expect(el.querySelector('app-qr-code svg')).toBeTruthy();
    expect(el.querySelector('[data-testid=totp-key]')?.textContent).toBe('JBSW Y3DP EHPK 3PXP');

    fill('#two-factor-setup-code', '123456');
    await submit();
    expect(calls).toContainEqual(['twoFactor.verifyTotp', { code: '123456' }]);
    expect(changed).toHaveBeenCalled();
    expect(el.querySelector('[aria-label="Backup codes"]')?.textContent).toContain('aaaaa-11111');

    await click('I’ve saved them');
    expect(el.textContent).not.toContain('aaaaa-11111');
  });

  it('skips the password for an account without one', async () => {
    const { click, calls, results, el } = await setup({ ...OFF, hasPassword: false });
    results['twoFactor.enable'] = { data: { method: 'totp', totpURI: URI, backupCodes: CODES } };
    await click('Set up');
    expect(calls).toContainEqual(['twoFactor.enable', {}]);
    expect(el.querySelector('#two-factor-password')).toBeNull();
  });

  it('keeps 2FA off when the first code is wrong', async () => {
    const { click, fill, submit, results, el, changed } = await setup();
    results['twoFactor.enable'] = { data: { method: 'totp', totpURI: URI, backupCodes: CODES } };
    results['twoFactor.verifyTotp'] = { error: { code: 'INVALID_CODE', status: 401 } };
    await click('Set up');
    fill('#two-factor-password', 'my password');
    await submit();
    fill('#two-factor-setup-code', '000000');
    await submit();
    expect(el.querySelector('[role=alert]')?.textContent).toContain('That code isn’t right');
    expect(changed).not.toHaveBeenCalled();
  });

  it('turns on email codes once a code from the inbox is entered', async () => {
    const { click, fill, submit, calls, changed } = await setup();
    await click('Turn on');
    expect(calls).toContainEqual(['twoFactor.sendOtp', undefined]);
    fill('#two-factor-setup-code', '654321');
    await submit();
    expect(calls).toContainEqual(['twoFactor.verifyOtp', { code: '654321' }]);
    expect(changed).toHaveBeenCalled();
  });

  it('turns everything off with the password', async () => {
    const { click, fill, submit, calls, changed } = await setup({ twoFactorEnabled: true, authenticatorApp: true, hasPassword: true });
    await click('Turn off two-step verification');
    fill('#two-factor-password', 'my password');
    await submit();
    expect(calls).toContainEqual(['twoFactor.disable', { password: 'my password' }]);
    expect(changed).toHaveBeenCalled();
  });

  it('shows new backup codes', async () => {
    const { click, fill, submit, calls, results, el } = await setup({ twoFactorEnabled: true, authenticatorApp: true, hasPassword: true });
    results['twoFactor.generateBackupCodes'] = { data: { status: true, backupCodes: ['ccccc-33333'] } };
    await click('New backup codes');
    fill('#two-factor-password', 'my password');
    await submit();
    expect(calls).toContainEqual(['twoFactor.generateBackupCodes', { password: 'my password' }]);
    expect(el.textContent).toContain('ccccc-33333');
  });
});
