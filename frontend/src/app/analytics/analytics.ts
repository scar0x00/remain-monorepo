import { Injectable } from '@angular/core';
import type { PostHog } from 'posthog-js';
import { environment } from '../../environments/environment';

export type AnalyticsProperties = Record<string, string | number | boolean | null>;

/**
 * Usage analytics through PostHog. Off (and posthog-js never loaded) when the build has no token,
 * which is the case in dev, unit tests and e2e. Page views are captured on every route change.
 * Never pass card or deck contents as properties: only ids, counts and enums.
 */
@Injectable({ providedIn: 'root' })
export class Analytics {
  private readonly client: Promise<PostHog> | null = environment.posthogKey ? load() : null;

  capture(event: string, properties?: AnalyticsProperties): void {
    void this.client?.then((posthog) => posthog.capture(event, properties));
  }
}

async function load(): Promise<PostHog> {
  const { default: posthog } = await import('posthog-js');
  posthog.init(environment.posthogKey, {
    api_host: environment.posthogHost,
    defaults: '2026-08-30',
    // Named events only. Autocapture would log every flip and grade, and can pick up card text.
    autocapture: false,
    rageclick: false,
    capture_dead_clicks: false,
    enable_heatmaps: false,
    disable_session_recording: true,
    disable_surveys: true,
    person_profiles: 'identified_only',
  });
  return posthog;
}
