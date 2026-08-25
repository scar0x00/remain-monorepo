import { Component, inject } from "@angular/core";
import { DeckSearchTerm } from "../deck-search-term";
import { RouterLink } from "@angular/router";
import { DatePipe } from "@angular/common";

interface Deck {
  deckName: string;
  size: number;
  uploaded: string;
  etag: string;
}

@Component({
  selector: "app-deck-list",
  imports: [RouterLink, DatePipe],
  templateUrl: "./deck-list.html",
})
export class DeckList {
  searchTerm = inject(DeckSearchTerm);

  getDeckPath(deckName: string): string {
    return deckName.replace(/\.json$/i, "");
  }

  convertToDate(dateString: string) {
    return new Date(dateString);
  }
}
