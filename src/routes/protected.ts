import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, asc, desc, eq, gt } from "drizzle-orm";
import { db } from "../db";
import { course, enrollment, plan, subscription, wallet, walletTransaction } from "../db/schema";
import { findPublishedCourse, hasCourseAccess } from "../lib/courses";
import { startGatewayPayment } from "../lib/payments/start";
import { debitWallet, InsufficientBalanceError, lockWallet } from "../lib/wallet";
import { requireAuth, type AuthEnv } from "../middleware/require-auth";

const MIN_TOPUP = 10_000; // Toman, adjust to your business rules
const MAX_TOPUP = 50_000_000;
const DAY_MS = 86_400_000;

class PlanNotFoundError extends Error {}
class CourseNotFoundError extends Error {}

export const protectedApi = new Hono<AuthEnv>();

// Every private route MUST be registered on this router so nobody forgets the guard.
protectedApi.use("*", requireAuth);

protectedApi.get("/me", (c) => {
  const user = c.get("user");
  return c.json({ id: user.id, name: user.name, phoneNumber: user.phoneNumber ?? null });
});

/* ------------------------------- Wallet ---------------------------------- */

protectedApi.get("/wallet", async (c) => {
  const user = c.get("user");

  const [w] = await db
    .select({ balance: wallet.balance })
    .from(wallet)
    .where(eq(wallet.userId, user.id))
    .limit(1);

  const transactions = await db
    .select({
      id: walletTransaction.id,
      type: walletTransaction.type,
      amount: walletTransaction.amount,
      balanceAfter: walletTransaction.balanceAfter,
      description: walletTransaction.description,
      createdAt: walletTransaction.createdAt,
    })
    .from(walletTransaction)
    .where(eq(walletTransaction.userId, user.id))
    .orderBy(desc(walletTransaction.createdAt))
    .limit(20);

  return c.json({ balance: w?.balance ?? 0, transactions });
});

protectedApi.post(
  "/wallet/topup",
  zValidator("json", z.object({ amount: z.number().int().min(MIN_TOPUP).max(MAX_TOPUP) })),
  async (c) => {
    const user = c.get("user");
    const { amount } = c.req.valid("json");

    const r = await startGatewayPayment({ user, amount, description: "شارژ کیف پول" });
    if (!r.ok) {
      return c.json(
        { error: r.status === 429 ? "too_many_pending_payments" : "gateway_unavailable" },
        r.status,
      );
    }
    return c.json({ redirectUrl: r.redirectUrl });
  },
);
/* ----------------------------- Subscription ------------------------------ */

protectedApi.get("/subscription", async (c) => {
  const user = c.get("user");
  const now = new Date();

  // Everything that has not expired yet: the current one and any queued ones
  const rows = await db
    .select({
      id: subscription.id,
      planName: plan.name,
      startsAt: subscription.startsAt,
      endsAt: subscription.endsAt,
    })
    .from(subscription)
    .innerJoin(plan, eq(plan.id, subscription.planId))
    .where(and(eq(subscription.userId, user.id), gt(subscription.endsAt, now)))
    .orderBy(asc(subscription.startsAt));

  return c.json({
    active: rows.find((r) => r.startsAt <= now) ?? null,
    queued: rows.filter((r) => r.startsAt > now),
    accessUntil: rows.length ? rows[rows.length - 1].endsAt : null,
  });
});

protectedApi.post(
  "/subscription/purchase",
  zValidator("json", z.object({ planId: z.string().min(1), idempotencyKey: z.uuid() })),
  async (c) => {
    const user = c.get("user");
    const { planId, idempotencyKey } = c.req.valid("json");

    try {
      const result = await db.transaction(async (tx) => {
        // Serializes this user's money operations (also makes the replay check race-free)
        await lockWallet(tx, user.id);

        // Replay of the same request: return the original result, charge nothing
        const [existing] = await tx
          .select({ id: subscription.id, startsAt: subscription.startsAt, endsAt: subscription.endsAt })
          .from(subscription)
          .where(and(eq(subscription.userId, user.id), eq(subscription.idempotencyKey, idempotencyKey)))
          .limit(1);
        if (existing) return existing;

        // Price comes from the DB, never from the client
        const [p] = await tx
          .select()
          .from(plan)
          .where(and(eq(plan.id, planId), eq(plan.isActive, true)))
          .limit(1);
        if (!p) throw new PlanNotFoundError();

        // The new plan starts when the latest purchased one ends (purchases stack)
        const [last] = await tx
          .select({ endsAt: subscription.endsAt })
          .from(subscription)
          .where(eq(subscription.userId, user.id))
          .orderBy(desc(subscription.endsAt))
          .limit(1);

        const now = new Date();
        const startsAt = last && last.endsAt > now ? last.endsAt : now;
        const endsAt = new Date(startsAt.getTime() + p.durationDays * DAY_MS);

        const [created] = await tx
          .insert(subscription)
          .values({ userId: user.id, planId: p.id, startsAt, endsAt, pricePaid: p.price, idempotencyKey })
          .returning({ id: subscription.id, startsAt: subscription.startsAt, endsAt: subscription.endsAt });

        // Throws InsufficientBalanceError -> the whole transaction (incl. the insert above) rolls back
        if (p.price > 0) {
          await debitWallet(tx, {
            userId: user.id,
            amount: p.price,
            subscriptionId: created.id,
            description: `خرید ${p.name}`,
          });
        }

        return created;
      });

      return c.json({ subscription: result });
    } catch (err) {
      if (err instanceof PlanNotFoundError) return c.json({ error: "plan_not_found" }, 404);
      if (err instanceof InsufficientBalanceError) return c.json({ error: "insufficient_balance" }, 402);
      throw err;
    }
  },
);


/* -------------------------------- Courses -------------------------------- */

protectedApi.get("/me/courses", async (c) => {
  const user = c.get("user");

  const courses = await db
    .select({
      id: course.id,
      slug: course.slug,
      title: course.title,
      purchasedAt: enrollment.createdAt,
    })
    .from(enrollment)
    .innerJoin(course, eq(course.id, enrollment.courseId))
    .where(eq(enrollment.userId, user.id))
    .orderBy(desc(enrollment.createdAt));

  return c.json({ courses });
});

// Used by the purchase box on the public course page (UX only, not a security gate)
protectedApi.get("/courses/:slug/access", async (c) => {
  const user = c.get("user");
  const found = await findPublishedCourse(c.req.param("slug"));
  if (!found) return c.json({ error: "course_not_found" }, 404);

  const [owned, [w]] = await Promise.all([
    hasCourseAccess(user.id, found.id),
    db.select({ balance: wallet.balance }).from(wallet).where(eq(wallet.userId, user.id)).limit(1),
  ]);

  return c.json({ owned, price: found.price, walletBalance: w?.balance ?? 0 });
});

// Pay online: the price comes from the DB, the client only names the course
protectedApi.post("/courses/:slug/checkout", async (c) => {
  const user = c.get("user");
  const found = await findPublishedCourse(c.req.param("slug"));
  if (!found) return c.json({ error: "course_not_found" }, 404);
  if (found.price <= 0) return c.json({ error: "course_is_free" }, 400);
  if (await hasCourseAccess(user.id, found.id)) return c.json({ error: "already_owned" }, 409);

  const r = await startGatewayPayment({
    user,
    amount: found.price,
    description: `خرید دوره ${found.title}`,
    courseId: found.id,
  });
  if (!r.ok) {
    return c.json(
      { error: r.status === 429 ? "too_many_pending_payments" : "gateway_unavailable" },
      r.status,
    );
  }
  return c.json({ redirectUrl: r.redirectUrl });
});

// Pay from the wallet (also used to enroll in free courses)
protectedApi.post("/courses/:slug/purchase", async (c) => {
  const user = c.get("user");
  const slug = c.req.param("slug");

  try {
    const alreadyOwned = await db.transaction(async (tx) => {
      // Serializes this user's money operations
      await lockWallet(tx, user.id);

      const [found] = await tx
        .select()
        .from(course)
        .where(and(eq(course.slug, slug), eq(course.isPublished, true)))
        .limit(1);
      if (!found) throw new CourseNotFoundError();

      const [owned] = await tx
        .select({ id: enrollment.id })
        .from(enrollment)
        .where(and(eq(enrollment.userId, user.id), eq(enrollment.courseId, found.id)))
        .limit(1);
      if (owned) return true; // a retry after success is harmless: nothing is charged twice

      const [created] = await tx
        .insert(enrollment)
        .values({ userId: user.id, courseId: found.id, pricePaid: found.price })
        .returning({ id: enrollment.id });

      // Throws InsufficientBalanceError -> the enrollment insert rolls back too
      if (found.price > 0) {
        await debitWallet(tx, {
          userId: user.id,
          amount: found.price,
          enrollmentId: created.id,
          description: `خرید دوره ${found.title}`,
        });
      }
      return false;
    });

    return c.json({ owned: true, alreadyOwned });
  } catch (err) {
    if (err instanceof CourseNotFoundError) return c.json({ error: "course_not_found" }, 404);
    if (err instanceof InsufficientBalanceError) return c.json({ error: "insufficient_balance" }, 402);
    throw err;
  }
});