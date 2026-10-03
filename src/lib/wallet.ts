import { and, eq, gte, sql } from "drizzle-orm";
import type { Tx } from "../db/index.js";
import { wallet, walletTransaction } from "../db/schema.js";

export class InsufficientBalanceError extends Error {
  constructor() {
    super("Insufficient wallet balance");
  }
}

function assertPositiveInt(amount: number) {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error(`Invalid amount: ${amount}`);
  }
}

// Creates the wallet row if missing and locks it until the transaction ends.
// All money operations of one user are serialized through this lock.
export async function lockWallet(tx: Tx, userId: string) {
  await tx.insert(wallet).values({ userId }).onConflictDoNothing();
  await tx
    .select({ userId: wallet.userId })
    .from(wallet)
    .where(eq(wallet.userId, userId))
    .for("update");
}

export async function creditWallet(
  tx: Tx,
  args: { userId: string; amount: number; paymentId: string; description: string },
) {
  assertPositiveInt(args.amount);
  await lockWallet(tx, args.userId);

  const [row] = await tx
    .update(wallet)
    .set({ balance: sql`${wallet.balance} + ${args.amount}`, updatedAt: new Date() })
    .where(eq(wallet.userId, args.userId))
    .returning({ balance: wallet.balance });

  await tx.insert(walletTransaction).values({
    userId: args.userId,
    type: "topup",
    amount: args.amount,
    balanceAfter: row.balance,
    paymentId: args.paymentId,
    description: args.description,
  });
}

export async function debitWallet(
  tx: Tx,
  args: {
    userId: string;
    amount: number;
    description: string;
    subscriptionId?: string;
    enrollmentId?: string;
  },
) {
  assertPositiveInt(args.amount);

  // Atomic check-and-subtract: no read-modify-write in application code
  const [row] = await tx
    .update(wallet)
    .set({ balance: sql`${wallet.balance} - ${args.amount}`, updatedAt: new Date() })
    .where(and(eq(wallet.userId, args.userId), gte(wallet.balance, args.amount)))
    .returning({ balance: wallet.balance });

  if (!row) throw new InsufficientBalanceError();

  await tx.insert(walletTransaction).values({
    userId: args.userId,
    type: "purchase",
    amount: -args.amount,
    balanceAfter: row.balance,
    subscriptionId: args.subscriptionId,
    enrollmentId: args.enrollmentId,
    description: args.description,
  });
}