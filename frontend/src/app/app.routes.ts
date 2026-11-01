import { Routes } from "@angular/router";
import { DeckUploadRoute } from "./deck-upload-route/deck-upload-route";
import { BrowseDecksRoute } from "./browse-decks-route/browse-decks-route";
import { DeckStudyRoute } from "./deck-study-route/deck-study-route";
import { FlashcardChatRoute } from "./flashcard-chat-route/flashcard-chat-route";
import { LandingRoute } from "./landing-route/landing-route";
import { StatsService } from "./stats/stats.service";
import { provideEcharts } from "./stats/provide-echarts";
import { authGuard, guestGuard } from "./auth/auth.guard";

export const routes: Routes = [
    {
        path: "",
        pathMatch: "full",
        component: LandingRoute,
    },
    // Accounts (#12). Lazy: only visited when signing in or recovering an account.
    {
        path: "login",
        canActivate: [guestGuard],
        loadComponent: () => import("./login-route/login-route").then((m) => m.LoginRoute),
    },
    {
        path: "signup",
        canActivate: [guestGuard],
        loadComponent: () => import("./signup-route/signup-route").then((m) => m.SignupRoute),
    },
    {
        // better-auth redirects here after following the verification link (`?error=` if it failed).
        path: "verify-email",
        loadComponent: () => import("./verify-email-route/verify-email-route").then((m) => m.VerifyEmailRoute),
    },
    {
        path: "forgot-password",
        loadComponent: () => import("./forgot-password-route/forgot-password-route").then((m) => m.ForgotPasswordRoute),
    },
    {
        // better-auth redirects here from the reset link with `?token=` (or `?error=`).
        path: "reset-password",
        loadComponent: () => import("./reset-password-route/reset-password-route").then((m) => m.ResetPasswordRoute),
    },
    {
        path: "flashcard-chat",
        canActivate: [authGuard],
        component: FlashcardChatRoute,
    },
    {
        path: "deck-upload",
        canActivate: [authGuard],
        component: DeckUploadRoute,
    },
    {
        path: "deck-browse",
        canActivate: [authGuard],
        component: BrowseDecksRoute,
    },
    {
        path: "deck-study/:id",
        canActivate: [authGuard],
        component: DeckStudyRoute,
    },
    {
        // `name` is the file name without `.json`; `?format=yaml` for YAML decks. Lazy, so the editor
        // stays out of the main bundle.
        path: "deck-edit/:name",
        canActivate: [authGuard],
        loadComponent: () => import("./deck-edit-route/deck-edit-route").then((m) => m.DeckEditRoute),
        canDeactivate: [(route: { canLeave(): boolean }) => route.canLeave()],
    },
    {
        // Lazy, so ECharts and the stats code stay out of the main bundle.
        // StatsService lives here so the dashboard and a deck's stats share the selected range.
        path: "dashboard",
        canActivate: [authGuard],
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