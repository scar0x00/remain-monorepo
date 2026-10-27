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
    if (accuracy >= 0.8) return "bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300";
    if (accuracy >= 0.5) return "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300";
    return "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300";
  }

  // Left border of the card, same thresholds as the score pill; neutral until the deck has a score.
  borderClasses(accuracy?: number | null): string {
    if (accuracy == null) return "border-l-app-border";
    if (accuracy >= 0.8) return "border-l-green-500";
    if (accuracy >= 0.5) return "border-l-amber-500";
    return "border-l-red-500";
  }

  convertToDate(dateString: string) {
    return new Date(dateString);
  }
}
