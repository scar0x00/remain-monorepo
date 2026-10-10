import { Component, ElementRef, input, output, viewChild } from '@angular/core';

@Component({
  selector: 'app-file-input',
  imports: [],
  templateUrl: './file-input.html',
})
export class FileInput {
  accept = input<string>('');
  multiple = input<boolean>(false);
  disabled = input<boolean>(false);
  label = input<string>('Attach files');

  filesSelected = output<File[]>();

  private readonly fileInput = viewChild.required<ElementRef<HTMLInputElement>>('fileInput');

  open() {
    this.fileInput().nativeElement.click();
  }

  onChange(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    // Reset so selecting the same file again still fires a change event
    input.value = '';
    if (files.length > 0) {
      this.filesSelected.emit(files);
    }
  }
}
