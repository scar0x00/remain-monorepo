export interface UserChatMessage {
  id: number;
  role: 'user';
  text: string;
  attachments: string[];
}

export interface AssistantChatMessage {
  id: number;
  role: 'assistant';
  state: 'pending' | 'done' | 'error';
  text: string;
  deckName?: string;
  cardCount?: number;
}

export type ChatMessage = UserChatMessage | AssistantChatMessage;
