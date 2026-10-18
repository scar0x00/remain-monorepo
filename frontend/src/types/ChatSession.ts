import { ChatMessage } from './ChatMessage';

export interface ChatSessionSummary {
  id: string;
  title: string;
  // The deck this conversation produced, once there is one.
  deckName: string | null;
  deckKey: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatSessionPage {
  sessions: ChatSessionSummary[];
  // Pass as `before` to fetch the next page; null on the last page.
  nextCursor: string | null;
}

export interface ChatSessionDetail extends ChatSessionSummary {
  // False when the deck was deleted after the conversation produced it.
  deckExists: boolean;
  messages: ChatMessage[];
}

// Wire format of a message from main-backend; null fields are dropped by toChatMessage.
export interface StoredChatMessage {
  id: string;
  role: 'user' | 'assistant';
  state: 'pending' | 'done' | 'error';
  text: string;
  attachments: { name: string; size: number }[];
  deckName: string | null;
  cardCount: number | null;
}

export interface NewChatMessage {
  role: 'user' | 'assistant';
  state?: 'pending' | 'done' | 'error';
  text: string;
  attachments?: { name: string; size: number }[];
}
