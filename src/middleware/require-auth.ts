import { createMiddleware } from "hono/factory";
import { auth } from "../lib/auth";

export type AuthEnv = {
  Variables: {
    user: typeof auth.$Infer.Session.user;
    session: typeof auth.$Infer.Session.session;
  };
};

export const requireAuth = createMiddleware<AuthEnv>(async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthorized" }, 401);

  c.set("user", session.user);
  c.set("session", session.session);
  await next();
});