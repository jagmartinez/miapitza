import { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const companyId = Number(argValue('--company-id'));
  const actorUserId = Number(argValue('--actor-user-id'));
  const apply = process.argv.includes('--apply');
  const confirmCompany = argValue('--confirm-company') ?? process.env.CONFIRM_CHANNEL_COMPANY;
  if (!Number.isInteger(companyId) || companyId <= 0) throw new Error('--company-id must be a positive integer');

  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true, name: true } });
  if (!company) throw new Error('Company not found');
  const channel = await prisma.salesChannelConfig.findUnique({
    where: { companyId_channel: { companyId, channel: 'PEDIDOSYA' } },
    select: { id: true, active: true },
  });
  const activeConfigs = await prisma.pedidosYaConfig.count({ where: { companyId, active: true } });
  const plan = { companyId, channelId: channel?.id ?? null, channelActive: channel?.active ?? false, activeConfigs };
  if (!apply) {
    console.log(JSON.stringify({ applied: false, plan }));
    if (channel?.active && activeConfigs === 0) process.exitCode = 1;
    return;
  }

  if (process.env.ALLOW_CHANNEL_REMEDIATION !== '1') throw new Error('ALLOW_CHANNEL_REMEDIATION=1 is required');
  if (confirmCompany !== company.name) throw new Error('Exact company confirmation is required');
  if (!Number.isInteger(actorUserId) || actorUserId <= 0) throw new Error('--actor-user-id must be a positive integer');
  const actor = await prisma.user.findFirst({
    where: { id: actorUserId, companyId, status: 'ACTIVE', role: { name: { in: ['ADMIN', 'SUPERADMIN'] } } },
    select: { id: true },
  });
  if (!actor) throw new Error('Active same-company ADMIN/SUPERADMIN actor is required');
  if (!channel) throw new Error('PEDIDOSYA SalesChannelConfig not found');

  const changed = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM SalesChannelConfig WHERE id = ${channel.id} FOR UPDATE`;
    const configsUnderLock = await tx.pedidosYaConfig.count({ where: { companyId, active: true } });
    if (configsUnderLock > 0) throw new Error('Active PedidosYa configuration appeared; refusing to disable automatically');
    const update = await tx.salesChannelConfig.updateMany({
      where: { id: channel.id, companyId, channel: 'PEDIDOSYA', active: true },
      data: { active: false },
    });
    if (update.count > 0) {
      await tx.auditLog.create({
        data: {
          companyId,
          entityType: 'SalesChannelConfig',
          entityId: channel.id,
          action: 'DISABLE_UNCONFIGURED_CHANNEL',
          userId: actor.id,
          details: { channel: 'PEDIDOSYA', reason: 'No active PedidosYaConfig at production gate' },
        },
      });
    }
    return update.count;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  console.log(JSON.stringify({ applied: true, disabled: changed, plan }));
}

main()
  .catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
