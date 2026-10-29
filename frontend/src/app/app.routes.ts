import { Routes } from "@angular/router";
import { DeckUploadRoute } from "./deck-upload-route/deck-upload-route";
import { BrowseDecksRoute } from "./browse-decks-route/browse-decks-route";
import { DeckStudyRoute } from "./deck-study-route/deck-study-route";
import { FlashcardChatRoute } from "./flashcard-chat-route/flashcard-chat-route";
import { LandingRoute } from "./landing-route/landing-route";
import { StatsService } from "./stats/stats.service";
import { provideEcharts } from "./stats/provide-echarts";

export const routes: Routes = [
    {
        path: "",
        pathMatch: "full",
        component: LandingRoute,
    },
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
    {
        // Lazy, so ECharts and the stats code stay out of the main bundle.
        // StatsService lives here so the dashboard and a deck's stats share the selected range.
        path: "dashboard",
        providers: [StatsService, provideEcharts()],
        children: [
            {
                path: "",
                pathMatch: "full",
                loadComponent: () => import("./dashboard-route/dashboard-route").then((m) => m.DashboardRoute),
            },
            {
                path: "decks/:name",
                loadComponent: () => import("./deck-stats-route/deck-stats-route").then((m) => m.DeckStatsRoute),
            },
        ],
    },
];