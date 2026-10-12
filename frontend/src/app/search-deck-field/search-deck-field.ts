import { Component, inject } from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { DeckSearchTerm } from "../deck-search-term";
import { FormsModule } from "@angular/forms";
import { Subject, asyncScheduler, throttleTime } from "rxjs";

export const SEARCH_THROTTLE_MS = 300;

@Component({
  selector: "app-search-deck-field",
  imports: [FormsModule],
  templateUrl: "./search-deck-field.html",
})
export class SearchDeckField {
  searchTerm = inject(DeckSearchTerm);
  searchValue = ''
  private readonly termChanges = new Subject<string>();

  constructor() {
    this.termChanges
      .pipe(
        throttleTime(SEARCH_THROTTLE_MS, asyncScheduler, { leading: true, trailing: true }),
        takeUntilDestroyed(),
      )
      .subscribe((term) => this.searchTerm.setTerm(term));
  }

  handleInput(e: InputEvent) {
    this.termChanges.next(this.searchValue);
  }

  handleClear() {
    this.searchValue = '';
    this.termChanges.next('');
  }
}
