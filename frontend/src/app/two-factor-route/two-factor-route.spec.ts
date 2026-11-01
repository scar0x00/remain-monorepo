import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { AUTH_CLIENT } from '../auth/auth-client';
import { ADA, createFakeAuthClient } from '../auth/fake-auth-client';
import { TwoFactorRoute } from './two-factor-route';

describe('TwoFactorRoute', () => {
  const settle = async (fixture: { whenStable(): Promise<unknown> }) => {
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
  };

  const setup = async (methods: string, returnTo = '/dashboard') => {
    const fake = createFakeAuthClient();
    TestBed.configureTestingModule({
      imports: [TwoFactorRoute],
      providers: [provideRouter([]), { provide: AUTH_CLIENT, useValue: fake.client }],
    });
    const fixture = TestBed.createComponent(TwoFactorRoute);
    fixture.componentRef.setInput('methods', methods);
    fixture.componentRef.setInput('returnTo', returnTo);
    await fixture.whenStable();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const el = fixture.nativeElement as HTMLElement;
    const button = (text: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(text));
    const enter = async (code: string) => {
      const input = el.querySelector('#two-factor-code') as HTMLInputElement;
      input.value = code;
      input.dispatchEvent(new Event('input'));
      el.querySelector('form')!.dispatchEvent(new Event('submit'));
      await settle(fixture);
    };
    return { ...fake, fixture, el, button, enter, navigate };
  };

  it('asks for the authenticator app code first, then goes where the user was heading', async () => {
    const { el, enter, calls, state, navigate } = await setup('totp,otp');
    expect(el.textContent).toContain('authenticator app');
    state.session = { user: ADA };
    await enter('123456');
    expect(calls).toContainEqual(['twoFactor.verifyTotp', { code: '123456', trustDevice: false }]);
    expect(navigate).toHaveBeenCalledWith('/dashboard');
  });

  it('switches to a backup code', async () => {
    const { fixture, button, enter, calls } = await setup('totp,otp');
    button('Use a backup code')!.click();
    await settle(fixture);
    await enter('abcde-fghij');
    expect(calls).toContainEqual(['twoFactor.verifyBackupCode', { code: 'abcde-fghij', trustDevice: false }]);
  });

  it('emails a code only when asked, then verifies it', async () => {
    const { fixture, el, button, enter, calls } = await setup('otp');
    expect(calls.some(([name]) => name === 'twoFactor.sendOtp')).toBe(false);
    expect(button('Use a backup code')).toBeUndefined();

    button('Email me a code')!.click();
    await settle(fixture);
    expect(calls).toContainEqual(['twoFactor.sendOtp', undefined]);
    expect(el.textContent).toContain('works for 5 minutes');
    await enter('654321');
    expect(calls).toContainEqual(['twoFactor.verifyOtp', { code: '654321', trustDevice: false }]);
  });

  it('trusts this browser when asked', async () => {
    const { fixture, el, enter, calls } = await setup('totp');
    (el.querySelector('input[type=checkbox]') as HTMLInputElement).click();
    await settle(fixture);
    await enter('123456');
    expect(calls).toContainEqual(['twoFactor.verifyTotp', { code: '123456', trustDevice: true }]);
  });

  it('sends the user back to sign in when the pending sign-in expired', async () => {
    const { el, enter, results, navigate } = await setup('totp');
    results['twoFactor.verifyTotp'] = { error: { code: 'INVALID_TWO_FACTOR_COOKIE', status: 401 } };
    await enter('123456');
    expect(el.querySelector('[role=alert]')?.textContent).toContain('This sign-in has expired');
    expect(el.querySelector('[role=alert] a')?.getAttribute('href')).toBe('/login?returnTo=%2Fdashboard');
    expect(navigate).not.toHaveBeenCalled();
  });
});
