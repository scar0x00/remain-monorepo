import { type Client } from "pg";

export type Env = {
  Bindings: {
    PG: Hyperdrive;
    DECKS: R2Bucket;
    FLASHCARD_AGENT: Fetcher;
  };
  Variables: {
    pg: Client;
    userId: string;
  };
};
