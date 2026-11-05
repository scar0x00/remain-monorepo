import { Component, input, signal } from '@angular/core';

/** Backup codes, shown once: copy or download them before leaving. */
@Component({
  selector: 'app-backup-codes',
  template: `
    <div class="flex flex-col gap-3">
      <ul class="grid grid-cols-2 gap-2 rounded-lg bg-app-bg p-4 font-mono text-sm shadow-inset" aria-label="Backup codes">
        @for (code of codes(); track code) {
          <li>{{ code }}</li>
        }
      </ul>
      <div class="flex flex-wrap gap-2">
        <button type="button" (click)="copy()"
          class="min-h-10 rounded-full border-2 border-app-border px-4 text-sm font-semibold hover:bg-app-card-hover hover:cursor-pointer">
          {{ copied() ? 'Copied' : 'Copy' }}
        </button>
        <button type="button" (click)="download()"
          class="min-h-10 rounded-full border-2 border-app-border px-4 text-sm font-semibold hover:bg-app-card-hover hover:cursor-pointer">
          Download
        </button>
      </div>
    </div>
  `,
})
export class BackupCodes {
  readonly codes = input.required<string[]>();
  protected readonly copied = signal(false);

  private text() {
    return `Remain backup codes. Each works once, in place of a code from your authenticator app.\n\n${this.codes().join('\n')}\n`;
  }

  async copy() {
    try {
      await navigator.clipboard.writeText(this.text());
      this.copied.set(true);
    } catch {
      // No clipboard access (insecure context or denied): the codes are still on screen.
    }
  }

  download() {
    const url = URL.createObjectURL(new Blob([this.text()], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'remain-backup-codes.txt';
    link.click();
    URL.revokeObjectURL(url);
  }
}
