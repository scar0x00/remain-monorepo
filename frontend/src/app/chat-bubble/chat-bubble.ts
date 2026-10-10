import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ChatMessage } from '../../types/ChatMessage';

@Component({
  selector: 'app-chat-bubble',
  imports: [RouterLink],
  templateUrl: './chat-bubble.html',
})
export class ChatBubble {
  message = input.required<ChatMessage>();
}
