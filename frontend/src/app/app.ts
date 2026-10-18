import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ChatSessionList } from './chat-session-list/chat-session-list';
import { NavBar } from './nav-bar/nav-bar';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, NavBar, ChatSessionList],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  protected readonly title = signal('frontend');
}
