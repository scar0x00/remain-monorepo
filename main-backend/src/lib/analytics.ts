import { PostHog } from "posthog-node";
import { SYSTEM_USER_ID } from "./decks";
import { type Bindings } from "../types";

export type AnalyticsProperties = Record<string, string | number | boolean | null | undefined>;

/**
 * Sends one usage event to PostHog without delaying the response: the send runs under `waitUntil`.
 * A no-op when `POSTHOG_KEY` is unset, which is everywhere but production (it is a Worker secret
 * there, set once with `wrangler secret put POSTHOG_KEY`), so dev, tests and CI send nothing.
 * Never pass card or deck contents as properties: only names, counts and enums.
 */
export function track(
  env: Pick<Bindings, "POSTHOG_KEY" | "POSTHOG_HOST">,
  ctx: Pick<ExecutionContext, "waitUntil"> | undefined,
  event: string,
  properties: AnalyticsProperties = {},
): void {
  if (!env.POSTHOG_KEY) return;

  // One client per request with no batching: a Worker can stop before a batch would flush.
  const posthog = new PostHog(env.POSTHOG_KEY, { host: env.POSTHOG_HOST, flushAt: 1, flushInterval: 0 });
  const sent = posthog
    .captureImmediate({
      // Every deck belongs to the system user until accounts exist (#12).
      distinctId: SYSTEM_USER_ID,
      event,
      // Anonymous events: no person profile until there are real users to identify.
      properties: { ...properties, $process_person_profile: false },
    })
    .catch((error) => console.error(`analytics: ${event} not sent`, error));
  ctx?.waitUntil(sent);
}
