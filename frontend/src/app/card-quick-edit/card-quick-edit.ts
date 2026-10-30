import { Component, ElementRef, OnInit, computed, inject, input, output, viewChild } from "@angular/core";
import { RouterLink } from "@angular/router";
import { Card } from "../../types/Card";
import { Deck } from "../../types/Deck";
import { CardEditor } from "../card-editor/card-editor";
import { DeckEditor } from "../deck-editor/deck-editor";
import { Flashcard } from "../flashcard/flashcard";

/**
 * Edits one card of the deck being studied, in a dialog, so the run isn't lost (#14). Saves the
 * whole deck with `If-Match` like the editor route and hands the saved deck back to the study.
 */
@Component({
    selector: "app-card-quick-edit",
    imports: [CardEditor, Flashcard, RouterLink],
    templateUrl: "./card-quick-edit.html",
    providers: [DeckEditor],
})
export class CardQuickEdit implements OnInit {
    deckKey = input.required<string>();
    deck = input.required<Deck>();
    etag = input.required<string | null>();
    cardId = input.required<string>();
    saved = output<{ deck: Deck; etag: string | null }>();
    closed = output<void>();

    protected readonly editor = inject(DeckEditor);
    private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>("dialog");

    // The study route only opens .json decks, so the editor's name is the key without it.
    protected readonly deckName = computed(() => this.deckKey().replace(/\.json$/i, ""));
    protected readonly card = computed(() => this.editor.cards().find((card) => card.id === this.cardId()));

    ngOnInit() {
        this.editor.open(this.deckKey(), this.deck(), this.etag());
        // Shown as a modal once in the DOM: focus is trapped and Esc closes it.
        queueMicrotask(() => this.dialog().nativeElement.showModal());
    }

    update(patch: Partial<Omit<Card, "id">>) {
        this.editor.updateCard(this.cardId(), patch);
    }

    async save() {
        if (!this.editor.dirty()) return this.close();
        if (await this.editor.save()) this.finish();
    }

    async overwrite() {
        if (await this.editor.overwrite()) this.finish();
    }

    close() {
        this.dialog().nativeElement.close();
    }

    private finish() {
        this.saved.emit({ deck: this.editor.draft()!, etag: this.editor.etag() });
        this.close();
    }
}
