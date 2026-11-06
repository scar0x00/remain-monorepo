import { Component, computed, inject } from "@angular/core";
import { DeckSearchTerm, SORT_OPTIONS } from "../deck-search-term";

@Component({
  selector: "app-deck-sort-select",
  templateUrl: "./deck-sort-select.html",
})
export class DeckSortSelect {
  protected readonly searchTerm = inject(DeckSearchTerm);
  protected readonly options = SORT_OPTIONS;
  protected readonly selected = computed(() =>
    SORT_OPTIONS.findIndex((o) => o.sort === this.searchTerm.sort() && o.order === this.searchTerm.order()),
  );

  protected select(index: string) {
    this.searchTerm.setSort(SORT_OPTIONS[Number(index)]);
  }
}
