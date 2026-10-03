import { sql } from "drizzle-orm";
import { db } from "./index.js";
import { course, plan } from "./schema.js";

// These are DEV placeholders and they are published. Never run this against production.
if (process.env.NODE_ENV === "production") {
  throw new Error("Refusing to seed placeholder data in production");
}

await db
  .insert(plan)
  .values([
    { slug: "monthly", name: "اشتراک یک‌ماهه", durationDays: 30, price: 150_000, sortOrder: 1 },
    { slug: "quarterly", name: "اشتراک سه‌ماهه", durationDays: 90, price: 400_000, sortOrder: 2 },
    { slug: "yearly", name: "اشتراک یک‌ساله", durationDays: 365, price: 1_400_000, sortOrder: 3 },
  ])
  .onConflictDoNothing({ target: plan.slug });

const sampleText =
  "این یک متن نمونه برای توضیحات دوره است.\n\nپاراگراف دوم توضیحات دوره. متن واقعی را جایگزین کنید.";

await db
  .insert(course)
  .values(
    Array.from({ length: 14 }, (_, i) => ({
      slug: `sample-course-${i + 1}`,
      title: `دوره نمونه ${i + 1}`,
      summary: "خلاصه کوتاه دوره برای نمایش روی کارت و توضیح متای صفحه.",
      description: sampleText,
      instructor: "آقای عسگری",
      coverImage: "/ascaryfile/images/photo1.webp",
      isFeatured: i % 5 === 0,
      price: (i + 1) * 100_000,
      isPublished: true,
    })),
  )
  .onConflictDoUpdate({
    target: course.slug,
    // Only content is refreshed on re-seed. Price and publish state are never overwritten.
    set: {
      title: sql`excluded.title`,
      summary: sql`excluded.summary`,
      description: sql`excluded.description`,
      instructor: sql`excluded.instructor`,
      coverImage: sql`excluded.cover_image`,
      isFeatured: sql`excluded.is_featured`,
    },
  });

console.log("Seeded");
process.exit(0);