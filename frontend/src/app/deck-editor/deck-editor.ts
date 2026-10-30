import { HttpClient, HttpErrorResponse, HttpResponse } from "@angular/common/http";
import { Injectable, computed, inject, signal } from "@angular/core";
import { firstValueFrom } from "rxjs";
import { Card } from "../../types/Card";
import { Deck, DeckMeta } from "../../types/Deck";
import { formatOfKey, newCardId, normalizeDeck } from "../deck-format/deck-format";

export type CardErrors = { front?: string; back?: string; refs?: string };

export type EditorStatus =
    | "idle"
    | "loading"
    | "load-failed"
    | "saving"
    | "saved"
    | "conflict"
    | "invalid"
    | "save-failed";

const changedFrom = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b);

/** Why a card can't be saved, by field. Mirrors the deck schema: front, back and ref labels are required. */
export function cardErrors(card: Card): CardErrors {
    const errors: CardErrors = {};
    if (!card.front.trim()) errors.front = "The front is empty";
    if (!card.back.trim()) errors.back = "The back is empty";
    if (card.meta?.refs?.some((ref) => !ref.label.trim() || ref.label.length > 100)) {
        errors.refs = "Every reference needs a label of up to 100 characters";
    }
    return errors;
}

/**
 * State of one deck being edited: the deck as loaded (`original`), the edited copy (`draft`) and the
 * etag it was loaded with, which every save sends as `If-Match` so a deck changed elsewhere (a chat
 * refine, an MCP edit) answers 412 instead of being overwritten. Provided per editor (the editor
 * route, the study quick edit), never in root.
 */
@Injectable()
export class DeckEditor {
    private readonly http = inject(HttpClient);

    readonly key = signal<string | undefined>(undefined);
    readonly original = signal<Deck | undefined>(undefined);
    readonly draft = signal<Deck | undefined>(undefined);
    readonly etag = signal<string | null>(null);
    readonly status = signal<EditorStatus>("idle");

    readonly cards = computed(() => this.draft()?.cards ?? []);
    readonly errors = computed(() => {
        const errors = new Map<string, CardErrors>();
        for (const card of this.cards()) {
            const cardErrs = cardErrors(card);
            if (Object.keys(cardErrs).length) errors.set(card.id, cardErrs);
        }
        return errors;
    });
    /** Ids of cards that are new or differ from the loaded deck. */
    readonly changedIds = computed(() => {
        const before = new Map(this.original()?.cards.map((card) => [card.id, card]));
        return new Set(this.cards().filter((card) => changedFrom(card, before.get(card.id))).map((card) => card.id));
    });
    /** Edited, added and deleted cards, plus one for the metadata and one for the order, when they changed. */
    readonly changeCount = computed(() => {
        const original = this.original();
        const draft = this.draft();
        if (!original || !draft) return 0;
        const ids = new Set(draft.cards.map((card) => card.id));
        const deleted = original.cards.filter((card) => !ids.has(card.id)).length;
        const kept = original.cards.filter((card) => ids.has(card.id)).map((card) => card.id);
        const reordered = changedFrom(kept, draft.cards.filter((card) => !this.isNew(card.id)).map((card) => card.id));
        return this.changedIds().size + deleted + Number(changedFrom(original.meta, draft.meta)) + Number(reordered);
    });
    readonly dirty = computed(() => changedFrom(this.original(), this.draft()));

    /** Starts editing a deck someone else already loaded, e.g. the one being studied. */
    open(key: string, deck: Deck, etag: string | null) {
        this.key.set(key);
        this.original.set(deck);
        this.draft.set(structuredClone(deck));
        this.etag.set(etag);
        this.status.set("idle");
    }

    async load(key: string) {
        this.key.set(key);
        this.status.set("loading");
        try {
            const { deck, etag } = await this.fetch(key);
            this.open(key, deck, etag);
        } catch {
            this.status.set("load-failed");
        }
    }

    updateCard(id: string, patch: Partial<Omit<Card, "id">>) {
        this.updateCards((cards) => cards.map((card) => (card.id === id ? { ...card, ...patch } : card)));
    }

    updateMeta(patch: Partial<DeckMeta>) {
        this.update((deck) => ({ ...deck, meta: { ...deck.meta, ...patch } }));
    }

    /** Adds an empty card after `afterId` (or at the end) and returns its id. */
    addCard(afterId?: string): string {
        const id = newCardId();
        this.insertCard({ id, front: "", back: "" }, this.indexAfter(afterId));
        return id;
    }

    /** Copies a card under a new id, right after it, and returns the copy's id. */
    duplicateCard(id: string): string | undefined {
        const card = this.cards().find((c) => c.id === id);
        if (!card) return undefined;
        const copy = { ...structuredClone(card), id: newCardId() };
        this.insertCard(copy, this.indexAfter(id));
        return copy.id;
    }

    /** Removes a card and returns what `restoreCard` needs to undo it. */
    removeCard(id: string): { card: Card; index: number } | undefined {
        const index = this.cards().findIndex((card) => card.id === id);
        if (index < 0) return undefined;
        const card = this.cards()[index];
        this.updateCards((cards) => cards.filter((c) => c.id !== id));
        return { card, index };
    }

    restoreCard({ card, index }: { card: Card; index: number }) {
        this.insertCard(card, index);
    }

    moveCard(id: string, delta: -1 | 1) {
        this.updateCards((cards) => {
            const from = cards.findIndex((card) => card.id === id);
            const to = from + delta;
            if (from < 0 || to < 0 || to >= cards.length) return cards;
            const next = [...cards];
            [next[from], next[to]] = [next[to], next[from]];
            return next;
        });
    }

    /**
     * Saves the draft with `If-Match`. Returns true when saved; otherwise `status` says why:
     * `invalid` (a card has errors), `conflict` (412, the deck changed elsewhere) or `save-failed`.
     */
    async save(): Promise<boolean> {
        const key = this.key();
        const draft = this.draft();
        if (!key || !draft) return false;
        if (this.errors().size) {
            this.status.set("invalid");
            return false;
        }

        this.status.set("saving");
        try {
            const res = await firstValueFrom(
                this.http.put(`/api/v1/deck/${encodeURIComponent(key)}`, JSON.stringify(draft), {
                    headers: { "content-type": "application/json", ...(this.etag() && { "if-match": this.etag()! }) },
                    observe: "response",
                    responseType: "text",
                }),
            );
            this.original.set(structuredClone(draft));
            this.etag.set(res.headers.get("etag"));
            this.status.set("saved");
            return true;
        } catch (error) {
            this.status.set(error instanceof HttpErrorResponse && error.status === 412 ? "conflict" : "save-failed");
            return false;
        }
    }

    /** After a conflict: saves the draft over whatever is stored now. */
    async overwrite(): Promise<boolean> {
        const key = this.key();
        if (!key) return false;
        try {
            this.etag.set((await this.fetch(key)).etag);
        } catch {
            // The deck is gone: save it again without a condition.
            this.etag.set(null);
        }
        return this.save();
    }

    /** After a conflict: drops the draft and loads the stored deck. */
    reload(): Promise<void> {
        const key = this.key();
        return key ? this.load(key) : Promise.resolve();
    }

    private async fetch(key: string): Promise<{ deck: Deck; etag: string | null }> {
        const res: HttpResponse<string> = await firstValueFrom(
            this.http.get(`/api/v1/deck/${encodeURIComponent(key)}`, {
                observe: "response",
                responseType: "text",
                // Always the current version, never a cached one, since its etag guards the save.
                headers: { "cache-control": "no-cache" },
            }),
        );
        const text = res.body ?? "";
        // YAML is only parsed here, so its parser stays out of every other bundle.
        const raw = formatOfKey(key) === "yaml" ? (await import("yaml")).parse(text) : JSON.parse(text);
        return { deck: normalizeDeck(raw), etag: res.headers.get("etag") };
    }

    private isNew(id: string) {
        return !this.original()?.cards.some((card) => card.id === id);
    }

    private indexAfter(id?: string) {
        const index = id ? this.cards().findIndex((card) => card.id === id) : -1;
        return index < 0 ? this.cards().length : index + 1;
    }

    private insertCard(card: Card, index: number) {
        this.updateCards((cards) => [...cards.slice(0, index), card, ...cards.slice(index)]);
    }

    private updateCards(fn: (cards: Card[]) => Card[]) {
        this.update((deck) => ({ ...deck, cards: fn(deck.cards) }));
    }

    private update(fn: (deck: Deck) => Deck) {
        const draft = this.draft();
        if (!draft) return;
        this.draft.set(fn(draft));
        if (this.status() === "saved" || this.status() === "invalid") this.status.set("idle");
    }
}
