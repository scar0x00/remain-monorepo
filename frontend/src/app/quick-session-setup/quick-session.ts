import { Card } from "../../types/Card";

/** How many cards a quick session offers by default, and the presets on the setup screen. */
export const DEFAULT_QUICK_COUNT = 10;
export const QUICK_COUNT_PRESETS = [5, 10, 20, 50];

export interface QuickSessionOptions {
    count: number;
    // Only cards with at least one of these tags; every card when empty.
    tags: string[];
}

/**
 * Reads `?quick=` from the study route: a positive whole number is the size of the run, anything else
 * (`?quick` or `?quick=`) asks for the setup screen. Undefined when the param is absent (a full run).
 */
export function parseQuickParam(raw: string | null | undefined): number | "setup" | undefined {
    if (raw == null) return undefined;
    const count = Number(raw);
    return raw.trim() !== "" && Number.isInteger(count) && count > 0 ? count : "setup";
}

export function parseTagsParam(raw: string | null | undefined): string[] {
    return raw ? [...new Set(raw.split(",").map((t) => t.trim()).filter(Boolean))] : [];
}

/** Every card tag in the deck with how many cards carry it, most used first. */
export function deckTags(cards: Card[]): { tag: string; count: number }[] {
    const counts = new Map<string, number>();
    for (const card of cards) {
        for (const tag of new Set(card.meta?.tags ?? [])) {
            counts.set(tag, (counts.get(tag) ?? 0) + 1);
        }
    }
    return [...counts]
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export function hasAnyTag(card: Card, tags: ReadonlySet<string>): boolean {
    return !tags.size || (card.meta?.tags ?? []).some((tag) => tags.has(tag));
}
