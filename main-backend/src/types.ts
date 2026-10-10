import { type Client } from "pg";

export type Env = {
  Bindings: {
    PG: Hyperdrive;
    DECKS: R2Bucket;
  };
  Variables: {
    pg: Client;
  };
};