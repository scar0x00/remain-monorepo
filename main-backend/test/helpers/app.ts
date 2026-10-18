import { mock } from "bun:test";
import { FakeClient } from "./fake-pg";

// Set TEST_PG_URL to run chat-api.test.ts against a real Postgres that has migrations
// 0001 and 0002 applied (and a `user` table), instead of the in-memory FakeClient.
export const realPgUrl = process.env.TEST_PG_URL;

if (!realPgUrl) {
  mock.module("pg", () => ({ Client: FakeClient }));
}

// Stands in for the real user lookup (#12): tests pick the caller with an `x-test-user` header.
mock.module("../../src/lib/current-user", () => ({
  SYSTEM_USER_ID: "system",
  currentUserMiddleware: async (
    c: { set(key: string, value: string): void; req: { header(name: string): string | undefined } },
    next: () => Promise<void>,
  ) => {
    c.set("userId", c.req.header("x-test-user") ?? "system");
    await next();
  },
}));

export const { default: app } = await import("../../src/index");
