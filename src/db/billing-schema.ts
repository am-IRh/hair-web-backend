import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const ts = (name: string) => timestamp(name, { withTimezone: true });

// Financial records use "restrict": deleting a user must never silently delete money history.
const userRef = () =>
  text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "restrict" });

export const paymentStatus = pgEnum("payment_status", ["pending", "paid", "failed"]);
export const walletTxType = pgEnum("wallet_tx_type", ["topup", "purchase", "refund", "adjustment"]);

export const wallet = pgTable(
  "wallet",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "restrict" }),
    balance: integer("balance").notNull().default(0),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [check("wallet_balance_non_negative", sql`${t.balance} >= 0`)]
);

export const plan = pgTable(
  "plan",
  {
    id: id(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    description: text("description"),
    durationDays: integer("duration_days").notNull(),
    price: integer("price").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    check("plan_price_non_negative", sql`${t.price} >= 0`),
    check("plan_duration_positive", sql`${t.durationDays} > 0`),
  ]
);

export const subscription = pgTable(
  "subscription",
  {
    id: id(),
    userId: userRef(),
    planId: text("plan_id")
      .notNull()
      .references(() => plan.id, { onDelete: "restrict" }),
    startsAt: ts("starts_at").notNull(),
    endsAt: ts("ends_at").notNull(),
    pricePaid: integer("price_paid").notNull(),
    // Client-generated key: the same purchase request can never be applied twice
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("subscription_user_idem_unique").on(t.userId, t.idempotencyKey),
    index("subscription_user_ends_idx").on(t.userId, t.endsAt),
  ]
);

export const course = pgTable(
  "course",
  {
    id: id(),
    // Latin URL segment (/courses/<slug>). Must be stable: it is used in public links
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    summary: text("summary").notNull().default(""), // short text for cards and meta description
    description: text("description").notNull().default(""), // paragraphs separated by a blank line
    instructor: text("instructor").notNull().default(""),
    coverImage: text("cover_image"),
    isFeatured: boolean("is_featured").notNull().default(false),
    price: integer("price").notNull(), // Toman, 0 = free
    isPublished: boolean("is_published").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    check("course_price_non_negative", sql`${t.price} >= 0`),
    check("course_slug_format", sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
  ],
);

export const payment = pgTable(
  "payment",
  {
    id: id(),
    userId: userRef(),
    amount: integer("amount").notNull(),
    status: paymentStatus("status").notNull().default("pending"),
    gateway: text("gateway").notNull(),
    authority: text("authority").unique(), // gateway reference, set after start()
    refId: text("ref_id"),
    cardPan: text("card_pan"),
    createdAt: createdAt(),
    paidAt: ts("paid_at"),
    courseId: text("course_id").references(() => course.id, { onDelete: "restrict" }),
  },
  (t) => [
    check("payment_amount_positive", sql`${t.amount} > 0`),
    index("payment_user_created_idx").on(t.userId, t.createdAt),
  ]
);

export const enrollment = pgTable(
  "enrollment",
  {
    id: id(),
    userId: userRef(),
    courseId: text("course_id").notNull().references(() => course.id, { onDelete: "restrict" }),
    pricePaid: integer("price_paid").notNull(),
    paymentId: text("payment_id").references(() => payment.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
  },
  (t) => [
    // A user can own a course only once: the database itself blocks double purchases
    uniqueIndex("enrollment_user_course_unique").on(t.userId, t.courseId),
    index("enrollment_user_created_idx").on(t.userId, t.createdAt),
  ],
);

// Append-only ledger. amount is signed: + credit, - debit.
export const walletTransaction = pgTable(
  "wallet_transaction",
  {
    id: id(),
    userId: userRef(),
    type: walletTxType("type").notNull(),
    amount: integer("amount").notNull(),
    balanceAfter: integer("balance_after").notNull(),
    paymentId: text("payment_id").references(() => payment.id, { onDelete: "restrict" }),
    subscriptionId: text("subscription_id").references(() => subscription.id, { onDelete: "restrict" }),
    enrollmentId: text("enrollment_id").references(() => enrollment.id, { onDelete: "restrict" }),
    description: text("description").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    // DB-level guard: one payment can be credited to a wallet at most once
    uniqueIndex("wallet_tx_payment_unique").on(t.paymentId),
    index("wallet_tx_user_created_idx").on(t.userId, t.createdAt),
    check("wallet_tx_amount_nonzero", sql`${t.amount} <> 0`),
  ]
);
