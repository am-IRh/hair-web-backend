import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { course, enrollment } from "../db/schema";

export async function findPublishedCourse(slug: string) {
  const [row] = await db
    .select()
    .from(course)
    .where(and(eq(course.slug, slug), eq(course.isPublished, true)))
    .limit(1);
  return row ?? null;
}

// The ONE place that decides "can this user access this course?".
// When subscriptions start unlocking courses, extend it here (e.g. `|| hasActiveSubscription(...)`).
export async function hasCourseAccess(userId: string, courseId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: enrollment.id })
    .from(enrollment)
    .where(and(eq(enrollment.userId, userId), eq(enrollment.courseId, courseId)))
    .limit(1);
  return !!row;
}