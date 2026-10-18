import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { CHAT_API_URL, ChatHistory, toChatMessage } from './chat-history';

describe('ChatHistory', () => {
  let service: ChatHistory;
  let http: HttpTestingController;

  const summary = {
    id: 'chat-1',
    title: 'Cells',
    deckName: null,
    deckKey: null,
    createdAt: '2026-10-18T00:00:00.000Z',
    updatedAt: '2026-10-18T00:00:00.000Z',
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ChatHistory);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('does not request the session list until the drawer is opened', async () => {
    TestBed.tick();

    http.expectNone('/api/v1/chats?limit=50');
    expect(service.drawerOpen()).toBe(false);

    service.openDrawer();
    TestBed.tick();

    http
      .expectOne('/api/v1/chats?limit=50')
      .flush({ sessions: [summary], nextCursor: null });
    await Promise.resolve();
    expect(service.drawerOpen()).toBe(true);
    expect(service.sessions.value()?.sessions).toEqual([summary]);
  });

  it('creates a session', () => {
    let result: unknown;
    service.create().subscribe((value) => (result = value));

    const req = http.expectOne('/api/v1/chats');
    expect(req.request.method).toBe('POST');
    req.flush(summary, { status: 201, statusText: 'Created' });

    expect(result).toEqual(summary);
  });

  it('loads a session with its messages converted for the chat', () => {
    let result: any;
    service.detail('chat-1').subscribe((value) => (result = value));

    http.expectOne('/api/v1/chats/chat-1').flush({
      ...summary,
      deckExists: true,
      messages: [
        {
          id: 'm1',
          role: 'user',
          state: 'done',
          text: 'hi',
          attachments: [{ name: 'a.pdf', size: 1 }],
          deckName: null,
          cardCount: null,
        },
        {
          id: 'm2',
          role: 'assistant',
          state: 'done',
          text: 'Created 5 flashcards in biology.',
          attachments: [],
          deckName: 'biology',
          cardCount: 5,
        },
      ],
    });

    expect(result.deckExists).toBe(true);
    expect(result.messages).toEqual([
      { id: 'm1', role: 'user', text: 'hi', attachments: [{ name: 'a.pdf', size: 1 }] },
      {
        id: 'm2',
        role: 'assistant',
        state: 'done',
        text: 'Created 5 flashcards in biology.',
        deckName: 'biology',
        cardCount: 5,
      },
    ]);
  });

  it('posts messages and returns them with their ids', () => {
    let result: unknown;
    service
      .addMessages('chat-1', [{ role: 'assistant', state: 'pending', text: 'Working…' }])
      .subscribe((value) => (result = value));

    const req = http.expectOne('/api/v1/chats/chat-1/messages');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      messages: [{ role: 'assistant', state: 'pending', text: 'Working…' }],
    });
    req.flush({
      messages: [
        {
          id: 'm1',
          role: 'assistant',
          state: 'pending',
          text: 'Working…',
          attachments: [],
          deckName: null,
          cardCount: null,
        },
      ],
    });

    expect(result).toEqual([{ id: 'm1', role: 'assistant', state: 'pending', text: 'Working…' }]);
  });

  it('renames and deletes a session', () => {
    service.rename('chat-1', 'Biology').subscribe();
    const rename = http.expectOne('/api/v1/chats/chat-1');
    expect(rename.request.method).toBe('PATCH');
    expect(rename.request.body).toEqual({ title: 'Biology' });
    rename.flush({ ...summary, title: 'Biology' });

    service.remove('chat-1').subscribe();
    const remove = http.expectOne('/api/v1/chats/chat-1');
    expect(remove.request.method).toBe('DELETE');
    remove.flush(null, { status: 204, statusText: 'No Content' });
  });

  it('refreshes the opened list after a change', async () => {
    service.openDrawer();
    TestBed.tick();
    http.expectOne('/api/v1/chats?limit=50').flush({ sessions: [], nextCursor: null });
    await Promise.resolve();

    service.remove('chat-1').subscribe();
    http.expectOne('/api/v1/chats/chat-1').flush(null, { status: 204, statusText: 'No Content' });
    TestBed.tick();

    http
      .expectOne('/api/v1/chats?limit=50')
      .flush({ sessions: [], nextCursor: null });
  });

  it('uses the base URL from the CHAT_API_URL token', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: CHAT_API_URL, useValue: 'https://api.example.com/chats' },
      ],
    });
    const custom = TestBed.inject(ChatHistory);
    const testing = TestBed.inject(HttpTestingController);

    custom.detail('chat-1').subscribe();
    testing.expectOne('https://api.example.com/chats/chat-1').flush({ messages: [] });
    testing.verify();
  });

  it('drops empty deck fields from assistant messages', () => {
    expect(
      toChatMessage({
        id: 'm1',
        role: 'assistant',
        state: 'error',
        text: 'failed',
        attachments: [],
        deckName: null,
        cardCount: null,
      }),
    ).toEqual({ id: 'm1', role: 'assistant', state: 'error', text: 'failed' });
  });
});
