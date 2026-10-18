import { HttpClient, HttpHeaders } from '@angular/common/http';
import { inject, Injectable, InjectionToken } from '@angular/core';
import { Observable } from 'rxjs';
import { GenerateDeckRequest, GenerateDeckResult } from '../../types/FlashcardAgent';
import { toGenerateFormData } from './flashcard-chat.utils';

// Base URL of the flashcard API on main-backend, which forwards requests to the flashcard agent.
export const FLASHCARD_API_URL = new InjectionToken<string>('FLASHCARD_API_URL', {
  providedIn: 'root',
  factory: () => '/api/v1/flashcards',
});

// The saved pending assistant message that a generate request settles.
export interface SavedChatTurn {
  sessionId: string;
  messageId: string;
}

@Injectable({ providedIn: 'root' })
export class FlashcardGenerator {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(FLASHCARD_API_URL);

  // With `chat`, main-backend also records the outcome on that saved assistant message, so the
  // conversation is complete even if this tab is closed before the deck is ready.
  generate(request: GenerateDeckRequest, chat?: SavedChatTurn): Observable<GenerateDeckResult> {
    const url = `${this.baseUrl}/${encodeURIComponent(request.deckName)}`;
    const headers = chat
      ? new HttpHeaders({
          'x-chat-session-id': chat.sessionId,
          'x-chat-message-id': chat.messageId,
          'x-chat-refine': String(request.refine),
        })
      : undefined;
    return this.http.post<GenerateDeckResult>(url, toGenerateFormData(request), { headers });
  }
}
