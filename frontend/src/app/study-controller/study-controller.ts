import { Component, computed, effect, inject, signal, untracked } from "@angular/core";
import { httpResource } from "@angular/common/http";
import { ActivatedRoute } from "@angular/router";
import { toSignal } from "@angular/core/rxjs-interop";
import { Flashcard } from "../flashcard/flashcard";
import { RouterLink } from "@angular/router";
import { MarkdownComponent } from "ngx-markdown";
import { DecimalPipe, PercentPipe } from "@angular/common";
import { Deck } from "../../types/Deck";
import { StudyAnswer, StudySession } from "../../types/StudySession";
import { StudySessionService } from "../study-session/study-session.service";
import { normalizeDeck } from "../deck-format/deck-format";

@Component({
    selector: "app-study-controller",
    imports: [Flashcard, RouterLink, MarkdownComponent, PercentPipe, DecimalPipe],
    templateUrl: "./study-controller.html",
    providers: [StudySessionService],
    host: { "(window:pagehide)": "sessions.flushOnPageHide()" },
})
export class StudyController {
    private readonly route = inject(ActivatedRoute);
    protected readonly sessions = inject(StudySessionService);
    private paramMap = toSignal(this.route.paramMap);
    private queryParamMap = toSignal(this.route.queryParamMap);
    readonly deckId = computed(() => this.paramMap()?.get("id"));
    // Restricts the run to these cards ("Study missed cards"); studies the whole deck when absent.
    private readonly cardIdFilter = computed(() => {
        const raw = this.queryParamMap()?.get("cardIds");
        return raw ? new Set(raw.split(",")) : undefined;
    });

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
        const cards = this.deck.value()?.cards;
        if (!cards?.length) return undefined;

        const filter = this.cardIdFilter();
        const arr = Array.from({ length: cards.length }, (_, i) => i).filter(
            (i) => !filter || filter.has(cards[i].id),
        );

        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }

        return arr;
    });
    currentMd = computed(() => {
        const cards = this.deck.value()?.cards;
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
                const etag = this.deck.headers()?.get("etag") ?? null;
                this.sessions.start(`${this.deckId()}.json`, etag, order.length);
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
        if (session) {
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

    flipCard() {
        this.hideBack.set(false);
    }
}
