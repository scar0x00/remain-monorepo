import { Component, ElementRef, afterRenderEffect, input, model, viewChild } from "@angular/core";

/**
 * The raw markdown field of a card side. A plain textarea for now; it is the only place that knows
 * that, so it can become CodeMirror later without touching the card editor.
 */
@Component({
    selector: "app-markdown-editor",
    templateUrl: "./markdown-editor.html",
})
export class MarkdownEditor {
    value = model.required<string>();
    label = input.required<string>();
    fieldId = input.required<string>();
    error = input<string>();

    private readonly textarea = viewChild.required<ElementRef<HTMLTextAreaElement>>("textarea");

    constructor() {
        // Grows with its content, so the whole card stays visible without an inner scrollbar.
        afterRenderEffect(() => {
            this.value();
            const el = this.textarea().nativeElement;
            el.style.height = "auto";
            el.style.height = `${el.scrollHeight + 4}px`;
        });
    }

    onInput(event: Event) {
        this.value.set((event.target as HTMLTextAreaElement).value);
    }

    // Tab indents (two spaces) instead of leaving the field, which is what markdown lists need.
    // Esc then Tab still leaves it, so keyboard users are never trapped.
    onKeydown(event: KeyboardEvent) {
        if (event.key === "Escape") {
            this.tabMovesFocus = true;
        } else if (event.key === "Tab" && !event.shiftKey && !this.tabMovesFocus) {
            event.preventDefault();
            this.replaceSelection((text) => `  ${text}`, 2);
        } else {
            this.tabMovesFocus = false;
        }
    }

    onBlur() {
        this.tabMovesFocus = false;
    }

    inlineMath() {
        this.wrap("$", "$");
    }

    blockMath() {
        this.wrap("\n$$\n", "\n$$\n");
    }

    private tabMovesFocus = false;

    private wrap(before: string, after: string) {
        this.replaceSelection((text) => `${before}${text}${after}`, before.length);
    }

    /** Replaces the selection and puts the caret `caret` characters into the replacement (or after the old text). */
    private replaceSelection(replace: (selected: string) => string, caret: number) {
        const el = this.textarea().nativeElement;
        const { selectionStart: start, selectionEnd: end, value } = el;
        const selected = value.slice(start, end);
        const next = replace(selected);
        el.focus();
        el.setRangeText(next, start, end, "end");
        if (!selected) el.setSelectionRange(start + caret, start + caret);
        this.value.set(el.value);
    }
}
