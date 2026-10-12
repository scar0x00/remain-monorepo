import { HttpErrorResponse } from '@angular/common/http';
import { GenerateDeckRequest } from '../../types/FlashcardAgent';

// Keep in sync with the agent: flashcard-generator-agent/src/input.ts (isPlainText)
// and the Workers AI markdown conversion formats for everything else.
export const ACCEPTED_EXTENSIONS = [
  'pdf',
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'txt',
  'md',
  'tex',
  'latex',
];
export const ACCEPT_ATTRIBUTE = ACCEPTED_EXTENSIONS.map((extension) => `.${extension}`).join(',');

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_FILES = 10;
export const MAX_INSTRUCTIONS_LENGTH = 2000;
export const CARD_COUNT = { min: 1, max: 200, default: 20 } as const;

const DECK_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;

export interface RejectedFile {
  name: string;
  reason: string;
}

export interface AttachmentReview {
  accepted: File[];
  rejected: RejectedFile[];
}

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

export function isSupportedFile(file: File): boolean {
  return ACCEPTED_EXTENSIONS.includes(fileExtension(file.name));
}

export function reviewAttachments(incoming: File[], existing: File[]): AttachmentReview {
  const accepted: File[] = [];
  const rejected: RejectedFile[] = [];

  for (const file of incoming) {
    const alreadyAttached = [...existing, ...accepted].some(
      (other) => other.name === file.name && other.size === file.size,
    );

    if (!isSupportedFile(file)) {
      rejected.push({ name: file.name, reason: 'Unsupported file type' });
    } else if (file.size > MAX_FILE_BYTES) {
      rejected.push({ name: file.name, reason: `Larger than ${formatFileSize(MAX_FILE_BYTES)}` });
    } else if (alreadyAttached) {
      rejected.push({ name: file.name, reason: 'Already attached' });
    } else if (existing.length + accepted.length >= MAX_FILES) {
      rejected.push({ name: file.name, reason: `You can attach up to ${MAX_FILES} files` });
    } else {
      accepted.push(file);
    }
  }

  return { accepted, rejected };
}

export function isValidDeckName(name: string): boolean {
  return DECK_NAME_PATTERN.test(name);
}

export function toDeckName(fileName: string): string {
  const baseName = fileName.replace(/\.[^.]*$/, '');
  return baseName
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^[^A-Za-z0-9]+/, '')
    .slice(0, 100)
    .replace(/[^A-Za-z0-9]+$/, '');
}

export function validateSubmission(request: GenerateDeckRequest): string | null {
  if (!request.refine) {
    if (!isValidDeckName(request.deckName)) {
      return "Deck name must be 1-100 letters, digits, '-' or '_'";
    }
    if (
      request.cardCount !== null &&
      (!Number.isInteger(request.cardCount) ||
        request.cardCount < CARD_COUNT.min ||
        request.cardCount > CARD_COUNT.max)
    ) {
      return `Card count must be between ${CARD_COUNT.min} and ${CARD_COUNT.max}`;
    }
  }
  if (request.files.length === 0 && request.text.trim() === '') {
    return request.refine
      ? 'Describe the change to make, or attach files to add material from'
      : 'Add a file or some text to generate flashcards from';
  }
  if (
    (request.refine || request.files.length > 0) &&
    request.text.length > MAX_INSTRUCTIONS_LENGTH
  ) {
    return `Instructions must be ${MAX_INSTRUCTIONS_LENGTH} characters or fewer`;
  }
  return null;
}

// Creating a deck: with files attached the message is treated as instructions for them,
// without files it is the source text. Refining a deck: the message is always the instruction.
export function toGenerateFormData(request: GenerateDeckRequest): FormData {
  const form = new FormData();
  form.append('deckName', request.deckName);

  const text = request.text.trim();
  if (request.refine) {
    form.append('refine', 'true');
    if (text) {
      form.append('instructions', text);
    }
  } else {
    if (request.cardCount !== null) {
      form.append('cardCount', String(request.cardCount));
    }
    form.append('overwrite', String(request.overwrite));
    if (request.files.length > 0) {
      if (text) {
        form.append('instructions', text);
      }
    } else {
      form.append('text', text);
    }
  }

  for (const file of request.files) {
    form.append('files', file, file.name);
  }

  return form;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function describeAgentError(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0) {
      return 'Could not reach the flashcard agent. Check your connection and try again.';
    }
    const message = (error.error as { error?: unknown } | null)?.error;
    if (typeof message === 'string' && message.length > 0) {
      return message;
    }
    return `The flashcard agent failed with status ${error.status}`;
  }
  return 'Something went wrong while generating flashcards';
}
