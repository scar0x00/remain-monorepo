import { Component } from "@angular/core";
import { DeckSearchTerm } from "../deck-search-term";
import { DeckList } from "../deck-list/deck-list";
import { DeckPagination } from "../deck-pagination/deck-pagination";
import { DeckSortSelect } from "../deck-sort-select/deck-sort-select";
import { SearchDeckField } from "../search-deck-field/search-deck-field";

@Component({
  selector: "app-browse-decks-route",
  imports: [DeckList, DeckPagination, DeckSortSelect, SearchDeckField],
  providers: [DeckSearchTerm],
  templateUrl: "./browse-decks-route.html",
})
export class BrowseDecksRoute {
}
