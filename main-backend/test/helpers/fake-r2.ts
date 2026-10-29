type StoredObject = {
  key: string;
  bytes: Uint8Array;
  contentType?: string;
  httpEtag: string;
  uploaded: Date;
};

export function createFakeR2() {
  const objects = new Map<string, StoredObject>();

  const toObject = (stored: StoredObject) => ({
    key: stored.key,
    size: stored.bytes.byteLength,
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
      options?: { httpMetadata?: { contentType?: string } },
    ) {
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
