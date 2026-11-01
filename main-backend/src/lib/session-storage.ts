import type { SecondaryStorage } from "better-auth";
import { Redis } from "@upstash/redis/cloudflare";
import { type Bindings } from "../types";

/** The part of the Upstash client the session store uses, so tests can pass a fake. */
export type RedisLike = Pick<Redis, "get" | "getdel" | "set" | "del" | "eval">;

// INCR, and set the TTL only when INCR created the key, in one round trip. better-auth's rate
// limiter needs both in one atomic step, and the window must not move with later increments.
const INCREMENT = `local v = redis.call('INCR', KEYS[1])
if v == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return v`;

/**
 * better-auth secondary storage on Upstash Redis (REST over fetch, so it works on Workers).
 * Holds sessions, verification tokens and rate-limit counters.
 */
export function redisSecondaryStorage(redis: RedisLike): SecondaryStorage {
  return {
    get: (key) => redis.get<string>(key),
    getAndDelete: (key) => redis.getdel<string>(key),
    set: async (key, value, ttl) => {
      // Upstash rejects EX 0; better-auth passes no TTL for values that never expire.
      if (ttl && ttl > 0) await redis.set(key, value, { ex: Math.ceil(ttl) });
      else await redis.set(key, value);
    },
    delete: async (key) => {
      await redis.del(key);
    },
    increment: async (key, ttl) => Number(await redis.eval(INCREMENT, [key], [Math.max(1, Math.ceil(ttl))])),
  };
}

/** Upstash is optional: without its credentials, sessions live in Postgres (local dev, tests). */
export function createSecondaryStorage(
  env: Pick<Bindings, "UPSTASH_REDIS_REST_URL" | "UPSTASH_REDIS_REST_TOKEN">,
): SecondaryStorage | undefined {
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) return undefined;

  return redisSecondaryStorage(
    new Redis({
      url: env.UPSTASH_REDIS_REST_URL,
      token: env.UPSTASH_REDIS_REST_TOKEN,
      // better-auth stores JSON strings and parses them itself.
      automaticDeserialization: false,
    }),
  );
}
