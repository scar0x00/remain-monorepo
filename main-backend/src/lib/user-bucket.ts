/** The R2 methods deck code uses. */
export type DeckBucket = Pick<R2Bucket, "get" | "head" | "put" | "delete">;

/** R2 key of a user's deck file: every key is under the owner's id. */
export const userObjectKey = (userId: string, key: string) => `${userId}/${key}`;

/**
 * The bucket as one user sees it: keys are the plain deck file names the API speaks, stored under
 * `<userId>/`. Ownership is enforced by the key itself, so reads need no ownership query, and no
 * key a client sends can reach another user's prefix.
 */
export function userBucket(bucket: DeckBucket, userId: string): DeckBucket {
  if (!userId || userId.includes("/")) throw new Error("userBucket: invalid user id");
  const scoped = (key: string) => userObjectKey(userId, key);

  return {
    get: ((key: string, options?: R2GetOptions) => bucket.get(scoped(key), options)) as R2Bucket["get"],
    head: (key) => bucket.head(scoped(key)),
    put: ((key: string, value: Parameters<R2Bucket["put"]>[1], options?: R2PutOptions) =>
      bucket.put(scoped(key), value, options)) as R2Bucket["put"],
    delete: (keys) => bucket.delete(Array.isArray(keys) ? keys.map(scoped) : scoped(keys)),
  };
}
