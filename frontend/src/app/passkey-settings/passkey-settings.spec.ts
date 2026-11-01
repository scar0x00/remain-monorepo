import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { AUTH_CLIENT } from '../auth/auth-client';
import { createFakeAuthClient } from '../auth/fake-auth-client';
import { PasskeySettings } from './passkey-settings';

const LAPTOP = { id: 'p1', name: 'Laptop', createdAt: '2026-10-30T10:00:00Z', backedUp: true, deviceType: 'multiDevice' };

describe('PasskeySettings', () => {
  const setup = async (passkeys: unknown[] = [LAPTOP]) => {
    const fake = createFakeAuthClient();
    fake.results['passkey.listUserPasskeys'] = { data: passkeys };
    TestBed.configureTestingModule({
      imports: [PasskeySettings],
      providers: [provideHttpClient(), { provide: AUTH_CLIENT, useValue: fake.client }],
    });
    const fixture = TestBed.createComponent(PasskeySettings);
    const el = fixture.nativeElement as HTMLElement;
    const settle = async () => {
      await new Promise((resolve) => setTimeout(resolve));
      await fixture.whenStable();
    };
    await settle();
    const click = async (text: string) => {
      [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!.click();
      await settle();
    };
    return { ...fake, fixture, el, click, settle };
  };

  it('lists passkeys with their name and whether they sync', async () => {
    const { el } = await setup();
    const item = el.querySelector('[aria-label="Your passkeys"] li')!;
    expect(item.textContent).toContain('Laptop');
    expect(item.textContent).toContain('Synced');
  });

  it('renames a passkey', async () => {
    const { el, click, calls, settle } = await setup();
    await click('Rename');
    const input = el.querySelector('input[name=name]') as HTMLInputElement;
    input.value = ' Work laptop ';
    input.dispatchEvent(new Event('input'));
    el.querySelector('[aria-label="Your passkeys"] form')!.dispatchEvent(new Event('submit'));
    await settle();
    expect(calls).toContainEqual(['passkey.updatePasskey', { id: 'p1', name: 'Work laptop' }]);
  });

  it('removes a passkey only after confirming', async () => {
    const { el, click, calls } = await setup();
    await click('Remove');
    expect(calls.some(([name]) => name === 'passkey.deletePasskey')).toBe(false);
    const dialog = el.querySelector('[role=alertdialog]')!;
    expect(dialog.textContent).toContain('Remove “Laptop”?');
    [...dialog.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Remove')!.click();
    await new Promise((resolve) => setTimeout(resolve));
    expect(calls).toContainEqual(['passkey.deletePasskey', { id: 'p1' }]);
  });

  it('says so when there are none yet', async () => {
    const { el } = await setup([]);
    expect(el.textContent).toContain('No passkeys yet');
  });
});
