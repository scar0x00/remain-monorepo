import { parse as parseYaml, stringify as toYaml } from "yaml";
import { z } from "zod";
import { DeckFileSchema, normalizeDeck, type Deck } from "./schema";

const DECK_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;

const BooleanFlag = z.union([
  z.boolean(),
  z.enum(["true", "false"]).transform((value) => value === "true"),
]);

export const RequestSchema = z.object({
  deckName: z
    .string()
    .transform((name) => name.replace(/\.(json|ya?ml)$/i, ""))
    .pipe(
      z
        .string()
        .regex(
          DECK_NAME_PATTERN,
          "deckName must be 1-100 letters, digits, '-' or '_'",
        ),
    ),
  format: z.enum(["json", "yaml"]).default("json"),
  cardCount: z.coerce.number().int().min(1).max(200).optional(),
  instructions: z.string().max(2000).optional(),
  text: z.string().optional(),
  overwrite: BooleanFlag.default(false),
  refine: BooleanFlag.default(false),
});

export type DeckInput = z.infer<typeof RequestSchema>;
export type DeckFormat = DeckInput["format"];

export async function parseRequest(request: Request) {
  const { fields, files } = await readRequest(request);
  const parsed = RequestSchema.safeParse(fields);

  if (!parsed.success) {
    return {
      success: false as const,
      error: parsed.error.issues.map((issue) => issue.message).join("; "),
    };
  }

  return { success: true as const, data: parsed.data, files };
}

async function readRequest(
  request: Request,
): Promise<{ fields: Record<string, unknown>; files: File[] }> {
  if (request.headers.get("content-type")?.includes("multipart/form-data")) {
    const form = await request.formData();
    const fields = Object.fromEntries(
      [...form.entries()].filter(([, value]) => typeof value === "string"),
    );
    const files = form
      .getAll("files")
      .filter((value): value is File => value instanceof File);
    return { fields, files };
  }

  const body = await request.json().catch(() => null);
  return { fields: (body ?? {}) as Record<string, unknown>, files: [] };
}

export function isPlainText(file: File): boolean {
  const mediaType = file.type.split(";")[0]?.trim() ?? "";
  return (
    mediaType.startsWith("text/") ||
    mediaType === "application/json" ||
    mediaType === "application/x-tex" ||
    mediaType === "application/x-latex" ||
    /\.(md|txt|json|ya?ml|csv|tex|latex)$/i.test(file.name)
  );
}

export function isPdf(file: File): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

// Always writes the v2 format.
export function serializeDeck(deck: Deck, format: DeckFormat): string {
  if (format === "json") {
    return `${JSON.stringify(deck, null, 2)}\n`;
  }
  return toYaml(deck);
}

// Reads a legacy array or a v2 deck and returns it as v2. Null when the text is not a valid deck.
export function parseDeck(text: string, format: DeckFormat): Deck | null {
  let value: unknown;
  try {
    value = format === "json" ? JSON.parse(text) : parseYaml(text);
  } catch {
    return null;
  }

  const parsed = DeckFileSchema.safeParse(value);
  return parsed.success ? normalizeDeck(parsed.data) : null;
}
