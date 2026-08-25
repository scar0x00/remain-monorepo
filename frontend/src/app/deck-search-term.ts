import { httpResource } from "@angular/common/http";
import { Service, signal } from "@angular/core";
import { DeckEntry } from "../types/DeckEntry";

@Service({ autoProvided: false })
export class DeckSearchTerm {
    readonly term = signal("");
    readonly deck = httpResource<DeckEntry[]>(() => {
        return `/api/v1/decks` + (this.term() ? `?searchTerm=${this.term()}` : "");
    });

    setTerm(term: string) {
        this.term.set(term);
    }
}
