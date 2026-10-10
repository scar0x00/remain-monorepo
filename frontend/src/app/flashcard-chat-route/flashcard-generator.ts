import { HttpClient } from '@angular/common/http';
import { inject, Injectable, InjectionToken } from '@angular/core';
import { Observable } from 'rxjs';
import { GenerateDeckRequest, GenerateDeckResult } from '../../types/FlashcardAgent';
import { toGenerateFormData } from './flashcard-chat.utils';

// Base URL of the flashcard API on main-backend, which forwards requests to the flashcard agent.
export const FLASHCARD_API_URL = new InjectionToken<string>('FLASHCARD_API_URL', {
  providedIn: 'root',
  factory: () => '/api/v1/flashcards',
});

@Injectable({ providedIn: 'root' })
export class FlashcardGenerator {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(FLASHCARD_API_URL);

  generate(request: GenerateDeckRequest): Observable<GenerateDeckResult> {
    const url = `${this.baseUrl}/${encodeURIComponent(request.deckName)}`;
    return this.http.post<GenerateDeckResult>(url, toGenerateFormData(request));
  }
}
