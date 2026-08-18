import { Component } from '@angular/core';
import { MarkdownComponent } from 'ngx-markdown';

@Component({
  selector: 'app-browse-decks-route',
  imports: [MarkdownComponent],
  templateUrl: './browse-decks-route.html',
})
export class BrowseDecksRoute {
  formula = `$$x_1(t) * x_2(t) \\stackrel{\\mathcal{F}}{\\Longleftrightarrow} X_1(\\omega) X_2(\\omega)$$`
  markdownCode = `
\`\`\`python
import os

os.read("file.txt")
mylist = list()
\`\`\`
`
  diagram = `
\`\`\`mermaid
%%{init: {'theme': 'dark'}}%%
graph TD;
    A-->B;
    A-->C;
    B-->D;
    C-->D;
\`\`\`
`
}
