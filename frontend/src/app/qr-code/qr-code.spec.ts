import { TestBed } from '@angular/core/testing';
import { QrCode } from './qr-code';

describe('QrCode', () => {
  it('draws the value as dark modules in a square SVG, with a quiet zone', async () => {
    const fixture = TestBed.createComponent(QrCode);
    fixture.componentRef.setInput('value', 'otpauth://totp/Remain:ada%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Remain');
    await fixture.whenStable();
    const svg = (fixture.nativeElement as HTMLElement).querySelector('svg')!;
    const [, , width, height] = svg.getAttribute('viewBox')!.split(' ').map(Number);
    expect(width).toBe(height);
    expect(width).toBeGreaterThanOrEqual(25);
    const path = svg.querySelector('path')!.getAttribute('d')!;
    expect(path).toMatch(/^M2 2h1v1h-1z/);
    expect(path).not.toContain('M0 0');
  });
});
