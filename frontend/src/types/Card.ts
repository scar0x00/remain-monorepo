export type CardRefKind = 'page' | 'equation' | 'theorem' | 'definition' | 'figure' | 'section' | 'other';

// Where a card's content is in its source, e.g. page 112 or equation 3.14. Shown only on the back.
export interface CardRef {
    kind: CardRefKind;
    label: string;
    source?: string;
}

export interface Card {
    // Stable id, assigned by the backend or derived from front and back for legacy decks.
    id: string;
    front: string;
    back: string;
    meta?: {
        refs?: CardRef[];
        tags?: string[];
    };
}
