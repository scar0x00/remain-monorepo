import { Component, ElementRef, computed, effect, inject, input, signal, viewChild } from "@angular/core";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { Card } from "../../types/Card";
import { CardEditor } from "../card-editor/card-editor";
import { DeckEditor } from "../deck-editor/deck-editor";
import { DeckMetaEditor } from "../deck-meta-editor/deck-meta-editor";
import { Flashcard } from "../flashcard/flashcard";

const UNDO_MS = 6000;

/** The first line of a card side as plain text, for the card list. */
export function cardSummary(md: string): string {
    const line = md.split("\n").find((l) => l.trim()) ?? "";
    return line.replace(/[*#_`>]/g, "").replace(/\$+/g, "").replace(/\\([a-zA-Z]+)/g, "$1").trim();
}

/**
 * Whole-deck editor at `deck-edit/:name` (#14). `name` is the file name without its extension, like
 * the study route, because the dev server and the asset worker treat a path ending in `.json` as a
 * file; `?format=yaml` (or `yml`) opens a YAML deck. `?card=<id>` selects a card; on a phone it also
 * switches from the card list to that card, so the back button returns to the list.
 */
@Component({
    selector: "app-deck-edit-route",
    imports: [RouterLink, CardEditor, DeckMetaEditor, Flashcard],
    templateUrl: "./deck-edit-route.html",
    providers: [DeckEditor],
    host: {
        "(window:keydown)": "onKeydown($event)",
        "(window:beforeunload)": "onBeforeUnload($event)",
    },
})
export class DeckEditRoute {
    name = input.required<string>();
    format = input<string>();
    card = input<string>();

    protected readonly editor = inject(DeckEditor);
    private readonly router = inject(Router);
    private readonly route = inject(ActivatedRoute);

    protected readonly search = signal("");
    protected readonly showBack = signal(true);
    protected readonly phoneTab = signal<"edit" | "preview">("edit");
    protected readonly deleted = signal<{ card: Card; index: number } | null>(null);
    private undoTimer?: ReturnType<typeof setTimeout>;

    private readonly details = viewChild<ElementRef<HTMLDialogElement>>("details");
    private readonly conflict = viewChild<ElementRef<HTMLDialogElement>>("conflict");

    protected readonly key = computed(() => `${this.name()}.${this.format() === "yaml" || this.format() === "yml" ? this.format() : "json"}`);
    protected readonly cards = this.editor.cards;
    protected readonly selectedId = computed(() => {
        const id = this.card();
        return this.cards().some((card) => card.id === id) ? id : this.cards()[0]?.id;
    });
    protected readonly selectedIndex = computed(() => this.cards().findIndex((card) => card.id === this.selectedId()));
    protected readonly selected = computed(() => this.cards()[this.selectedIndex()]);
    // Cards with their position in the deck, filtered by the search on either side.
    protected readonly listed = computed(() => {
        const term = this.search().trim().toLowerCase();
        return this.cards()
            .map((card, index) => ({ card, index }))
            .filter(({ card }) => !term || `${card.front}\n${card.back}`.toLowerCase().includes(term));
    });
    protected readonly errorSummary = computed(() => {
        const errors = [...this.editor.errors().values()];
        if (!errors.length) return undefined;
        if (errors.length === 1 && errors[0].back && !errors[0].front && !errors[0].refs) return "1 needs a back";
        if (errors.length === 1 && errors[0].front && !errors[0].back && !errors[0].refs) return "1 needs a front";
        return errors.length === 1 ? "1 needs fixing" : `${errors.length} need fixing`;
    });
    protected readonly saveState = computed(() => {
        const status = this.editor.status();
        if (status === "saving") return "Saving…";
        if (status === "save-failed") return "Couldn't save. Try again.";
        if (status === "invalid") return "Fix the marked cards first";
        if (this.editor.dirty()) {
            const count = this.editor.changeCount();
            return `${count} unsaved ${count === 1 ? "change" : "changes"}`;
        }
        return status === "saved" ? "All changes saved" : "";
    });

    protected readonly summary = cardSummary;

    constructor() {
        effect(() => void this.editor.load(this.key()));
        effect(() => {
            const dialog = this.conflict()?.nativeElement;
            if (!dialog) return;
            if (this.editor.status() === "conflict") {
                if (!dialog.open) dialog.showModal();
            } else if (dialog.open) {
                dialog.close();
            }
        });
    }

    select(id: string) {
        // Replace rather than push when switching cards, so back always leads to the list.
        this.router.navigate([], {
            relativeTo: this.route,
            queryParams: { card: id },
            queryParamsHandling: "merge",
            replaceUrl: !!this.card(),
        });
    }

    backToList() {
        this.router.navigate([], { relativeTo: this.route, queryParams: { card: null }, queryParamsHandling: "merge" });
    }

    updateSelected(patch: Partial<Omit<Card, "id">>) {
        const id = this.selectedId();
        if (id) this.editor.updateCard(id, patch);
    }

    addCard() {
        this.openNew(this.editor.addCard(this.selectedId()));
    }

    duplicate() {
        const id = this.selectedId();
        const copy = id && this.editor.duplicateCard(id);
        if (copy) this.openNew(copy);
    }

    move(delta: -1 | 1) {
        const id = this.selectedId();
        if (id) this.editor.moveCard(id, delta);
    }

    remove() {
        const id = this.selectedId();
        const index = this.selectedIndex();
        const removed = id && this.editor.removeCard(id);
        if (!removed) return;
        const next = this.cards()[Math.min(index, this.cards().length - 1)];
        if (next) this.select(next.id);
        this.deleted.set(removed);
        clearTimeout(this.undoTimer);
        this.undoTimer = setTimeout(() => this.deleted.set(null), UNDO_MS);
    }

    undoRemove() {
        const removed = this.deleted();
        if (!removed) return;
        this.editor.restoreCard(removed);
        this.select(removed.card.id);
        this.deleted.set(null);
    }

    async save() {
        if (this.editor.status() === "saving" || !this.editor.dirty()) return;
        if (!(await this.editor.save()) && this.editor.status() === "invalid") {
            const first = this.cards().find((card) => this.editor.errors().has(card.id));
            if (first) this.select(first.id);
        }
    }

    openDetails() {
        this.details()?.nativeElement.showModal();
    }

    closeDetails() {
        this.details()?.nativeElement.close();
    }

    onKeydown(event: KeyboardEvent) {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
            event.preventDefault();
            void this.save();
        }
    }

    onBeforeUnload(event: BeforeUnloadEvent) {
        if (this.editor.dirty()) event.preventDefault();
    }

    /** Asked by the route's `canDeactivate` guard. */
    canLeave(): boolean {
        return !this.editor.dirty() || confirm("Leave the editor? Your unsaved changes will be lost.");
    }

    private openNew(id: string) {
        this.select(id);
        this.phoneTab.set("edit");
        // After the new card's editor renders.
        setTimeout(() => document.getElementById(`front-${id}`)?.focus());
    }
}
