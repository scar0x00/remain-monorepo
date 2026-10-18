import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ChatHistory } from '../chat-history/chat-history';

@Component({
  selector: 'app-nav-bar',
  imports: [RouterLink],
  templateUrl: './nav-bar.html',
})
export class NavBar {
  protected readonly history = inject(ChatHistory);
}
