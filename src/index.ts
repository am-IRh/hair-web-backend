import { Hono } from "hono";
import { cors } from "hono/cors";
import { auth } from "./lib/auth";
import { env } from "./env";
import { HTTPException } from "hono/http-exception";
import { protectedApi } from "./routes/protected";
import { publicApi } from "./routes/public";

const app = new Hono();

app.use(
  "/api/auth/*",
  cors({
    origin: env.WEB_ORIGIN,
    credentials: true,
  })
);
app.route("/api", publicApi);
app.all("/api/auth/*", (c) => auth.handler(c.req.raw));
app.route("/api", protectedApi);

app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse();
  console.error("[unhandled]", err);
  return c.json({ error: "internal_error" }, 500);
});

export default {
  port: env.PORT,
  fetch: app.fetch,
};
