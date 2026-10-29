import { Component, computed, input, linkedSignal } from '@angular/core';
import { MarkdownComponent } from 'ngx-markdown';
import { CardRef } from '../../types/Card';

const REF_PREFIXES: Record<CardRef['kind'], string> = {
  page: 'p.',
  equation: 'eq.',
  theorem: 'thm.',
  definition: 'def.',
  figure: 'fig.',
  section: '§',
  other: '',
};

// this component will render the both the front and back of the flashcard
// when some input to the component changes from true to false (hide back) then
// the component will show the back
// the component must have two inputs: front and back
// references are never shown on the front: only on the back, behind a toggle

@Component({
  selector: 'app-flashcard',
  imports: [MarkdownComponent],
  templateUrl: './flashcard.html',
})
export class Flashcard {
  hideBack = input<boolean>(true);
  front = input.required<string | undefined>();
  back = input.required<string | undefined>();
  refs = input<CardRef[] | undefined>();

  // Collapsed again for every new card.
  readonly showRefs = linkedSignal({ source: this.front, computation: () => false });
  readonly refLabels = computed(() =>
    (this.refs() ?? []).map((ref) => {
      const label = [REF_PREFIXES[ref.kind], ref.label].filter(Boolean).join(' ');
      return ref.source ? `${label} · ${ref.source}` : label;
    }),
  );

  toggleRefs() {
    this.showRefs.update((show) => !show);
  }
}
