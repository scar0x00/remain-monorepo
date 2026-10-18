import { type MiddlewareHandler } from "hono";
import { Client } from "pg";
import { type Env } from "../types";

export const pgDbMiddleware: MiddlewareHandler<Env> = async (c, next) => {
  const client = new Client({
    connectionString: c.env.PG.connectionString,
  });

  await client.connect();
  c.set("pg", client);

  try {
    await next();
  } finally {
    await client.end();
  }
};
