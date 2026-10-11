import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { Agent } from "agents";
import { createAI } from "agents/models/ai-sdk";
import { generateText, Output } from "ai";
import { DeckOutputSchema, type Deck } from "./schema";
import {
  hasExtractedText,
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
  formatSources,
  SYSTEM_PROMPT,
  type SourceDocument,
} from "./prompts";

const GATEWAY_ID = "default";
const MODEL = "anthropic/claude-haiku-5.5";
const MAX_SOURCE_CHARS = 150_000;

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

    const sourceText = formatSources(sources);
    if (sourceText.length > MAX_SOURCE_CHARS) {
      return Response.json(
        { error: "Source material is too large. Split it into smaller decks" },
        { status: 413 },
      );
    }

    const cards = await this.generateCards(
      buildCreatePrompt({
        sourceText,
        cardCount: input.cardCount,
        instructions: input.instructions,
      }),
      pdfs,
    );
    return this.saveDeck(key, input.format, cards, 201);
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
    if (sourceText && sourceText.length > MAX_SOURCE_CHARS) {
      return Response.json(
        { error: "Source material is too large. Split it into smaller decks" },
        { status: 413 },
      );
    }

    const cards = await this.generateCards(
      buildRefinePrompt({
        currentDeck,
        instructions: input.instructions,
        sourceText,
      }),
      pdfs,
    );
    return this.saveDeck(stored.key, stored.format, cards, 200);
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
    cards: Deck,
    status: 200 | 201,
  ): Promise<Response> {
    await this.env.DECKS.put(key, serializeDeck(cards, format), {
      httpMetadata: {
        contentType:
          format === "json" ? "application/json" : "application/yaml",
      },
    });

    return Response.json({ key, format, cardCount: cards.length }, { status });
  }

  // Returns the text sources, plus any PDFs that Workers AI could not extract text from.
  // Those PDFs are sent to the model as files instead, which reads the rendered pages.
  private async collectSources(
    files: File[],
    text: string | undefined,
  ): Promise<{ sources: SourceDocument[]; pdfs: File[] }> {
    const sources: SourceDocument[] = [];
    const pdfs: File[] = [];

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

        const file = convertibleFiles.find((candidate) => candidate.name === result.name);
        if (file && isPdf(file) && !hasExtractedText(result.data)) {
          console.warn(`No text extracted from ${result.name}; sending the PDF to the model`);
          pdfs.push(file);
          continue;
        }
        sources.push({ name: result.name, content: result.data });
      }
    }

    return { sources, pdfs };
  }

  private async generateCards(prompt: string, pdfs: File[]): Promise<Deck> {
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
        schema: DeckOutputSchema,
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

    return result.output.cards;
  }
}
