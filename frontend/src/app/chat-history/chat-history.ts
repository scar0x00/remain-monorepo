import { HttpClient, httpResource } from '@angular/common/http';
import { inject, Injectable, InjectionToken, signal } from '@angular/core';
import { map, Observable, tap } from 'rxjs';
import { ChatMessage } from '../../types/ChatMessage';
import {
  ChatSessionDetail,
  ChatSessionPage,
  ChatSessionSummary,
  NewChatMessage,
  StoredChatMessage,
} from '../../types/ChatSession';

// Base URL of the saved-conversation API on main-backend.
export const CHAT_API_URL = new InjectionToken<string>('CHAT_API_URL', {
  providedIn: 'root',
  factory: () => '/api/v1/chats',
});

const LIST_LIMIT = 50;

type StoredSessionDetail = Omit<ChatSessionDetail, 'messages'> & { messages: StoredChatMessage[] };

export function toChatMessage(stored: StoredChatMessage): ChatMessage {
  if (stored.role === 'user') {
    return {
      id: stored.id,
      role: 'user',
      text: stored.text,
      attachments: stored.attachments,
    };
  }

  return {
    id: stored.id,
    role: 'assistant',
    state: stored.state,
    text: stored.text,
    ...(stored.deckName ? { deckName: stored.deckName } : {}),
    ...(stored.cardCount !== null ? { cardCount: stored.cardCount } : {}),
  };
}

@Injectable({ providedIn: 'root' })
export class ChatHistory {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(CHAT_API_URL);

  // Whether the sessions drawer in the nav bar is open.
  readonly drawerOpen = signal(false);
  private readonly everOpened = signal(false);

  // The most recent sessions, newest first. Not requested until the drawer is first opened, then
  // refreshed after every change made through this service.
  readonly sessions = httpResource<ChatSessionPage>(() =>
    this.everOpened() ? `${this.baseUrl}?limit=${LIST_LIMIT}` : undefined,
  );

  openDrawer() {
    if (this.everOpened()) {
      this.refresh();
    }
    this.everOpened.set(true);
    this.drawerOpen.set(true);
  }

  create(): Observable<ChatSessionSummary> {
    return this.http
      .post<ChatSessionSummary>(this.baseUrl, {})
      .pipe(tap(() => this.refresh()));
  }

  detail(id: string): Observable<ChatSessionDetail> {
    return this.http.get<StoredSessionDetail>(this.url(id)).pipe(
      map((detail) => ({ ...detail, messages: detail.messages.map(toChatMessage) })),
    );
  }

  // Saves messages in order and returns them with their server ids.
  addMessages(id: string, messages: NewChatMessage[]): Observable<ChatMessage[]> {
    return this.http
      .post<{ messages: StoredChatMessage[] }>(`${this.url(id)}/messages`, { messages })
      .pipe(
        tap(() => this.refresh()),
        map((response) => response.messages.map(toChatMessage)),
      );
  }

  rename(id: string, title: string): Observable<ChatSessionSummary> {
    return this.http
      .patch<ChatSessionSummary>(this.url(id), { title })
      .pipe(tap(() => this.refresh()));
  }

  // Deletes the conversation only; the deck it produced stays.
  remove(id: string): Observable<void> {
    return this.http.delete<void>(this.url(id)).pipe(tap(() => this.refresh()));
  }

  refresh() {
    this.sessions.reload();
  }

  private url(id: string) {
    return `${this.baseUrl}/${encodeURIComponent(id)}`;
  }
}
