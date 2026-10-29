import { Component, ElementRef, viewChild } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

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

  private readonly menu = viewChild.required<ElementRef<HTMLElement>>('menu');

  /** The menu is a native popover; close it once a link is picked. */
  closeMenu() {
    this.menu().nativeElement.hidePopover?.();
  }
}
