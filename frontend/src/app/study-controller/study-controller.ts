import { Component, computed, inject, signal } from "@angular/core";
import { httpResource } from "@angular/common/http";
import { ActivatedRoute } from "@angular/router";
import { toSignal } from "@angular/core/rxjs-interop";
import { Flashcard } from "../flashcard/flashcard";

export interface Card {
  front: string;
  back: string;
};
export interface Deck extends Array<Card> {};

@Component({
  selector: "app-study-controller",
  imports: [Flashcard],
  templateUrl: "./study-controller.html",
  styleUrl: "./study-controller.css",
})
export class StudyController {
  private readonly route = inject(ActivatedRoute);
  private paramMap = toSignal(this.route.paramMap);
  readonly deckId = computed(() => this.paramMap()?.get("id"));

  protected readonly deck = httpResource<Deck>(() => {
    const id = this.deckId();
    return id ? `/api/v1/deck/${id}` : undefined;
  });

  currentCard = signal(0);
  currentMd = computed(() => {
    const deck = this.deck.value();
    if (!deck) return undefined;
    return deck[this.currentCard()];
  });

  nextCard() {
    this.currentCard.update((i) => i + 1);
  }

}
