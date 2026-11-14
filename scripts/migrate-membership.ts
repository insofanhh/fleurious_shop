import "dotenv/config";
import { db } from "../src/lib/db";
import { atomic } from "../src/lib/transaction";
import {
  seedMembershipCatalog,
  migrateLegacyMember,
  recordMembershipSpend,
} from "../src/lib/membership";
async function main() {
  const pending = await db.user.count({ where: { membershipMigrated: false } });
  const legacy = await db.user.count({
    where: {
      membershipMigrated: false,
      memberSince: { not: null },
      tier: { not: "Member" },
    },
  });
  console.log(
    JSON.stringify({
      pendingUsers: pending,
      historicRanksToPreserve: legacy,
      dryRun: process.argv.includes("--dry-run"),
    }),
  );
  if (process.argv.includes("--dry-run")) return;
  await seedMembershipCatalog();
  let migrated = 0;
  for (;;) {
    const users = await db.user.findMany({
      where: { membershipMigrated: false },
      select: { id: true },
      take: 100,
    });
    if (!users.length) break;
    for (const user of users) {
      await atomic((tx) => migrateLegacyMember(tx, user.id));
      const orders = await db.order.findMany({
        where: {
          userId: user.id,
          status: "COMPLETED",
          fulfillment: "DELIVERED",
          paymentStatus: "PAID",
        },
        select: { id: true },
      });
      for (const order of orders)
        await atomic((tx) => recordMembershipSpend(tx, order.id));
      migrated++;
    }
  }
  console.log(
    JSON.stringify({
      migratedUsers: migrated,
      tiers: await db.membershipTier.count(),
    }),
  );
}
main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "Migration failed");
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
