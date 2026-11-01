import { PostHog } from "posthog-node";
import { type Bindings } from "../types";

export type AnalyticsProperties = Record<string, string | number | boolean | null | undefined>;

/**
 * Sends one usage event to PostHog without delaying the response: the send runs under `waitUntil`.
 * A no-op when `POSTHOG_KEY` is unset, which is everywhere but production (it is a Worker secret
 * there, set once with `wrangler secret put POSTHOG_KEY`), so dev, tests and CI send nothing.
 * Never pass card or deck contents as properties: only names, counts and enums. `userId` is the
 * opaque account id, never the email or name.
 */
export function track(
  env: Pick<Bindings, "POSTHOG_KEY" | "POSTHOG_HOST">,
  ctx: Pick<ExecutionContext, "waitUntil"> | undefined,
  userId: string,
  event: string,
  properties: AnalyticsProperties = {},
): void {
  if (!env.POSTHOG_KEY) return;

  // One client per request with no batching: a Worker can stop before a batch would flush.
  const posthog = new PostHog(env.POSTHOG_KEY, { host: env.POSTHOG_HOST, flushAt: 1, flushInterval: 0 });
  const sent = posthog
    .captureImmediate({
      distinctId: userId,
      event,
      // No person profiles: events are counted per account id, with nothing personal attached.
      properties: { ...properties, $process_person_profile: false },
    })
    .catch((error) => console.error(`analytics: ${event} not sent`, error));
  ctx?.waitUntil(sent);
}
