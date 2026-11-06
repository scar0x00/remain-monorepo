import { httpResource } from "@angular/common/http";
import { Service, computed, effect, inject, linkedSignal } from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { ActivatedRoute, Params, Router } from "@angular/router";
import { DeckPage, DeckSort, SortOrder } from "../types/DeckEntry";

export type SortOption = { sort: DeckSort; order: SortOrder; label: string };

/** The orders the deck list offers. The first one for each sort is its default order. */
export const SORT_OPTIONS: SortOption[] = [
    { sort: "name", order: "asc", label: "Name (A–Z)" },
    { sort: "name", order: "desc", label: "Name (Z–A)" },
    { sort: "created", order: "desc", label: "Newest first" },
    { sort: "created", order: "asc", label: "Oldest first" },
    { sort: "success", order: "desc", label: "Highest success rate" },
    { sort: "success", order: "asc", label: "Lowest success rate" },
];

const DEFAULT_ORDER: Record<DeckSort, SortOrder> = { name: "asc", created: "desc", success: "desc" };

const isSort = (value: string | null): value is DeckSort => value === "name" || value === "created" || value === "success";

/**
 * The browse page's search, sort and page, and the page of decks they select. All three live in the
 * URL (`?q=&sort=&order=&page=`), so going back to the list lands on the same page. Provided by the
 * browse route.
 */
@Service({ autoProvided: false })
export class DeckSearchTerm {
    private readonly router = inject(Router);
    private readonly route = inject(ActivatedRoute);
    private readonly query = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });

    readonly term = computed(() => this.query().get("q") ?? "");
    readonly sort = computed<DeckSort>(() => {
        const sort = this.query().get("sort");
        return isSort(sort) ? sort : "name";
    });
    readonly order = computed<SortOrder>(() => {
        const order = this.query().get("order");
        return order === "asc" || order === "desc" ? order : DEFAULT_ORDER[this.sort()];
    });
    readonly page = computed(() => {
        const page = Number(this.query().get("page"));
        return Number.isInteger(page) && page >= 1 ? page : 1;
    });

    readonly deck = httpResource<DeckPage>(() => {
        const params: Record<string, string | number> = {};
        if (this.term()) params["searchTerm"] = this.term();
        if (this.sort() !== "name") params["sort"] = this.sort();
        if (this.order() !== DEFAULT_ORDER[this.sort()]) params["order"] = this.order();
        if (this.page() > 1) params["page"] = this.page();
        return { url: "/api/v1/decks", params };
    });

    /** The page on screen: the last one loaded, kept while the next one loads so the list doesn't blink. */
    readonly current = linkedSignal<DeckPage | undefined, DeckPage | undefined>({
        source: () => (this.deck.hasValue() ? this.deck.value() : undefined),
        computation: (page, previous) => page ?? previous?.value,
    });

    readonly totalPages = computed(() => {
        const page = this.current();
        return page ? Math.max(1, Math.ceil(page.total / page.pageSize)) : 1;
    });

    constructor() {
        // A page past the end (decks deleted, or an old link): go to the last page instead.
        effect(() => {
            const page = this.deck.hasValue() ? this.deck.value() : undefined;
            if (page && page.total > 0 && page.decks.length === 0 && page.page > 1) {
                this.navigate(this.pageParams(this.totalPages()));
            }
        });
    }

    setTerm(term: string) {
        this.navigate({ q: term.toLowerCase() || null, page: null });
    }

    setSort({ sort, order }: Pick<SortOption, "sort" | "order">) {
        this.navigate({
            sort: sort === "name" ? null : sort,
            order: order === DEFAULT_ORDER[sort] ? null : order,
            page: null,
        });
    }

    /** Query params for a link to `page`, merged into the current ones. */
    pageParams(page: number): Params {
        return { page: page > 1 ? page : null };
    }

    private navigate(queryParams: Params) {
        void this.router.navigate([], {
            relativeTo: this.route,
            queryParams,
            queryParamsHandling: "merge",
            replaceUrl: true,
        });
    }
}
