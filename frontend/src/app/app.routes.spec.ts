import { UrlSegment } from '@angular/router';
import { flashcardChatMatcher } from './app.routes';

describe('flashcardChatMatcher', () => {
  const segments = (...paths: string[]) => paths.map((path) => new UrlSegment(path, {}));

  it('matches a new conversation', () => {
    const result = flashcardChatMatcher(segments('flashcard-chat'));

    expect(result?.consumed).toHaveLength(1);
    expect(result?.posParams).toBeUndefined();
  });

  it('matches a saved conversation and exposes its id', () => {
    const result = flashcardChatMatcher(segments('flashcard-chat', 'abc-123'));

    expect(result?.consumed).toHaveLength(2);
    expect(result?.posParams?.['sessionId'].path).toBe('abc-123');
  });

  it('ignores other paths', () => {
    expect(flashcardChatMatcher(segments('deck-browse'))).toBeNull();
    expect(flashcardChatMatcher(segments('flashcard-chat', 'a', 'b'))).toBeNull();
    expect(flashcardChatMatcher([])).toBeNull();
  });
});
