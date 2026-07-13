import prisma from '../src/utils/prisma';

async function main() {
  const channels = await prisma.salesChannelConfig.findMany({
    select: { companyId: true, channel: true, active: true },
    orderBy: [{ companyId: 'asc' }, { channel: 'asc' }],
  });
  const pedidosYa = await prisma.pedidosYaConfig.findMany({
    select: { companyId: true, branchId: true, active: true, defaultWarehouseId: true },
    orderBy: [{ companyId: 'asc' }, { branchId: 'asc' }],
  });

  const blockers: string[] = [];
  for (const channel of channels) {
    if (!channel.active || channel.channel !== 'PEDIDOSYA') continue;
    const activeConfigs = pedidosYa.filter(config => config.companyId === channel.companyId && config.active);
    if (activeConfigs.length === 0) {
      blockers.push(`Company ${channel.companyId}: PEDIDOSYA channel is active without an active PedidosYaConfig`);
    }
    const globalConfigs = activeConfigs.filter(config => config.branchId === null);
    if (globalConfigs.length > 1) {
      blockers.push(`Company ${channel.companyId}: multiple active global PedidosYa configs`);
    }
    const branchIds = activeConfigs.map(config => config.branchId).filter((id): id is number => id !== null);
    if (new Set(branchIds).size !== branchIds.length) {
      blockers.push(`Company ${channel.companyId}: multiple active PedidosYa configs for one branch`);
    }
    if (activeConfigs.some(config => config.defaultWarehouseId === null)) {
      blockers.push(`Company ${channel.companyId}: active PedidosYa config without a default warehouse`);
    }
  }

  console.log(JSON.stringify({ channels, pedidosYaConfigs: pedidosYa, blockers }));
  if (blockers.length > 0) process.exitCode = 1;
}

main()
  .catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
