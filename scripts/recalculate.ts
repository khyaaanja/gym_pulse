import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from '@/generated/prisma/client';
import { config } from "dotenv";

config();

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL })
});

// Recalculate script for GymPulse
// Recalculates financial data, membership stats, and analytics

async function recalculate() {
  console.log('GymPulse Recalculation Script');
  console.log('=============================\n');

  try {
    // Recalculate membership stats
    const totalMembers = await prisma.member.count({
      where: { status: 'ACTIVE' },
    });
    console.log(`Total active members: ${totalMembers}`);

    // Recalculate revenue
    const totalRevenue = await prisma.payment.aggregate({
      _sum: { amountPaisa: true },
      where: { status: 'SUCCEEDED' },
    });
    const revenueInNPR = (totalRevenue._sum.amountPaisa ?? 0) / 100;
    console.log(`Total revenue (₹): ${revenueInNPR}`);

    // Recalculate attendance
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todayAttendance = await prisma.attendance.count({
      where: {
        localDate: {
          gte: today,
          lt: tomorrow,
        },
      },
    });
    console.log(`Today's attendance: ${todayAttendance}`);

    // Recalculate risk scores
    const atRiskMembers = await prisma.member.count({
      where: { riskScore: { gte: 70 } },
    });
    console.log(`Members at risk: ${atRiskMembers}`);

    console.log('\nRecalculation complete.');
  } catch (error) {
    console.error('Error during recalculation:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

recalculate();