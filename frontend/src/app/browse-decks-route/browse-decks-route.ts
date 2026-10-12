import { Component } from "@angular/core";
import { DeckSearchTerm } from "../deck-search-term";
import { DeckList } from "../deck-list/deck-list";
import { SearchDeckField } from "../search-deck-field/search-deck-field";

@Component({
  selector: "app-browse-decks-route",
  imports: [DeckList, SearchDeckField],
  providers: [DeckSearchTerm],
  templateUrl: "./browse-decks-route.html",
})
export class BrowseDecksRoute {
}
