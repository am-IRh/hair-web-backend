import { env } from "../../env.js";
import type { PaymentGateway } from "./types.js";

export const mockGateway: PaymentGateway = {
  name: "mock",

  async start({ amount }) {
    const authority = `MOCK-${crypto.randomUUID()}`;
    // A fake gateway page that lives in the Next app (dev only, built next step)
    const url = new URL("/dev/mock-gateway", env.WEB_ORIGIN);
    url.searchParams.set("authority", authority);
    url.searchParams.set("amount", String(amount));
    return { authority, redirectUrl: url.toString() };
  },

  async verify({ authority }) {
    if (!authority.startsWith("MOCK-")) return { ok: false };
    return { ok: true, refId: String(Math.floor(Math.random() * 1e9)) };
  },
};