import { type Client } from "pg";

export type Bindings = {
  PG: Hyperdrive;
  DECKS: R2Bucket;
  FLASHCARD_AGENT: Fetcher;
  // e.g. https://<team>.cloudflareaccess.com
  ACCESS_TEAM_DOMAIN: string;
  // Application Audience (AUD) tag of the Access application protecting /mcp.
  ACCESS_AUD: string;
  // Local dev only (.dev.vars): skip Access JWT verification because there is no Access in front.
  DEV_SKIP_ACCESS_AUTH?: string;
};

export type Env = {
  Bindings: Bindings;
  Variables: {
    pg: Client;
  };
};
