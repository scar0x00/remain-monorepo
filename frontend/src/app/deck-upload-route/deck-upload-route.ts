import { HttpClient } from "@angular/common/http";
import { Component, inject, signal } from "@angular/core";

@Component({
  selector: "app-deck-upload-route",
  imports: [],
  templateUrl: "./deck-upload-route.html",
})
export class DeckUploadRoute {
  files = signal<File[] | undefined>(undefined);
  private http = inject(HttpClient);

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      const files = input.files;
      if (this.files() === undefined) {
        this.files.set(Array.from(files));
      } else {
        const f = this.files();
        if (f instanceof Array) {
          this.files.set([...f, ...Array.from(files)]);
        }
      }
    }
  }

  uploadFile() {
    const files = this.files();
    if (!files) return;

    for (const file of files) {
      const key = encodeURIComponent(file.name);
      const url = `/api/v1/deck/${key}`;

      this.http.put(url, file, {
        responseType: "text",
      })
        .subscribe({
          next: (response) => {
            console.log("Upload successful from Hono:", response);
          },
          error: (error) => {
            console.error("Upload failed", error);
          },
        });
    }
    this.files.set(undefined);
  }
}
