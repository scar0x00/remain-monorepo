import { Routes } from "@angular/router";
import { DeckUploadRoute } from "./deck-upload-route/deck-upload-route";
import { BrowseDecksRoute } from "./browse-decks-route/browse-decks-route";

export const routes: Routes = [
    {
        path: "deck-upload",
        component: DeckUploadRoute,
    },
    {
        path: "deck-browse",
        component: BrowseDecksRoute,
    },
];
