import { HttpErrorResponse } from '@angular/common/http';
import {
  ACCEPT_ATTRIBUTE,
  describeAgentError,
  fileExtension,
  formatFileSize,
  isSupportedFile,
  isValidDeckName,
  MAX_FILE_BYTES,
  MAX_FILES,
  MAX_INSTRUCTIONS_LENGTH,
  reviewAttachments,
  toDeckName,
  toGenerateFormData,
  validateSubmission,
} from './flashcard-chat.utils';
import { GenerateDeckRequest } from '../../types/FlashcardAgent';

function file(name: string, size = 10): File {
  const f = new File(['x'], name);
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

function request(overrides: Partial<GenerateDeckRequest> = {}): GenerateDeckRequest {
  return {
    deckName: 'biology',
    cardCount: 20,
    overwrite: false,
    refine: false,
    text: '',
    files: [file('notes.md')],
    ...overrides,
  };
}

describe('fileExtension', () => {
  it('returns the lowercased extension', () => {
    expect(fileExtension('Lecture.PDF')).toBe('pdf');
    expect(fileExtension('archive.tar.gz')).toBe('gz');
  });

  it('returns an empty string when there is no extension', () => {
    expect(fileExtension('README')).toBe('');
  });
});

describe('isSupportedFile', () => {
  it.each([
    'a.pdf',
    'b.png',
    'c.jpg',
    'd.jpeg',
    'e.webp',
    'f.gif',
    'g.txt',
    'h.md',
    'i.tex',
    'j.latex',
  ])('accepts %s', (name) => {
    expect(isSupportedFile(file(name))).toBe(true);
  });

  it.each(['deck.json', 'slides.pptx', 'essay.docx', 'noext'])('rejects %s', (name) => {
    expect(isSupportedFile(file(name))).toBe(false);
  });

  it('exposes an accept attribute built from the same list', () => {
    expect(ACCEPT_ATTRIBUTE).toContain('.pdf');
    expect(ACCEPT_ATTRIBUTE).toContain('.tex');
    expect(ACCEPT_ATTRIBUTE.split(',')).toHaveLength(10);
  });
});

describe('reviewAttachments', () => {
  it('accepts supported files and keeps their order', () => {
    const a = file('a.pdf');
    const b = file('b.md');
    const review = reviewAttachments([a, b], []);

    expect(review.accepted).toEqual([a, b]);
    expect(review.rejected).toEqual([]);
  });

  it('rejects unsupported types with a reason', () => {
    const review = reviewAttachments([file('deck.json')], []);

    expect(review.accepted).toEqual([]);
    expect(review.rejected).toEqual([{ name: 'deck.json', reason: 'Unsupported file type' }]);
  });

  it('rejects files larger than the limit', () => {
    const review = reviewAttachments([file('huge.pdf', MAX_FILE_BYTES + 1)], []);

    expect(review.accepted).toEqual([]);
    expect(review.rejected[0]?.reason).toContain('Larger than');
  });

  it('accepts a file exactly at the size limit', () => {
    const review = reviewAttachments([file('edge.pdf', MAX_FILE_BYTES)], []);
    expect(review.accepted).toHaveLength(1);
  });

  it('rejects a file that is already attached', () => {
    const existing = [file('notes.md', 42)];
    const review = reviewAttachments([file('notes.md', 42)], existing);

    expect(review.accepted).toEqual([]);
    expect(review.rejected[0]?.reason).toBe('Already attached');
  });

  it('treats same-named files with a different size as different files', () => {
    const review = reviewAttachments([file('notes.md', 99)], [file('notes.md', 42)]);
    expect(review.accepted).toHaveLength(1);
  });

  it('does not allow more than MAX_FILES attachments', () => {
    const existing = Array.from({ length: MAX_FILES - 1 }, (_, i) => file(`f${i}.txt`));
    const review = reviewAttachments([file('one.txt'), file('two.txt')], existing);

    expect(review.accepted.map((f) => f.name)).toEqual(['one.txt']);
    expect(review.rejected).toEqual([
      { name: 'two.txt', reason: `You can attach up to ${MAX_FILES} files` },
    ]);
  });
});

describe('toDeckName', () => {
  it('drops the extension and replaces unsafe characters', () => {
    expect(toDeckName('Intro to Biology (2026).pdf')).toBe('Intro-to-Biology-2026');
  });

  it('removes leading non-alphanumeric characters', () => {
    expect(toDeckName('__notes.md')).toBe('notes');
  });

  it('keeps names that are already valid', () => {
    expect(toDeckName('linear_algebra-1.tex')).toBe('linear_algebra-1');
  });

  it('produces a valid deck name for any input', () => {
    const name = toDeckName('ünïcødé file name with ' + 'x'.repeat(200) + '.pdf');
    expect(name === '' || isValidDeckName(name)).toBe(true);
    expect(name.length).toBeLessThanOrEqual(100);
  });
});

describe('isValidDeckName', () => {
  it.each(['deck', 'a', 'my-deck_2', 'A'.repeat(100)])('accepts %s', (name) => {
    expect(isValidDeckName(name)).toBe(true);
  });

  it.each(['', '-deck', 'bad name', '../etc', 'a'.repeat(101), 'deck.json'])(
    'rejects %s',
    (name) => {
      expect(isValidDeckName(name)).toBe(false);
    },
  );
});

describe('validateSubmission', () => {
  it('returns null for a valid submission with files', () => {
    expect(validateSubmission(request())).toBeNull();
  });

  it('returns null for a valid text-only submission', () => {
    expect(
      validateSubmission(request({ files: [], text: 'Photosynthesis converts light.' })),
    ).toBeNull();
  });

  it('rejects an invalid deck name', () => {
    expect(validateSubmission(request({ deckName: 'bad name' }))).toContain('Deck name must be');
  });

  it.each([0, 201, 2.5, Number.NaN])('rejects card count %s', (cardCount) => {
    expect(validateSubmission(request({ cardCount }))).toContain(
      'Card count must be between 1 and 200',
    );
  });

  it('requires files or text', () => {
    expect(validateSubmission(request({ files: [], text: '   ' }))).toBe(
      'Add a file or some text to generate flashcards from',
    );
  });

  it('limits instructions when files are attached', () => {
    const tooLong = 'x'.repeat(MAX_INSTRUCTIONS_LENGTH + 1);
    expect(validateSubmission(request({ text: tooLong }))).toContain('Instructions must be');
  });

  it('allows long source text when there are no files', () => {
    const longText = 'x'.repeat(MAX_INSTRUCTIONS_LENGTH + 1);
    expect(validateSubmission(request({ files: [], text: longText }))).toBeNull();
  });

  describe('when refining a deck', () => {
    it('accepts a text-only change without checking the deck settings', () => {
      expect(
        validateSubmission(
          request({
            refine: true,
            files: [],
            text: 'Make the answers shorter',
            deckName: 'bad name',
            cardCount: 0,
          }),
        ),
      ).toBeNull();
    });

    it('accepts files without an instruction', () => {
      expect(validateSubmission(request({ refine: true, text: '' }))).toBeNull();
    });

    it('requires an instruction or files', () => {
      expect(validateSubmission(request({ refine: true, files: [], text: '  ' }))).toBe(
        'Describe the change to make, or attach files to add material from',
      );
    });

    it('limits the instruction length even without files', () => {
      const tooLong = 'x'.repeat(MAX_INSTRUCTIONS_LENGTH + 1);
      expect(validateSubmission(request({ refine: true, files: [], text: tooLong }))).toBe(
        `Instructions must be ${MAX_INSTRUCTIONS_LENGTH} characters or fewer`,
      );
    });
  });
});

describe('toGenerateFormData', () => {
  it('sends the message as instructions when files are attached', () => {
    const a = file('a.pdf');
    const form = toGenerateFormData(request({ text: '  focus on chapter 2  ', files: [a] }));

    expect(form.get('instructions')).toBe('focus on chapter 2');
    expect(form.has('text')).toBe(false);
    expect(form.getAll('files')).toHaveLength(1);
    expect((form.get('files') as File).name).toBe('a.pdf');
  });

  it('sends the message as source text when no files are attached', () => {
    const form = toGenerateFormData(request({ files: [], text: ' some notes ' }));

    expect(form.get('text')).toBe('some notes');
    expect(form.has('instructions')).toBe(false);
    expect(form.has('files')).toBe(false);
  });

  it('omits instructions when the message is blank', () => {
    const form = toGenerateFormData(request({ text: '   ' }));
    expect(form.has('instructions')).toBe(false);
  });

  it('always includes deck settings when creating a deck', () => {
    const form = toGenerateFormData(
      request({ deckName: 'deck-1', cardCount: 15, overwrite: true }),
    );

    expect(form.get('deckName')).toBe('deck-1');
    expect(form.get('cardCount')).toBe('15');
    expect(form.get('overwrite')).toBe('true');
    expect(form.has('refine')).toBe(false);
  });

  it('marks refinements and sends the message as the instruction, even without files', () => {
    const form = toGenerateFormData(
      request({ refine: true, files: [], text: '  shorter answers  ', cardCount: 3 }),
    );

    expect(form.get('deckName')).toBe('biology');
    expect(form.get('refine')).toBe('true');
    expect(form.get('instructions')).toBe('shorter answers');
    expect(form.has('text')).toBe(false);
    expect(form.has('cardCount')).toBe(false);
    expect(form.has('overwrite')).toBe(false);
    expect(form.has('files')).toBe(false);
  });

  it('sends attachments with a refinement', () => {
    const form = toGenerateFormData(
      request({ refine: true, text: '', files: [file('chapter2.md')] }),
    );

    expect(form.get('refine')).toBe('true');
    expect(form.has('instructions')).toBe(false);
    expect((form.get('files') as File).name).toBe('chapter2.md');
  });
});

describe('formatFileSize', () => {
  it.each([
    [0, '0 B'],
    [512, '512 B'],
    [1536, '1.5 KB'],
    [5 * 1024 * 1024, '5.0 MB'],
  ])('formats %d bytes as %s', (bytes, expected) => {
    expect(formatFileSize(bytes)).toBe(expected);
  });
});

describe('describeAgentError', () => {
  it('uses the error message returned by the agent', () => {
    const error = new HttpErrorResponse({
      status: 409,
      error: { error: 'Deck biology.json already exists. Set overwrite to replace it' },
    });
    expect(describeAgentError(error)).toBe(
      'Deck biology.json already exists. Set overwrite to replace it',
    );
  });

  it('explains network failures', () => {
    const error = new HttpErrorResponse({ status: 0, error: new ProgressEvent('error') });
    expect(describeAgentError(error)).toContain('Could not reach the flashcard agent');
  });

  it('falls back to the status code when the body has no message', () => {
    const error = new HttpErrorResponse({ status: 500, error: '<html>oops</html>' });
    expect(describeAgentError(error)).toBe('The flashcard agent failed with status 500');
  });

  it('handles unknown errors', () => {
    expect(describeAgentError(new Error('boom'))).toBe(
      'Something went wrong while generating flashcards',
    );
  });
});
