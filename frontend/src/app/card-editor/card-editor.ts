import { Component, input, output } from "@angular/core";
import { Card, CardRef, CardRefKind } from "../../types/Card";
import { CardErrors } from "../deck-editor/deck-editor";
import { REF_KINDS } from "../deck-format/deck-format";
import { MarkdownEditor } from "../markdown-editor/markdown-editor";

/** The fields of one card: front, back and, unless `compact`, its references and tags. */
@Component({
    selector: "app-card-editor",
    imports: [MarkdownEditor],
    templateUrl: "./card-editor.html",
})
export class CardEditor {
    card = input.required<Card>();
    errors = input<CardErrors>({});
    // The study quick edit only edits the two sides.
    compact = input(false);
    changed = output<Partial<Omit<Card, "id">>>();

    protected readonly refKinds = REF_KINDS;

    protected refs() {
        return this.card().meta?.refs ?? [];
    }

    protected tags() {
        return this.card().meta?.tags ?? [];
    }

    setFront(front: string) {
        this.changed.emit({ front });
    }

    setBack(back: string) {
        this.changed.emit({ back });
    }

    addRef() {
        this.setRefs([...this.refs(), { kind: "page", label: "" }]);
    }

    updateRef(index: number, patch: Partial<CardRef>) {
        this.setRefs(this.refs().map((ref, i) => (i === index ? withoutEmptySource({ ...ref, ...patch }) : ref)));
    }

    removeRef(index: number) {
        this.setRefs(this.refs().filter((_, i) => i !== index));
    }

    // Enter or a comma adds the typed tag; Backspace in an empty field removes the last one.
    onTagKeydown(event: KeyboardEvent) {
        const input = event.target as HTMLInputElement;
        if (event.key === "Enter" || event.key === ",") {
            event.preventDefault();
            this.addTag(input);
        } else if (event.key === "Backspace" && !input.value && this.tags().length) {
            this.removeTag(this.tags().length - 1);
        }
    }

    addTag(input: HTMLInputElement) {
        const tag = input.value.trim().replace(/,$/, "");
        input.value = "";
        if (tag && !this.tags().includes(tag)) this.setTags([...this.tags(), tag]);
    }

    removeTag(index: number) {
        this.setTags(this.tags().filter((_, i) => i !== index));
    }

    protected asKind(value: string) {
        return value as CardRefKind;
    }

    private setRefs(refs: CardRef[]) {
        this.setMeta({ refs });
    }

    private setTags(tags: string[]) {
        this.setMeta({ tags });
    }

    // Empty lists are dropped, so a card without refs or tags is saved without `meta`.
    private setMeta(patch: Partial<NonNullable<Card["meta"]>>) {
        const meta = { ...this.card().meta, ...patch };
        for (const field of ["refs", "tags"] as const) {
            if (!meta[field]?.length) delete meta[field];
        }
        this.changed.emit({ meta: Object.keys(meta).length ? meta : undefined });
    }
}

function withoutEmptySource(ref: CardRef): CardRef {
    if (ref.source?.trim()) return ref;
    const { source: _, ...rest } = ref;
    return rest;
}
