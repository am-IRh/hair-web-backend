import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "../../db";
import { payment } from "../../db/schema";
import { env } from "../../env";
import { getGateway } from "./index";

const MAX_PENDING_PER_HOUR = 10;

type StartResult = { ok: true; redirectUrl: string } | { ok: false; status: 429 | 502 };

// Shared by wallet top-ups and direct course checkout
export async function startGatewayPayment(args: {
  user: { id: string; phoneNumber?: string | null };
  amount: number; // Toman, decided by the server, never by the client (except top-ups, which are range-checked)
  description: string;
  courseId?: string;
}): Promise<StartResult> {
  const { user, amount, description, courseId } = args;

  // Basic abuse guard: too many unfinished payments in the last hour
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(payment)
    .where(
      and(
        eq(payment.userId, user.id),
        eq(payment.status, "pending"),
        gte(payment.createdAt, new Date(Date.now() - 3_600_000)),
      ),
    );
  if (count >= MAX_PENDING_PER_HOUR) return { ok: false, status: 429 };

  const gateway = getGateway();
  const [created] = await db
    .insert(payment)
    .values({ userId: user.id, amount, gateway: gateway.name, courseId })
    .returning({ id: payment.id });

  try {
    const { authority, redirectUrl } = await gateway.start({
      paymentId: created.id,
      amount,
      // Public URL the user's browser can reach (the Next origin)
      callbackUrl: `${env.BETTER_AUTH_URL}/api/payments/callback`,
      description,
      mobile: user.phoneNumber ?? undefined,
    });
    await db.update(payment).set({ authority }).where(eq(payment.id, created.id));
    return { ok: true, redirectUrl };
  } catch (err) {
    console.error("[payment] start error", created.id, err instanceof Error ? err.message : err);
    await db.update(payment).set({ status: "failed" }).where(eq(payment.id, created.id));
    return { ok: false, status: 502 };
  }
}