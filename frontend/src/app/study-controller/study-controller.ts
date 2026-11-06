import { Component, computed, effect, inject, signal, untracked } from "@angular/core";
import { httpResource } from "@angular/common/http";
import { ActivatedRoute, Router } from "@angular/router";
import { toSignal } from "@angular/core/rxjs-interop";
import { Flashcard } from "../flashcard/flashcard";
import { RouterLink } from "@angular/router";
import { MarkdownComponent } from "ngx-markdown";
import { DecimalPipe, PercentPipe } from "@angular/common";
import { Deck } from "../../types/Deck";
import { StudyAnswer, StudySession } from "../../types/StudySession";
import { StudySessionService } from "../study-session/study-session.service";
import { normalizeDeck } from "../deck-format/deck-format";
import { CardQuickEdit } from "../card-quick-edit/card-quick-edit";
import { Card } from "../../types/Card";
import { QuickSessionSetup } from "../quick-session-setup/quick-session-setup";
import { QuickSessionOptions, hasAnyTag, parseQuickParam, parseTagsParam } from "../quick-session-setup/quick-session";
import { StudyMode } from "../study-session/study-session.service";

@Component({
    selector: "app-study-controller",
    imports: [Flashcard, RouterLink, MarkdownComponent, PercentPipe, DecimalPipe, CardQuickEdit, QuickSessionSetup],
    templateUrl: "./study-controller.html",
    providers: [StudySessionService],
    host: { "(window:pagehide)": "sessions.flushOnPageHide()" },
})
export class StudyController {
    private readonly route = inject(ActivatedRoute);
    private readonly router = inject(Router);
    protected readonly sessions = inject(StudySessionService);
    private paramMap = toSignal(this.route.paramMap);
    private queryParamMap = toSignal(this.route.queryParamMap);
    readonly deckId = computed(() => this.paramMap()?.get("id"));
    // Restricts the run to these cards ("Study missed cards"); studies the whole deck when absent.
    private readonly cardIdFilter = computed(() => {
        const raw = this.queryParamMap()?.get("cardIds");
        return raw ? new Set(raw.split(",")) : undefined;
    });
    // Quick session (#60): `?quick=<n>` studies n random cards, `?quick` alone shows the setup screen.
    private readonly quick = computed(() => parseQuickParam(this.queryParamMap()?.get("quick")));
    // `?tags=a,b` keeps only cards with any of these tags.
    readonly tagFilter = computed(() => parseTagsParam(this.queryParamMap()?.get("tags")));
    readonly isQuick = computed(() => this.quick() !== undefined);
    readonly mode = computed<StudyMode>(() => (this.isQuick() ? "quick" : this.cardIdFilter() ? "missed" : "full"));
    // Bumped by "Another quick session" to draw a new set of cards with the same options.
    private readonly reshuffles = signal(0);

    // Legacy decks (a bare array of cards) are upgraded to v2 here, with deterministic card ids.
    protected readonly deck = httpResource<Deck>(
        () => {
            const id = this.deckId();
            return id ? `/api/v1/deck/${id}.json` : undefined;
        },
        { parse: normalizeDeck },
    );

    protected readonly answers = signal<StudyAnswer[]>([]);
    rightCounter = computed(() => this.answers().filter((a) => a.correct).length);
    wrongCounter = computed(() => this.answers().length - this.rightCounter());
    currentCard = computed(() => {
        return this.answers().length;
    });
    hideBack = signal(true);

    private shownAt = Date.now();
    private startedAt = Date.now();

    shuffledIndexes = computed(() => {
        this.reshuffles();
        const cards = this.deck.value()?.cards;
        const quick = this.quick();
        if (!cards?.length || quick === "setup") return undefined;

        const filter = this.cardIdFilter();
        const tags = new Set(this.tagFilter());
        const arr = Array.from({ length: cards.length }, (_, i) => i).filter(
            (i) => (!filter || filter.has(cards[i].id)) && hasAnyTag(cards[i], tags),
        );
        // Nothing matches the tags: back to the setup screen rather than an empty run.
        if (!arr.length && tags.size) return undefined;

        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }

        // A uniform shuffle, so its first n are a uniformly random subset.
        return quick === undefined ? arr : arr.slice(0, quick);
    });
    readonly showQuickSetup = computed(
        () => !!this.deck.value()?.cards.length && (this.quick() === "setup" || (this.tagFilter().length > 0 && !this.shuffledIndexes())),
    );
    // Cards saved from the quick edit, by id. Applied on top of the loaded deck instead of replacing
    // it, so the run (its order and answers) carries on with the fixed text.
    private readonly editedCards = signal<Record<string, Card>>({});
    private readonly savedEtag = signal<string | null | undefined>(undefined);
    readonly deckKey = computed(() => `${this.deckId()}.json`);
    readonly currentDeck = computed(() => {
        const deck = this.deck.value();
        const edited = this.editedCards();
        return deck && { ...deck, cards: deck.cards.map((card) => edited[card.id] ?? card) };
    });
    readonly deckEtag = computed(() => this.savedEtag() ?? this.deck.headers()?.get("etag") ?? null);
    readonly editing = signal(false);

    currentMd = computed(() => {
        const cards = this.currentDeck()?.cards;
        const shuffledIndexes = this.shuffledIndexes();
        const index = this.currentCard();
        if (!cards || !shuffledIndexes || index >= shuffledIndexes.length) {
            return undefined;
        }
        return cards[shuffledIndexes[this.currentCard()]];
    });

    readonly finished = computed(
        () => this.currentCard() === this.shuffledIndexes()?.length,
    );
    readonly missed = computed(() => this.answers().filter((a) => !a.correct));
    readonly missedIds = computed(() => this.missed().map((a) => a.cardId).join(","));
    readonly accuracy = computed(() => {
        const total = this.answers().length;
        return total ? this.rightCounter() / total : 0;
    });
    readonly elapsedMs = signal(0);
    readonly previousRun = signal<StudySession | null>(null);
    // The deck the quick edits in `editedCards` apply to; they are dropped when another one loads.
    private editedDeck: Deck | undefined;

    constructor() {
        // A new run starts whenever the set of cards to study changes (deck loaded, "Study missed cards").
        effect(() => {
            const order = this.shuffledIndexes();
            if (!order) return;

            untracked(() => {
                this.answers.set([]);
                this.hideBack.set(true);
                this.elapsedMs.set(0);
                this.previousRun.set(null);
                this.startedAt = this.shownAt = Date.now();
                // A new run of the same deck (missed cards, another quick session) keeps its quick edits.
                if (this.deck.value() !== this.editedDeck) {
                    this.editedDeck = this.deck.value();
                    this.editedCards.set({});
                    this.savedEtag.set(undefined);
                }
                this.sessions.start(this.deckKey(), this.deckEtag(), order.length, this.mode());
            });
        });

        effect(() => {
            if (this.finished() && this.answers().length) {
                untracked(() => void this.finishRun());
            }
        });
    }

    private async finishRun() {
        this.elapsedMs.set(Date.now() - this.startedAt);
        const session = await this.sessions.finish();
        // A quick session is a different set of cards each time, so "last time" says little about it.
        if (session && !this.isQuick()) {
            this.previousRun.set(await this.sessions.previousRun(session.deckName, session.id));
        }
    }

    private answer(correct: boolean) {
        const order = this.shuffledIndexes();
        const card = this.currentMd();
        if (!order || !card) return;

        const answer: StudyAnswer = {
            position: this.answers().length,
            cardId: card.id,
            cardFront: card.front,
            correct,
            durationMs: Date.now() - this.shownAt,
        };
        this.answers.update((a) => [...a, answer]);
        this.sessions.recordAnswer(answer);
        this.hideBack.set(true);
        this.shownAt = Date.now();
    }

    rightAnswer() {
        this.answer(true);
    }

    wrongAnswer() {
        this.answer(false);
    }

    startQuick({ count, tags }: QuickSessionOptions) {
        void this.router.navigate([], {
            relativeTo: this.route,
            queryParams: { quick: count, tags: tags.length ? tags.join(",") : null },
        });
    }

    anotherQuickSession() {
        this.reshuffles.update((n) => n + 1);
    }

    flipCard() {
        this.hideBack.set(false);
    }

    cardSaved({ deck, etag }: { deck: Deck; etag: string | null }) {
        this.editedCards.set(Object.fromEntries(deck.cards.map((card) => [card.id, card])));
        this.savedEtag.set(etag);
    }
}
