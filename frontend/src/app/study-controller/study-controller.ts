import { Component, computed, inject, signal } from "@angular/core";
import { httpResource } from "@angular/common/http";
import { ActivatedRoute } from "@angular/router";
import { toSignal } from "@angular/core/rxjs-interop";
import { Flashcard } from "../flashcard/flashcard";
import { RouterLink } from '@angular/router';

export interface Card {
  front: string;
  back: string;
}
export interface Deck extends Array<Card> {}

@Component({
  selector: "app-study-controller",
  imports: [Flashcard, RouterLink],
  templateUrl: "./study-controller.html",
})
export class StudyController {
  private readonly route = inject(ActivatedRoute);
  private paramMap = toSignal(this.route.paramMap);
  readonly deckId = computed(() => this.paramMap()?.get("id"));

  protected readonly deck = httpResource<Deck>(() => {
    const id = this.deckId();
    return id ? `/api/v1/deck/${id}` : undefined;
  });

  rightCounter = signal(0);
  wrongCounter = signal(0);
  currentCard = computed(() => {
    return this.rightCounter() + this.wrongCounter();
  });
  hideBack = signal(true);

  shuffledIndexes = computed(() => {
    const deck = this.deck.value();
    if (!deck?.length) return undefined;

    const arr = Array.from({ length: deck.length }, (_, i) => i);

    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }

    return arr;
  });
  currentMd = computed(() => {
    const deck = this.deck.value();
    const shuffledIndexes = this.shuffledIndexes();
    const index = this.currentCard();
    if (!deck || !shuffledIndexes || index >= shuffledIndexes.length) return undefined;
    return deck[shuffledIndexes[this.currentCard()]];
  });

  rightAnswer() {
    this.rightCounter.update((i) => i + 1);
    this.hideBack.set(true);
  }

  wrongAnswer() {
    this.wrongCounter.update((i) => i + 1);
    this.hideBack.set(true);
  }

  flipCard() {
    this.hideBack.set(false);
  }
}
