import { HttpClient } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { StudyAnswer, StudySession } from '../../types/StudySession';

const API = '/api/v1/study-sessions';
const MAX_ATTEMPTS = 4;
const RETRY_DELAY_MS = 1000;

/**
 * Records one study run. Provide it on the study component so each run gets its own instance.
 * Saving is best effort: failures set `saveFailed` and never throw into the study flow.
 */
@Injectable()
export class StudySessionService {
  private readonly http = inject(HttpClient);

  private sessionId: Promise<string | null> | null = null;
  private resolvedId: string | null = null;
  private pending: StudyAnswer[] = [];
  private flushing: Promise<void> | null = null;

  readonly saveFailed = signal(false);

  start(deckName: string, deckEtag: string | null, cardTotal: number) {
    this.pending = [];
    this.resolvedId = null;
    this.saveFailed.set(false);
    this.sessionId = firstValueFrom(
      this.http.post<{ id: string }>(API, { deckName, deckEtag, cardTotal }),
    )
      .then((r) => (this.resolvedId = r.id))
      .catch(() => {
        this.saveFailed.set(true);
        return null;
      });
  }

  recordAnswer(answer: StudyAnswer) {
    this.pending.push(answer);
    void this.flush();
  }

  /** Sends queued answers; calls made while a flush runs share it, then a follow-up covers the rest. */
  flush(): Promise<void> {
    this.flushing ??= this.drain().finally(() => (this.flushing = null));
    return this.flushing;
  }

  private async drain() {
    const id = await this.sessionId;
    while (id && this.pending.length) {
      const batch = this.pending.slice();
      if (!(await this.sendWithRetry(id, batch))) {
        this.saveFailed.set(true);
        return;
      }
      this.pending.splice(0, batch.length);
    }
  }

  private async sendWithRetry(id: string, answers: StudyAnswer[]) {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        await firstValueFrom(this.http.post(`${API}/${id}/answers`, { answers }));
        return true;
      } catch {
        if (attempt < MAX_ATTEMPTS) {
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
        }
      }
    }
    return false;
  }

  async finish(): Promise<StudySession | null> {
    await this.flush();
    const id = await this.sessionId;
    if (!id) return null;
    try {
      return await firstValueFrom(this.http.post<StudySession>(`${API}/${id}/finish`, {}));
    } catch {
      this.saveFailed.set(true);
      return null;
    }
  }

  /** Last completed run of the deck other than `excludeId`, for the end-screen comparison. */
  async previousRun(deckName: string, excludeId: string): Promise<StudySession | null> {
    try {
      const { sessions } = await firstValueFrom(
        this.http.get<{ sessions: StudySession[] }>(API, { params: { deckName, limit: 5 } }),
      );
      return sessions.find((s) => s.id !== excludeId && s.status === 'completed') ?? null;
    } catch {
      return null;
    }
  }

  /** Best-effort send of unsent answers when the page is going away. */
  flushOnPageHide() {
    const id = this.resolvedId;
    if (!id || !this.pending.length) return;
    void fetch(`${API}/${id}/answers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answers: this.pending }),
      keepalive: true,
    }).catch(() => undefined);
  }
}
