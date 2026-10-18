import { type MiddlewareHandler } from "hono";
import { type Env } from "../types";

// Placeholder owner of all data until authentication (#12) lands.
export const SYSTEM_USER_ID = "system";

// The single seam for "who is calling". Route handlers read `c.get("userId")` and scope their
// queries by it. #12 replaces the body with a better-auth session lookup (401 when signed out);
// nothing else in the chat code needs to change.
export const currentUserMiddleware: MiddlewareHandler<Env> = async (c, next) => {
  c.set("userId", SYSTEM_USER_ID);
  await next();
};
