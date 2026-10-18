import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { FLASHCARD_API_URL, FlashcardGenerator } from './flashcard-generator';
import { GenerateDeckRequest } from '../../types/FlashcardAgent';

describe('FlashcardGenerator', () => {
  let service: FlashcardGenerator;
  let http: HttpTestingController;

  const request: GenerateDeckRequest = {
    deckName: 'biology',
    cardCount: 10,
    overwrite: false,
    refine: false,
    text: '',
    files: [new File(['# Cells'], 'cells.md', { type: 'text/markdown' })],
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(FlashcardGenerator);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('posts multipart form data to the flashcard API route named after the deck', () => {
    service.generate(request).subscribe();

    const req = http.expectOne('/api/v1/flashcards/biology');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toBeInstanceOf(FormData);
    expect((req.request.body as FormData).get('deckName')).toBe('biology');
    expect((req.request.body as FormData).get('cardCount')).toBe('10');
    req.flush(
      { key: 'biology.json', format: 'json', cardCount: 10 },
      { status: 201, statusText: 'Created' },
    );
  });

  it('sends no chat headers by default', () => {
    service.generate(request).subscribe();

    const req = http.expectOne('/api/v1/flashcards/biology');
    expect(req.request.headers.has('x-chat-session-id')).toBe(false);
    expect(req.request.headers.has('x-chat-message-id')).toBe(false);
    req.flush({});
  });

  it('tells main-backend which saved message to settle', () => {
    service.generate(request, { sessionId: 'chat-1', messageId: 'msg-2' }).subscribe();
    service
      .generate({ ...request, refine: true, text: 'shorter', files: [] }, {
        sessionId: 'chat-1',
        messageId: 'msg-4',
      })
      .subscribe();

    const [created, refined] = http.match('/api/v1/flashcards/biology');
    expect(created.request.headers.get('x-chat-session-id')).toBe('chat-1');
    expect(created.request.headers.get('x-chat-message-id')).toBe('msg-2');
    expect(created.request.headers.get('x-chat-refine')).toBe('false');
    expect(refined.request.headers.get('x-chat-message-id')).toBe('msg-4');
    expect(refined.request.headers.get('x-chat-refine')).toBe('true');
    created.flush({});
    refined.flush({});
  });

  it('marks a refinement in the form data', () => {
    service.generate({ ...request, refine: true, files: [], text: 'shorter' }).subscribe();

    const body = http.expectOne('/api/v1/flashcards/biology').request.body as FormData;
    expect(body.get('refine')).toBe('true');
    expect(body.get('instructions')).toBe('shorter');
  });

  it('emits the API result', () => {
    let result: unknown;
    service.generate(request).subscribe((value) => (result = value));

    http
      .expectOne('/api/v1/flashcards/biology')
      .flush(
        { key: 'biology.json', format: 'json', cardCount: 10 },
        { status: 201, statusText: 'Created' },
      );

    expect(result).toEqual({ key: 'biology.json', format: 'json', cardCount: 10 });
  });

  it('encodes the deck name in the URL', () => {
    service.generate({ ...request, deckName: 'a b_c' }).subscribe();
    http.expectOne('/api/v1/flashcards/a%20b_c').flush({});
  });

  it('uses the base URL from the FLASHCARD_API_URL token', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: FLASHCARD_API_URL,
          useValue: 'https://api.example.com/api/v1/flashcards',
        },
      ],
    });
    const custom = TestBed.inject(FlashcardGenerator);
    const testing = TestBed.inject(HttpTestingController);

    custom.generate(request).subscribe();
    testing.expectOne('https://api.example.com/api/v1/flashcards/biology').flush({});
    testing.verify();
  });
});
