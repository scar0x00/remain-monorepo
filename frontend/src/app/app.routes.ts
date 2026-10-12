import { Routes } from "@angular/router";
import { DeckUploadRoute } from "./deck-upload-route/deck-upload-route";
import { BrowseDecksRoute } from "./browse-decks-route/browse-decks-route";
import { DeckStudyRoute } from "./deck-study-route/deck-study-route";
import { FlashcardChatRoute } from "./flashcard-chat-route/flashcard-chat-route";

export const routes: Routes = [
    {
        path: "flashcard-chat",
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