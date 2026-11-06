import { Component, computed, inject } from "@angular/core";
import { RouterLink } from "@angular/router";
import { DeckSearchTerm } from "../deck-search-term";

@Component({
  selector: "app-deck-pagination",
  imports: [RouterLink],
  templateUrl: "./deck-pagination.html",
})
export class DeckPagination {
  protected readonly searchTerm = inject(DeckSearchTerm);
  protected readonly page = computed(() => this.searchTerm.current());
  /** First and last deck on this page, one-based, for "11–20 of 23". */
  protected readonly range = computed(() => {
    const page = this.page();
    if (!page) return null;
    const first = (page.page - 1) * page.pageSize + 1;
    return { first, last: first + page.decks.length - 1 };
  });

  // The new page replaces the list in place, so start reading it from the top.
  protected toTop() {
    window.scrollTo({ top: 0 });
  }
}
