import { Component } from "@angular/core";
import { DeckSearchTerm } from "../deck-search-term";
import { DeckList } from "../deck-list/deck-list";

@Component({
  selector: "app-browse-decks-route",
  imports: [DeckList],
  providers: [DeckSearchTerm],
  templateUrl: "./browse-decks-route.html",
})
export class BrowseDecksRoute {
}
