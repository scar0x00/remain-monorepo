import { describe, expect, it } from "bun:test";
import { createSecondaryStorage, redisSecondaryStorage, type RedisLike } from "../../src/lib/session-storage";

function recordingRedis() {
  const calls: unknown[][] = [];
  const redis = new Proxy({}, {
    get: (_, method: string) => async (...args: unknown[]) => {
      calls.push([method, ...args]);
      return method === "eval" ? 3 : null;
    },
  }) as unknown as RedisLike;
  return { calls, redis };
}

describe("Upstash session store", () => {
  it("maps better-auth's storage calls to Redis commands", async () => {
    const { calls, redis } = recordingRedis();
    const storage = redisSecondaryStorage(redis);

    await storage.set("k", "v", 59.5);
    await storage.set("forever", "v");
    await storage.get("k");
    await storage.getAndDelete("k");
    await storage.delete("k");
    expect(await storage.increment("rl", 60)).toBe(3);

    expect(calls).toEqual([
      ["set", "k", "v", { ex: 60 }],
      ["set", "forever", "v"],
      ["get", "k"],
      ["getdel", "k"],
      ["del", "k"],
      ["eval", expect.stringContaining("EXPIRE"), ["rl"], [60]],
    ]);
  });

  it("is off without both Upstash credentials", () => {
    expect(createSecondaryStorage({})).toBeUndefined();
    expect(createSecondaryStorage({ UPSTASH_REDIS_REST_URL: "https://x.upstash.io" })).toBeUndefined();
    expect(createSecondaryStorage({ UPSTASH_REDIS_REST_URL: "https://x.upstash.io", UPSTASH_REDIS_REST_TOKEN: "t" })).toBeDefined();
  });
});
