// Who the request is for, set by main-backend. This worker is only reachable through main-backend's
// service binding (workers_dev is off and it has no routes), so the headers can be trusted.
export const USER_ID_HEADER = "x-remain-user-id";
export const USER_NAME_HEADER = "x-remain-user-name";

export type DeckBucket = Pick<R2Bucket, "get" | "head" | "put">;

/** Who a request is for, and the R2 bucket as that user sees it: every key is under `<userId>/`. */
export function requestUser(request: Request, bucket: DeckBucket) {
  const id = request.headers.get(USER_ID_HEADER);
  if (!id || id.includes("/")) return null;
  let name = "";
  try {
    name = decodeURIComponent(request.headers.get(USER_NAME_HEADER) ?? "");
  } catch {}
  const scoped = (key: string) => `${id}/${key}`;
  const userBucket: DeckBucket = {
    get: ((key: string, options?: R2GetOptions) => bucket.get(scoped(key), options)) as R2Bucket["get"],
    head: (key) => bucket.head(scoped(key)),
    put: ((key: string, value: Parameters<R2Bucket["put"]>[1], options?: R2PutOptions) =>
      bucket.put(scoped(key), value, options)) as R2Bucket["put"],
  };
  return { author: { id, name }, bucket: userBucket };
}

export type RequestUser = NonNullable<ReturnType<typeof requestUser>>;
