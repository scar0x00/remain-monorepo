import { Component, computed, input } from '@angular/core';
import { encode } from 'uqr';

/**
 * A QR code drawn as one SVG path, in the browser: the value (an authenticator `otpauth://` URI)
 * holds a secret, so it never goes to a QR service. Always dark on white, which every scanner reads.
 */
@Component({
  selector: 'app-qr-code',
  template: `
    <svg role="img" [attr.aria-label]="label()" [attr.viewBox]="viewBox()" class="block size-full rounded-lg bg-white" shape-rendering="crispEdges">
      <path [attr.d]="path()" fill="#000" />
    </svg>
  `,
  host: { class: 'block' },
})
export class QrCode {
  readonly value = input.required<string>();
  readonly label = input('QR code');

  private readonly qr = computed(() => encode(this.value(), { border: 2, ecc: 'M' }));
  protected readonly viewBox = computed(() => `0 0 ${this.qr().size} ${this.qr().size}`);
  protected readonly path = computed(() => {
    const { data } = this.qr();
    let d = '';
    data.forEach((row, y) => row.forEach((dark, x) => (d += dark ? `M${x} ${y}h1v1h-1z` : '')));
    return d;
  });
}
