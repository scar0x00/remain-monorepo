import { httpResource } from "@angular/common/http";
import { Service, linkedSignal, signal } from "@angular/core";
import { DeckEntry } from "../types/DeckEntry";

@Service({ autoProvided: false })
export class DeckSearchTerm {
    readonly term = signal("");
    readonly deck = httpResource<DeckEntry[]>(() => ({
        url: "/api/v1/decks",
        params: this.term() ? { searchTerm: this.term() } : undefined,
    }));

    /**
     * The decks to show: the latest results, or the previous ones while the next search loads,
     * so the list doesn't blink to a spinner on every keystroke. Undefined before the first
     * results and after an error.
     */
    readonly decks = linkedSignal<{ value: DeckEntry[] | undefined; loading: boolean }, DeckEntry[] | undefined>({
        source: () => ({
            value: this.deck.hasValue() ? this.deck.value() : undefined,
            loading: this.deck.isLoading(),
        }),
        computation: ({ value, loading }, previous) => value ?? (loading ? previous?.value : undefined),
    });

    setTerm(term: string) {
        // The signal ignores a value equal to the current one, so trailing spaces don't refetch.
        this.term.set(term.trim().toLowerCase());
    }
}
