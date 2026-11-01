import { describe, expect, it } from "bun:test";
import { requestUser } from "../../src/user";

function fakeBucket() {
  const keys: string[] = [];
  const bucket = {
    get: async (key: string) => (keys.push(key), null),
    head: async (key: string) => (keys.push(key), null),
    put: async (key: string) => (keys.push(key), null),
  };
  return { keys, bucket: bucket as unknown as R2Bucket };
}

const request = (headers: Record<string, string>) => new Request("http://agent/agents/flashcard-agent/u1:d", { method: "POST", headers });

describe("requestUser", () => {
  it("scopes every R2 key under the user's id and decodes the display name", async () => {
    const { keys, bucket } = fakeBucket();
    const user = requestUser(request({ "x-remain-user-id": "u1", "x-remain-user-name": encodeURIComponent("Zoë") }), bucket)!;

    expect(user.author).toEqual({ id: "u1", name: "Zoë" });
    await user.bucket.head("deck.json");
    await user.bucket.get("deck.yaml");
    await user.bucket.put("deck.json", "{}");
    expect(keys).toEqual(["u1/deck.json", "u1/deck.yaml", "u1/deck.json"]);
  });

  it("refuses a request without a usable user id", () => {
    const { bucket } = fakeBucket();
    expect(requestUser(request({}), bucket)).toBeNull();
    expect(requestUser(request({ "x-remain-user-id": "a/b" }), bucket)).toBeNull();
  });
});
