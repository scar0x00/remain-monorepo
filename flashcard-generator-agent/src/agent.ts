import { Agent } from "agents";
import { generateText, Output } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { stringify as toYaml } from "yaml";
import { z } from "zod";
import { DeckOutputSchema, type Deck } from "./schema";

const MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";
const MAX_SOURCE_CHARS = 150_000;
const DECK_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;

const RequestSchema = z.object({
  deckName: z
    .string()
    .transform((name) => name.replace(/\.(json|ya?ml)$/i, ""))
    .pipe(z.string().regex(DECK_NAME_PATTERN, "deckName must be 1-100 letters, digits, '-' or '_'")),
  format: z.enum(["json", "yaml"]).default("json"),
  cardCount: z.coerce.number().int().min(1).max(200).default(20),
  instructions: z.string().max(2000).optional(),
  text: z.string().optional(),
  overwrite: z
    .union([z.boolean(), z.enum(["true", "false"]).transform((value) => value === "true")])
    .default(false),
});

const SYSTEM_PROMPT = `You create study flashcards from source material.
Each card has a "front" (a clear question or prompt) and a "back" (a concise, accurate answer).
- Cover the most important facts, definitions, processes and concepts in the source.
- Keep every card self-contained and atomic: one idea per card.
- Only use information present in the source material. Do not invent facts.
- Use Markdown inline code for identifiers, commands and code, e.g. \`list.append()\`.
- Write the cards in the same language as the source material.`;

type SourceDocument = { name: string; content: string };

export class FlashcardAgent extends Agent<Env> {
  async onRequest(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return Response.json({ error: "Use POST to generate a deck" }, { status: 405 });
    }

    const parsed = await parseRequest(request);
    if (!parsed.success) {
      return Response.json({ error: parsed.error }, { status: 400 });
    }
    const input = parsed.data;

    const key = `${input.deckName}.${input.format}`;
    if (!input.overwrite && (await this.env.DECKS.head(key))) {
      return Response.json({ error: `Deck ${key} already exists. Set overwrite to replace it` }, { status: 409 });
    }

    const sources = await this.collectSources(parsed.files, input.text);
    if (sources.length === 0) {
      return Response.json({ error: "Provide source text or at least one file" }, { status: 400 });
    }

    const sourceText = sources.map((source) => `<source name="${source.name}">\n${source.content}\n</source>`).join("\n\n");
    if (sourceText.length > MAX_SOURCE_CHARS) {
      return Response.json({ error: "Source material is too large. Split it into smaller decks" }, { status: 413 });
    }

    const cards = await this.generateCards(sourceText, input.cardCount, input.instructions);
    const body = serializeDeck(cards, input.format);

    await this.env.DECKS.put(key, body, {
      httpMetadata: {
        contentType: input.format === "json" ? "application/json" : "application/yaml",
      },
    });

    return Response.json({ key, format: input.format, cardCount: cards.length }, { status: 201 });
  }

  private async collectSources(files: File[], text: string | undefined): Promise<SourceDocument[]> {
    const sources: SourceDocument[] = [];

    if (text?.trim()) {
      sources.push({ name: "text", content: text });
    }

    const plainFiles = files.filter(isPlainText);
    for (const file of plainFiles) {
      sources.push({ name: file.name, content: await file.text() });
    }

    const convertibleFiles = files.filter((file) => !isPlainText(file));
    if (convertibleFiles.length > 0) {
      const converted = await this.env.AI.toMarkdown(
        convertibleFiles.map((file) => ({ name: file.name, blob: file })),
      );

      for (const result of converted) {
        if (result.format === "error") {
          throw new Error(`Could not read ${result.name}: ${result.error}`);
        }
        sources.push({ name: result.name, content: result.data });
      }
    }

    return sources;
  }

  private async generateCards(sourceText: string, cardCount: number, instructions: string | undefined): Promise<Deck> {
    const workersai = createWorkersAI({ binding: this.env.AI });

    const result = await generateText({
      model: workersai(MODEL),
      output: Output.object({
        schema: DeckOutputSchema,
        name: "flashcard_deck",
        description: "A deck of flashcards generated from the source material",
      }),
      system: SYSTEM_PROMPT,
      prompt: [
        `Create exactly ${cardCount} flashcards from the source material below.`,
        instructions ? `Additional instructions: ${instructions}` : undefined,
        sourceText,
      ]
        .filter(Boolean)
        .join("\n\n"),
    });

    return result.output.cards;
  }
}

async function parseRequest(request: Request) {
  const { fields, files } = await readRequest(request);
  const parsed = RequestSchema.safeParse(fields);

  if (!parsed.success) {
    return { success: false as const, error: parsed.error.issues.map((issue) => issue.message).join("; ") };
  }

  return { success: true as const, data: parsed.data, files };
}

async function readRequest(request: Request): Promise<{ fields: Record<string, unknown>; files: File[] }> {
  if (request.headers.get("content-type")?.includes("multipart/form-data")) {
    const form = await request.formData();
    const fields = Object.fromEntries([...form.entries()].filter(([, value]) => typeof value === "string"));
    const files = form.getAll("files").filter((value): value is File => value instanceof File);
    return { fields, files };
  }

  const body = await request.json().catch(() => null);
  return { fields: (body ?? {}) as Record<string, unknown>, files: [] };
}

function isPlainText(file: File): boolean {
  return file.type.startsWith("text/") || file.type === "application/json" || /\.(md|txt|json|ya?ml|csv)$/i.test(file.name);
}

function serializeDeck(cards: Deck, format: "json" | "yaml"): string {
  if (format === "json") {
    return `${JSON.stringify(cards, null, 2)}\n`;
  }
  return toYaml(cards);
}
