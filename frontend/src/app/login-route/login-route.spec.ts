import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { AUTH_CLIENT } from '../auth/auth-client';
import { ADA, createFakeAuthClient } from '../auth/fake-auth-client';
import { LoginRoute } from './login-route';

describe('LoginRoute', () => {
  const setup = async (returnTo?: string) => {
    const fake = createFakeAuthClient();
    TestBed.configureTestingModule({
      imports: [LoginRoute],
      providers: [provideRouter([]), { provide: AUTH_CLIENT, useValue: fake.client }],
    });
    const fixture = TestBed.createComponent(LoginRoute);
    if (returnTo) fixture.componentRef.setInput('returnTo', returnTo);
    await fixture.whenStable();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const el = fixture.nativeElement as HTMLElement;
    const type = (selector: string, value: string) => {
      const input = el.querySelector(selector) as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    };
    const submit = async () => {
      el.querySelector('form')!.dispatchEvent(new Event('submit'));
      await new Promise((resolve) => setTimeout(resolve));
      await fixture.whenStable();
    };
    return { ...fake, el, type, submit, navigate };
  };

  it('signs in and goes back where the user was heading', async () => {
    const { results, calls, type, submit, navigate } = await setup('/dashboard');
    results['signIn.email'] = { data: { user: ADA } };
    type('#login-email', ' ada@example.com ');
    type('#login-password', 'secret password');
    await submit();

    expect(calls).toContainEqual(['signIn.email', { email: 'ada@example.com', password: 'secret password', callbackURL: '/verify-email' }]);
    expect(navigate).toHaveBeenCalledWith('/dashboard');
  });

  it('offers to resend the verification link when the email is not verified', async () => {
    const { results, calls, el, type, submit } = await setup();
    results['signIn.email'] = { error: { code: 'EMAIL_NOT_VERIFIED', status: 403 } };
    type('#login-email', 'ada@example.com');
    await submit();

    const resend = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Send the link again'))!;
    expect(el.querySelector('[role=alert]')?.textContent).toContain('Verify your email first');
    resend.click();
    await new Promise((resolve) => setTimeout(resolve));
    expect(calls).toContainEqual(['sendVerificationEmail', { email: 'ada@example.com', callbackURL: '/verify-email' }]);
  });

  it('ignores a returnTo that leaves the app', async () => {
    const { results, type, submit, navigate } = await setup('https://evil.example');
    results['signIn.email'] = { data: { user: ADA } };
    type('#login-email', 'ada@example.com');
    await submit();
    expect(navigate).toHaveBeenCalledWith('/deck-browse');
  });
});
