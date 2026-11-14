import { Prisma } from "@prisma/client";
import { db } from "./db";
export type Tx = Prisma.TransactionClient;
export async function atomic<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      // Decisions are serialized by explicit row locks. Fresh reads after a lock wait
      // must see the preceding commit rather than an older MySQL repeatable-read snapshot.
      return await db.$transaction(fn, {
        timeout: 20000,
        maxWait: 15000,
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      });
    } catch (error) {
      if (
        attempt < 3 &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ["P2034", "P2002"].includes(error.code)
      )
        continue;
      throw error;
    }
  }
}
