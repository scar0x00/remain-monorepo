import { Component, ElementRef, inject, viewChild } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../auth/auth.service';

@Component({
  selector: 'app-nav-bar',
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './nav-bar.html',
})
export class NavBar {
  protected readonly menuItems = [
    { path: '/dashboard', label: 'Dashboard' },
    { path: '/deck-browse', label: 'Browse decks' },
    { path: '/flashcard-chat', label: 'Create a deck' },
    { path: '/deck-upload', label: 'Upload a deck' },
  ];

  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly menu = viewChild.required<ElementRef<HTMLElement>>('menu');

  async signOut() {
    this.closeMenu();
    await this.auth.signOut();
    await this.router.navigateByUrl('/');
  }

  /** The menu is a native popover; close it once a link is picked. */
  closeMenu() {
    this.menu().nativeElement.hidePopover?.();
  }
}
