import { Component, inject } from "@angular/core";
import { DeckSearchTerm } from "../deck-search-term";
import { RouterLink } from "@angular/router";
import { DatePipe, PercentPipe } from "@angular/common";
import { DeckTool } from "../../types/Deck";

const TOOL_LABELS: Record<DeckTool["kind"], string> = {
  agent: "Generated",
  mcp: "MCP",
  manual: "Manual",
  upload: "Uploaded",
};

@Component({
  selector: "app-deck-list",
  imports: [RouterLink, DatePipe, PercentPipe],
  templateUrl: "./deck-list.html",
})
export class DeckList {
  searchTerm = inject(DeckSearchTerm);

  // Only .json and .yaml files are decks the editor can open.
  isEditable(deckName: string): boolean {
    return /\.(json|ya?ml)$/i.test(deckName);
  }

  // Route params for the editor: the name without extension, and the format when it isn't JSON.
  editLink(deckName: string) {
    const [, name, ext] = deckName.match(/^(.*)\.(json|ya?ml)$/i)!;
    return { name, queryParams: ext.toLowerCase() === "json" ? {} : { format: ext.toLowerCase() } };
  }

  getDeckPath(deckName: string): string {
    return deckName.replace(/\.json$/i, "");
  }

  toolLabel(tool: DeckTool): string {
    return TOOL_LABELS[tool.kind];
  }

  toolTitle(tool: DeckTool): string {
    return tool.model ? `Generated with ${tool.model}` : TOOL_LABELS[tool.kind];
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
