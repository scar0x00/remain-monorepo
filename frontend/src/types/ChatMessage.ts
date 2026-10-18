export interface ChatAttachment {
  name: string;
  size: number;
}

export interface UserChatMessage {
  id: string;
  role: 'user';
  text: string;
  attachments: ChatAttachment[];
}

export interface AssistantChatMessage {
  id: string;
  role: 'assistant';
  state: 'pending' | 'done' | 'error';
  text: string;
  deckName?: string;
  cardCount?: number;
}

export type ChatMessage = UserChatMessage | AssistantChatMessage;
