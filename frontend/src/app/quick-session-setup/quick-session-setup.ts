import { Component, computed, input, linkedSignal, output, signal } from "@angular/core";
import { RouterLink } from "@angular/router";
import { Card } from "../../types/Card";
import {
    DEFAULT_QUICK_COUNT,
    QUICK_COUNT_PRESETS,
    QuickSessionOptions,
    deckTags,
    hasAnyTag,
} from "./quick-session";

/** Picks how many random cards a quick session studies (#60), optionally only cards with some tags. */
@Component({
    selector: "app-quick-session-setup",
    imports: [RouterLink],
    templateUrl: "./quick-session-setup.html",
})
export class QuickSessionSetup {
    readonly title = input.required<string>();
    readonly cards = input.required<Card[]>();
    readonly initialTags = input<string[]>([]);
    readonly start = output<QuickSessionOptions>();

    protected readonly tags = computed(() => deckTags(this.cards()));
    // Tags the deck no longer has (an old link) are dropped.
    protected readonly selectedTags = linkedSignal(() => {
        const known = new Set(this.tags().map((t) => t.tag));
        return new Set(this.initialTags().filter((tag) => known.has(tag)));
    });
    protected readonly available = computed(() => {
        const tags = this.selectedTags();
        return this.cards().filter((card) => hasAnyTag(card, tags)).length;
    });

    protected readonly requested = signal(DEFAULT_QUICK_COUNT);
    protected readonly count = computed(() => Math.max(1, Math.min(this.requested(), this.available())));
    protected readonly presets = computed(() => QUICK_COUNT_PRESETS.filter((n) => n < this.available()));

    protected toggleTag(tag: string) {
        this.selectedTags.update((tags) => {
            const next = new Set(tags);
            if (!next.delete(tag)) next.add(tag);
            return next;
        });
    }

    protected setCount(raw: string | number) {
        const n = Math.floor(Number(raw));
        if (Number.isFinite(n) && n > 0) this.requested.set(n);
    }

    protected submit(event: Event) {
        event.preventDefault();
        if (!this.available()) return;
        this.start.emit({ count: this.count(), tags: [...this.selectedTags()] });
    }
}
