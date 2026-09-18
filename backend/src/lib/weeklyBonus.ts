import { prisma } from "./prisma";
import { getPlatformConfig } from "./platformConfig";

// Monday 00:00:00 local time of the week containing `d` — used as the
// dedup key for DriverWeeklyBonus (@@unique([driverId, weekStart])) so a
// driver can only be granted the goal bonus once per rolling week.
export function startOfWeek(d: Date): Date {
  const date = new Date(d);
  const day = date.getDay(); // 0 = Sunday
  const diffToMonday = day === 0 ? -6 : 1 - day;
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + diffToMonday);
  return date;
}

// Called after a trip completes: if the driver has now completed
// PlatformConfig.weeklyBonusTripThreshold trips within the current week and
// hasn't already been paid the bonus for this week, grant it and credit the
// wallet. Returns the bonus amount granted, or 0 if none was granted.
export async function checkAndGrantWeeklyBonus(driverId: string): Promise<number> {
  const config = await getPlatformConfig();
  const weekStart = startOfWeek(new Date());

  const existing = await prisma.driverWeeklyBonus.findUnique({
    where: { driverId_weekStart: { driverId, weekStart } },
  });
  if (existing) return 0;

  const tripsThisWeek = await prisma.trip.count({
    where: { driverId, status: "COMPLETED", completedAt: { gte: weekStart } },
  });

  if (tripsThisWeek < config.weeklyBonusTripThreshold) return 0;

  await prisma.$transaction([
    prisma.driverWeeklyBonus.create({
      data: {
        driverId,
        weekStart,
        tripsCompleted: tripsThisWeek,
        bonusClp: config.weeklyBonusAmountClp,
      },
    }),
    prisma.driver.update({
      where: { id: driverId },
      data: { walletBalanceClp: { increment: config.weeklyBonusAmountClp } },
    }),
  ]);

  return config.weeklyBonusAmountClp;
}
