import { Component, input } from '@angular/core';
import { MarkdownComponent } from 'ngx-markdown';

// this component will render the both the front and back of the flashcard
// when some input to the component changes from true to false (hide back) then
// the component will show the back
// the component must have two inputs: front and back

@Component({
  selector: 'app-flashcard',
  imports: [MarkdownComponent],
  templateUrl: './flashcard.html',
})
export class Flashcard {
  hideBack = input<boolean>(true);
  front = input.required<string | undefined>();
  back = input.required<string | undefined>();
}