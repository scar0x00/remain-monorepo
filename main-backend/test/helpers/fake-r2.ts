type StoredObject = {
  key: string;
  bytes: Uint8Array;
  contentType?: string;
  httpEtag: string;
  uploaded: Date;
};

type Conditional = { etagMatches?: string } | Headers;

// The etags an `onlyIf` requires, unquoted, or undefined when it requires none.
function requiredEtags(onlyIf?: Conditional) {
  const raw = onlyIf instanceof Headers ? onlyIf.get("if-match") : onlyIf?.etagMatches;
  return raw?.split(",").map((etag) => etag.trim().replace(/^"|"$/g, ""));
}

export function createFakeR2() {
  const objects = new Map<string, StoredObject>();

  const toObject = (stored: StoredObject) => ({
    key: stored.key,
    size: stored.bytes.byteLength,
    etag: stored.httpEtag.replace(/^"|"$/g, ""),
    httpEtag: stored.httpEtag,
    uploaded: stored.uploaded,
    writeHttpMetadata(headers: Headers) {
      if (stored.contentType) headers.set("content-type", stored.contentType);
    },
    get body() {
      return new Response(stored.bytes).body;
    },
    async text() {
      return new TextDecoder().decode(stored.bytes);
    },
  });

  return {
    objects,
    async put(
      key: string,
      value: ArrayBuffer | string,
      options?: { httpMetadata?: { contentType?: string }; onlyIf?: Conditional },
    ) {
      // Like R2, a failed condition writes nothing and returns null.
      const required = requiredEtags(options?.onlyIf);
      if (required && !required.includes("*")) {
        const current = objects.get(key)?.httpEtag.replace(/^"|"$/g, "");
        if (!current || !required.includes(current)) return null;
      }
      const bytes =
        typeof value === "string"
          ? new TextEncoder().encode(value)
          : new Uint8Array(value);
      const stored: StoredObject = {
        key,
        bytes,
        contentType: options?.httpMetadata?.contentType ?? undefined,
        httpEtag: `"${bytes.byteLength}-${Math.random().toString(36).slice(2)}"`,
        uploaded: new Date(),
      };
      objects.set(key, stored);
      return toObject(stored);
    },
    async get(key: string) {
      const stored = objects.get(key);
      return stored ? toObject(stored) : null;
    },
    async head(key: string) {
      const stored = objects.get(key);
      return stored ? toObject(stored) : null;
    },
    async delete(key: string) {
      objects.delete(key);
    },
  };
}

export type FakeR2 = ReturnType<typeof createFakeR2>;
