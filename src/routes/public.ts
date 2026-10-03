import { Hono } from "hono";
import { db } from "../db/index.js";
import { course, plan } from "../db/schema.js";
import { env } from "../env.js";
import { settlePayment } from "../lib/payments/settle.js";
import { findPublishedCourse } from "../lib/courses.js";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { asc, desc, eq, sql } from "drizzle-orm";

export const publicApi = new Hono();

publicApi.get("/plans", async (c) => {
  const plans = await db
    .select({
      id: plan.id,
      slug: plan.slug,
      name: plan.name,
      description: plan.description,
      durationDays: plan.durationDays,
      price: plan.price,
    })
    .from(plan)
    .where(eq(plan.isActive, true))
    .orderBy(asc(plan.sortOrder));

  return c.json({ plans });
});

// The gateway redirects the user's browser here with GET, and it changes state.
// That is why settlePayment is idempotent and never trusts the query string.
publicApi.get("/payments/callback", async (c) => {
  const paymentResult = await settlePayment({
    authority: c.req.query("Authority"),
    callbackStatus: c.req.query("Status"),
  });
  const {result, courseSlug} = paymentResult
   let path: string;
  if (courseSlug) {
    // paid (or still being verified): show it in the panel; failed/cancelled: back to the course to retry
    path =
      result === "success" || result === "pending"
        ? `/dashboard/courses?payment=${result}`
        : `/courses/${encodeURIComponent(courseSlug)}?payment=${result}`;
  } else {
    path = `/dashboard/wallet?payment=${result}`;
  }
  return c.redirect(`${env.WEB_ORIGIN}${path}`);
});

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(48).default(6),
});

publicApi.get("/courses", zValidator("query", listQuery), async (c) => {
  const { page, pageSize } = c.req.valid("query");

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(course)
    .where(eq(course.isPublished, true));

  const courses = await db
    .select({
      id: course.id,
      slug: course.slug,
      title: course.title,
      summary: course.summary,
      instructor: course.instructor,
      coverImage: course.coverImage,
      isFeatured: course.isFeatured,
      price: course.price,
    })
    .from(course)
    .where(eq(course.isPublished, true))
    // id as a tie-breaker: without a total order, rows can jump between pages
    .orderBy(desc(course.createdAt), asc(course.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return c.json({ courses, page, pageSize, total, totalPages: Math.ceil(total / pageSize) });
});

publicApi.get("/courses/:slug", async (c) => {
  const found = await findPublishedCourse(c.req.param("slug"));
  if (!found) return c.json({ error: "course_not_found" }, 404);

  return c.json({
    id: found.id,
    slug: found.slug,
    title: found.title,
    summary: found.summary,
    description: found.description,
    instructor: found.instructor,
    coverImage: found.coverImage,
    isFeatured: found.isFeatured,
    price: found.price,
    createdAt: found.createdAt,
  });
});

// The gateway redirects the user's browser here with GET, and it changes state.
// That is why settlePayment is idempotent and never trusts the query string.
publicApi.get("/payments/callback", async (c) => {
  const { result, courseSlug } = await settlePayment({
    authority: c.req.query("Authority"),
    callbackStatus: c.req.query("Status"),
  });

  let path: string;
  if (courseSlug) {
    // paid (or still being verified): show it in the panel; failed/cancelled: back to the course to retry
    path =
      result === "success" || result === "pending"
        ? `/dashboard/courses?payment=${result}`
        : `/courses/${encodeURIComponent(courseSlug)}?payment=${result}`;
  } else {
    path = `/dashboard/wallet?payment=${result}`;
  }

  return c.redirect(`${env.WEB_ORIGIN}${path}`);
});