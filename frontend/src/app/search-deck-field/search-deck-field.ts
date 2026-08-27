import { Component, inject } from "@angular/core";
import { DeckSearchTerm } from "../deck-search-term";
import { FormsModule } from "@angular/forms";



@Component({
  selector: "app-search-deck-field",
  imports: [FormsModule],
  templateUrl: "./search-deck-field.html",
})
export class SearchDeckField {
  searchTerm = inject(DeckSearchTerm);
  searchValue = ''

  handleInput(e: InputEvent) {
    this.searchTerm.setTerm(this.searchValue);
  }

  handleClear() {
    this.searchTerm.setTerm('');
    this.searchValue = '';
  }
}
