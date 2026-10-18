import { Routes, UrlMatchResult, UrlSegment } from "@angular/router";
import { DeckUploadRoute } from "./deck-upload-route/deck-upload-route";
import { BrowseDecksRoute } from "./browse-decks-route/browse-decks-route";
import { DeckStudyRoute } from "./deck-study-route/deck-study-route";
import { FlashcardChatRoute } from "./flashcard-chat-route/flashcard-chat-route";

// `flashcard-chat` starts a new conversation, `flashcard-chat/:sessionId` reopens a saved one.
// One route for both, so moving to the saved URL after the first message keeps the component.
export function flashcardChatMatcher(segments: UrlSegment[]): UrlMatchResult | null {
    if (segments.length === 0 || segments.length > 2 || segments[0].path !== "flashcard-chat") {
        return null;
    }

    return segments.length === 2
        ? { consumed: segments, posParams: { sessionId: segments[1] } }
        : { consumed: segments };
}

export const routes: Routes = [
    {
        matcher: flashcardChatMatcher,
        component: FlashcardChatRoute,
    },
    {
        path: "deck-upload",
        component: DeckUploadRoute,
    },
    {
        path: "deck-browse",
        component: BrowseDecksRoute,
    },
    {
        path: "deck-study/:id",
        component: DeckStudyRoute,
    },
];