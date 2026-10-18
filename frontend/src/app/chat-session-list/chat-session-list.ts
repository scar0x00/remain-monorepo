import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ChatHistory } from '../chat-history/chat-history';
import { ChatSessionSummary } from '../../types/ChatSession';

// Drawer with the saved conversations, opened from the menu button in the nav bar.
@Component({
  selector: 'app-chat-session-list',
  imports: [RouterLink],
  templateUrl: './chat-session-list.html',
})
export class ChatSessionList {
  protected readonly history = inject(ChatHistory);
  private readonly router = inject(Router);

  protected readonly sessions = computed(() => this.history.sessions.value()?.sessions ?? []);
  protected readonly renamingId = signal<string | null>(null);
  protected readonly confirmingDeleteId = signal<string | null>(null);
  protected readonly failed = signal<string | null>(null);

  close() {
    this.history.drawerOpen.set(false);
    this.renamingId.set(null);
    this.confirmingDeleteId.set(null);
    this.failed.set(null);
  }

  startRename(session: ChatSessionSummary) {
    this.confirmingDeleteId.set(null);
    this.renamingId.set(session.id);
  }

  saveRename(session: ChatSessionSummary, title: string) {
    const trimmed = title.trim();
    this.renamingId.set(null);
    if (trimmed === '' || trimmed === session.title) return;

    this.history.rename(session.id, trimmed).subscribe({
      error: () => this.failed.set('Could not rename the conversation'),
    });
  }

  askDelete(session: ChatSessionSummary) {
    this.renamingId.set(null);
    this.confirmingDeleteId.set(session.id);
  }

  confirmDelete(session: ChatSessionSummary) {
    this.confirmingDeleteId.set(null);
    this.history.remove(session.id).subscribe({
      next: () => {
        if (this.router.url.split('?')[0].endsWith(`/${session.id}`)) {
          void this.router.navigate(['/flashcard-chat']);
        }
      },
      error: () => this.failed.set('Could not delete the conversation'),
    });
  }
}
