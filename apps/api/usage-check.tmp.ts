import { prisma } from './src/database/prisma';
async function main() {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const rows = await prisma.aiUsage.groupBy({ by: ['organizationId', 'operation'], where: { createdAt: { gte: start } }, _count: { _all: true } });
  console.log(JSON.stringify(rows.map((r) => ({ org: r.organizationId?.slice(0, 8), op: r.operation, n: r._count._all }))));
  await prisma.$disconnect();
}
void main();
