import { Component, inject } from "@angular/core";
import { DeckSearchTerm } from "../deck-search-term";
import { RouterLink } from "@angular/router";
import { DatePipe, PercentPipe } from "@angular/common";

@Component({
  selector: "app-deck-list",
  imports: [RouterLink, DatePipe, PercentPipe],
  templateUrl: "./deck-list.html",
})
export class DeckList {
  searchTerm = inject(DeckSearchTerm);

  getDeckPath(deckName: string): string {
    return deckName.replace(/\.json$/i, "");
  }

  // Color hint for the recent score: green from 80%, amber from 50%, red below.
  scoreClasses(accuracy: number): string {
    if (accuracy >= 0.8) return "bg-green-500/15 text-green-400";
    if (accuracy >= 0.5) return "bg-amber-500/15 text-amber-400";
    return "bg-red-500/15 text-red-400";
  }

  convertToDate(dateString: string) {
    return new Date(dateString);
  }
}
