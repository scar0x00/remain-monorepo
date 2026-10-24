import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { Agent } from "agents";
import { createAI } from "agents/models/ai-sdk";
import { generateText, Output } from "ai";
import type { z } from "zod";
import { batchPdfs } from "./pdf";
import { buildDeck, mergeRefinedDeck } from "./deck";
import { DeckOutputSchema, RefineOutputSchema, type Deck, type ModelCard } from "./schema";
import {
  isPdf,
  isPlainText,
  parseDeck,
  parseRequest,
  serializeDeck,
  type DeckFormat,
  type DeckInput,
} from "./input";
import {
  buildCreatePrompt,
  buildRefinePrompt,
  chunkSources,
  formatSources,
  SYSTEM_PROMPT,
  type SourceDocument,
} from "./prompts";

const GATEWAY_ID = "default";
const MODEL = "anthropic/claude-haiku-5.5";
// Source text beyond this is split into parts, each turned into cards by its own model call.
const MAX_CHUNK_CHARS = 100_000;
const MAX_JOBS = 8;

const FORMATS: DeckFormat[] = ["json", "yaml"];

export class FlashcardAgent extends Agent<Env> {
  async onRequest(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return Response.json(
        { error: "Use POST to generate a deck" },
        { status: 405 },
      );
    }

    const parsed = await parseRequest(request);
    if (!parsed.success) {
      return Response.json({ error: parsed.error }, { status: 400 });
    }

    return parsed.data.refine
      ? this.refineDeck(parsed.data, parsed.files)
      : this.createDeck(parsed.data, parsed.files);
  }

  private async createDeck(input: DeckInput, files: File[]): Promise<Response> {
    const key = `${input.deckName}.${input.format}`;
    if (!input.overwrite && (await this.env.DECKS.head(key))) {
      return Response.json(
        { error: `Deck ${key} already exists. Set overwrite to replace it` },
        { status: 409 },
      );
    }

    const { sources, pdfs } = await this.collectSources(files, input.text);
    if (sources.length === 0 && pdfs.length === 0) {
      return Response.json(
        { error: "Provide source text or at least one file" },
        { status: 400 },
      );
    }

    const textChunks = chunkSources(sources, MAX_CHUNK_CHARS);
    const pdfBatches = await batchPdfs(pdfs);

    // Each job is one model call. The first text chunk shares its call with the first batch of PDFs.
    const jobs: { sources: SourceDocument[]; pdfs: File[] }[] = textChunks.map((chunk, i) => ({
      sources: chunk,
      pdfs: i === 0 ? (pdfBatches[0] ?? []) : [],
    }));
    for (const batch of pdfBatches.slice(textChunks.length > 0 ? 1 : 0)) {
      jobs.push({ sources: [], pdfs: batch });
    }

    if (jobs.length > MAX_JOBS) {
      return Response.json(
        { error: "Source material is too large. Split it into smaller decks" },
        { status: 413 },
      );
    }

    // Deck-level fields come from the first job; every job adds cards.
    let first: Omit<z.infer<typeof DeckOutputSchema>, "cards"> | undefined;
    const cards: ModelCard[] = [];
    for (const [i, job] of jobs.entries()) {
      const cardCount = input.cardCount
        ? Math.max(1, Math.round(input.cardCount / jobs.length))
        : undefined;
      const { cards: jobCards, ...deckFields } = await this.generate(
        DeckOutputSchema,
        buildCreatePrompt({
          sourceText: formatSources(job.sources),
          cardCount,
          instructions: input.instructions,
          part: jobs.length > 1 ? { index: i + 1, total: jobs.length } : undefined,
        }),
        job.pdfs,
      );
      first ??= deckFields;
      cards.push(...jobCards);
    }

    const deck = buildDeck({
      ...first,
      cards,
      model: MODEL,
      sources: [...sources.map((source) => source.name), ...pdfs.map((file) => file.name)],
    });
    return this.saveDeck(key, input.format, deck, 201);
  }

  private async refineDeck(input: DeckInput, files: File[]): Promise<Response> {
    const stored = await this.loadDeck(input.deckName);
    if (!stored) {
      return Response.json(
        { error: `Deck ${input.deckName} does not exist` },
        { status: 404 },
      );
    }

    const currentDeck = parseDeck(stored.text, stored.format);
    if (!currentDeck) {
      return Response.json(
        { error: `Deck ${stored.key} could not be read` },
        { status: 500 },
      );
    }

    if (!input.instructions && files.length === 0) {
      return Response.json(
        { error: "Describe the change to make, or attach source files" },
        { status: 400 },
      );
    }

    const { sources, pdfs } = await this.collectSources(files, undefined);
    const sourceText = sources.length > 0 ? formatSources(sources) : undefined;
    if ((sourceText && sourceText.length > MAX_CHUNK_CHARS) || (await batchPdfs(pdfs)).length > 1) {
      return Response.json(
        {
          error:
            "Source material is too large to add to an existing deck. Attach a shorter file, or create a new deck from it",
        },
        { status: 413 },
      );
    }

    const { cards } = await this.generate(
      RefineOutputSchema,
      buildRefinePrompt({
        currentDeck,
        instructions: input.instructions,
        sourceText,
      }),
      pdfs,
    );
    const deck = mergeRefinedDeck(currentDeck, cards, files.map((file) => file.name));
    return this.saveDeck(stored.key, stored.format, deck, 200);
  }

  private async loadDeck(
    deckName: string,
  ): Promise<{ key: string; format: DeckFormat; text: string } | null> {
    for (const format of FORMATS) {
      const key = `${deckName}.${format}`;
      const object = await this.env.DECKS.get(key);
      if (object) {
        return { key, format, text: await object.text() };
      }
    }
    return null;
  }

  private async saveDeck(
    key: string,
    format: DeckFormat,
    deck: Deck,
    status: 200 | 201,
  ): Promise<Response> {
    await this.env.DECKS.put(key, serializeDeck(deck, format), {
      httpMetadata: {
        contentType:
          format === "json" ? "application/json" : "application/yaml",
      },
    });

    return Response.json({ key, format, cardCount: deck.cards.length }, { status });
  }

  // Returns the text sources, plus the PDFs. PDFs are never converted to markdown: they are sent
  // to the model as files, which reads both the text and the rendered pages.
  private async collectSources(
    files: File[],
    text: string | undefined,
  ): Promise<{ sources: SourceDocument[]; pdfs: File[] }> {
    const sources: SourceDocument[] = [];
    const pdfs: File[] = [];

    if (text?.trim()) {
      sources.push({ name: "text", content: text });
    }

    for (const file of files.filter(isPlainText)) {
      sources.push({ name: file.name, content: await file.text() });
    }

    pdfs.push(...files.filter((file) => !isPlainText(file) && isPdf(file)));

    const convertibleFiles = files.filter((file) => !isPlainText(file) && !isPdf(file));
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

    return { sources, pdfs };
  }

  private async generate<T>(schema: z.ZodType<T>, prompt: string, pdfs: File[]): Promise<T> {
    const ai = createAI({ binding: this.env.AI, id: GATEWAY_ID });
    const openrouter = createOpenRouter({ apiKey: "cloudflare" });

    const documents = await Promise.all(
      pdfs.map(async (file) => ({
        type: "file" as const,
        data: new Uint8Array(await file.arrayBuffer()),
        mediaType: "application/pdf",
        filename: file.name,
      })),
    );

    const result = await generateText({
      model: ai(openrouter(MODEL)),
      output: Output.object({
        schema,
        name: "flashcard_deck",
        description: "A deck of flashcards generated from the source material",
      }),
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [...documents, { type: "text", text: prompt }],
        },
      ],
    });

    return result.output;
  }
}
