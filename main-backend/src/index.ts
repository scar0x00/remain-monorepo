import { Hono } from "hono";

const app = new Hono();

app.get("/", (c) => {
  return c.text("Hello Hono!");
});


app.put("/deck", async (c) => {
  const body = await c.req.parseBody();
  const file = body["deck"];

  if (!(file instanceof File)) {
    return c.text("File is required", 400);
  }

  return c.json({
    name: file.name,
    size: file.size,
    type: file.type,
  });
});

export default app;
