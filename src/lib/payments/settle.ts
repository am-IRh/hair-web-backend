// src/lib/payments/settle.ts
import { and, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { course, enrollment, payment } from "../../db/schema.js";
import { creditWallet, debitWallet } from "../wallet.js";
import { getGateway } from "./index.js";

export type SettleResult = "success" | "failed" | "pending" | "unknown";
export type SettleOutcome = { result: SettleResult; courseSlug: string | null };

export async function settlePayment(input: {
  authority: string | undefined;
  callbackStatus: string | undefined;
}): Promise<SettleOutcome> {
  if (!input.authority) return { result: "unknown", courseSlug: null };

  const [p] = await db
    .select()
    .from(payment)
    .where(eq(payment.authority, input.authority))
    .limit(1);
  if (!p) return { result: "unknown", courseSlug: null };

  let courseSlug: string | null = null;
  if (p.courseId) {
    const [c] = await db
      .select({ slug: course.slug })
      .from(course)
      .where(eq(course.id, p.courseId))
      .limit(1);
    courseSlug = c?.slug ?? null;
  }
  const done = (result: SettleResult): SettleOutcome => ({ result, courseSlug });

  // Idempotency: an already settled payment only reports its stored outcome
  if (p.status === "paid") return done("success");
  if (p.status === "failed") return done("failed");

  const markFailed = () =>
    db
      .update(payment)
      .set({ status: "failed" })
      .where(and(eq(payment.id, p.id), eq(payment.status, "pending")));

  // The query string is user-controlled; "OK" alone proves nothing.
  if (input.callbackStatus !== "OK") {
    await markFailed();
    return done("failed");
  }

  // Verify OUTSIDE the DB transaction: never hold a transaction open during an HTTP call.
  // The amount comes from OUR database, never from the request.
  let verified;
  try {
    verified = await getGateway().verify({ authority: input.authority, amount: p.amount });
  } catch (err) {
    // The user may have been charged. Keep it pending for reconciliation, don't fail it.
    console.error("[payment] verify error", p.id, err instanceof Error ? err.message : err);
    return done("pending");
  }

  if (!verified.ok) {
    await markFailed();
    return done("failed");
  }

  const { refId, cardPan } = verified;

  await db.transaction(async (tx) => {
    // Only the request that flips pending -> paid is allowed to touch the wallet
    const [claimed] = await tx
      .update(payment)
      .set({ status: "paid", refId, cardPan: cardPan ?? null, paidAt: new Date() })
      .where(and(eq(payment.id, p.id), eq(payment.status, "pending")))
      .returning({ id: payment.id });

    if (!claimed) return;

    await creditWallet(tx, {
      userId: p.userId,
      amount: p.amount,
      paymentId: p.id,
      description: p.courseId ? "پرداخت آنلاین" : "شارژ کیف پول",
    });

    if (!p.courseId) return;

    // Course payment: spend the money we just credited, in the same transaction
    const [target] = await tx
      .select({ id: course.id, title: course.title })
      .from(course)
      .where(eq(course.id, p.courseId))
      .limit(1);

    const [owned] = await tx
      .select({ id: enrollment.id })
      .from(enrollment)
      .where(and(eq(enrollment.userId, p.userId), eq(enrollment.courseId, p.courseId)))
      .limit(1);

    // Already owned (paid twice) or course removed: the money simply stays as wallet credit
    if (!target || owned) return;

    const [created] = await tx
      .insert(enrollment)
      .values({ userId: p.userId, courseId: target.id, pricePaid: p.amount, paymentId: p.id })
      .returning({ id: enrollment.id });

    await debitWallet(tx, {
      userId: p.userId,
      amount: p.amount,
      enrollmentId: created.id,
      description: `خرید دوره ${target.title}`,
    });
  });

  return done("success");
}