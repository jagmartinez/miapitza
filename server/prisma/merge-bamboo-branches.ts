/**
 * Fusiona la sucursal duplicada BAMBOO (mesas) en SUC1 (usuarios/datos).
 * Uso: npx tsx prisma/merge-bamboo-branches.ts [--dry-run]
 */

import prisma from '../src/utils/prisma';

const COMPANY_ID = 1;
const SOURCE_CODE = 'BAMBOO';
const TARGET_CODE = 'SUC1';
const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const source = await prisma.branch.findFirst({
    where: { companyId: COMPANY_ID, code: SOURCE_CODE },
  });
  const target = await prisma.branch.findFirst({
    where: { companyId: COMPANY_ID, code: TARGET_CODE },
  });

  if (!source || !target) {
    throw new Error(`Sucursales no encontradas: source=${SOURCE_CODE} target=${TARGET_CODE}`);
  }
  if (source.id === target.id) {
    console.log('No hay duplicado: misma sucursal.');
    return;
  }

  const [sourceUsers, targetUsers, sourceTables, targetTables] = await Promise.all([
    prisma.user.count({ where: { branchId: source.id } }),
    prisma.user.count({ where: { branchId: target.id } }),
    prisma.table.count({ where: { branchId: source.id } }),
    prisma.table.count({ where: { branchId: target.id } }),
  ]);

  console.log(`Fusionar: ${source.name} (${source.code}, id=${source.id}) → ${target.name} (${target.code}, id=${target.id})`);
  console.log(`  Usuarios: ${sourceUsers} → target tiene ${targetUsers}`);
  console.log(`  Mesas: ${sourceTables} → target tiene ${targetTables}`);

  if (DRY_RUN) {
    console.log('\n(dry-run: no se aplicaron cambios)');
    return;
  }

  await prisma.$transaction(async (tx) => {
    // MenuItemBranchPrice: evitar @@unique(menuItemId, branchId)
    const sourcePrices = await tx.menuItemBranchPrice.findMany({ where: { branchId: source.id } });
    for (const row of sourcePrices) {
      const clash = await tx.menuItemBranchPrice.findUnique({
        where: { menuItemId_branchId: { menuItemId: row.menuItemId, branchId: target.id } },
      });
      if (clash) {
        await tx.menuItemBranchPrice.delete({ where: { id: row.id } });
      } else {
        await tx.menuItemBranchPrice.update({
          where: { id: row.id },
          data: { branchId: target.id },
        });
      }
    }

    // Table: evitar @@unique(branchId, number)
    const targetTableCount = await tx.table.count({ where: { branchId: target.id } });
    if (targetTableCount === 0) {
      await tx.table.updateMany({
        where: { branchId: source.id },
        data: { branchId: target.id },
      });
    } else {
      const sourceTablesRows = await tx.table.findMany({ where: { branchId: source.id } });
      for (const table of sourceTablesRows) {
        const clash = await tx.table.findFirst({
          where: { branchId: target.id, number: table.number },
        });
        if (clash) {
          const maxNum = await tx.table.aggregate({
            where: { branchId: target.id },
            _max: { number: true },
          });
          const newNumber = (maxNum._max.number ?? 0) + 1;
          await tx.table.update({
            where: { id: table.id },
            data: { branchId: target.id, number: newNumber },
          });
        } else {
          await tx.table.update({
            where: { id: table.id },
            data: { branchId: target.id },
          });
        }
      }
    }

    // Warehouse: @@unique(companyId, branchId, name)
    const sourceWarehouses = await tx.warehouse.findMany({ where: { branchId: source.id } });
    for (const wh of sourceWarehouses) {
      const clash = await tx.warehouse.findFirst({
        where: { companyId: COMPANY_ID, branchId: target.id, name: wh.name },
      });
      if (clash) {
        const stocks = await tx.stock.findMany({ where: { warehouseId: wh.id } });
        for (const s of stocks) {
          const existing = await tx.stock.findUnique({
            where: { warehouseId_productId: { warehouseId: clash.id, productId: s.productId } },
          });
          if (existing) {
            await tx.stock.update({
              where: { id: existing.id },
              data: { quantity: Number(existing.quantity) + Number(s.quantity) },
            });
            await tx.stock.delete({ where: { id: s.id } });
          } else {
            await tx.stock.update({
              where: { id: s.id },
              data: { warehouseId: clash.id },
            });
          }
        }
        await tx.warehouse.delete({ where: { id: wh.id } });
      } else {
        await tx.warehouse.update({
          where: { id: wh.id },
          data: { branchId: target.id },
        });
      }
    }

    // UserBranch
    const sourceUserBranches = await tx.userBranch.findMany({ where: { branchId: source.id } });
    for (const ub of sourceUserBranches) {
      const clash = await tx.userBranch.findUnique({
        where: { userId_branchId: { userId: ub.userId, branchId: target.id } },
      });
      if (clash) {
        await tx.userBranch.delete({ where: { id: ub.id } });
      } else {
        await tx.userBranch.update({
          where: { id: ub.id },
          data: { branchId: target.id },
        });
      }
    }

    // Usuarios activos en sucursal origen → destino
    await tx.user.updateMany({
      where: { branchId: source.id },
      data: { branchId: target.id },
    });

    await tx.menuItem.updateMany({
      where: { branchId: source.id },
      data: { branchId: target.id },
    });
    await tx.reservation.updateMany({
      where: { branchId: source.id },
      data: { branchId: target.id },
    });
    await tx.purchaseOrder.updateMany({
      where: { branchId: source.id },
      data: { branchId: target.id },
    });
    await tx.order.updateMany({
      where: { branchId: source.id },
      data: { branchId: target.id },
    });
    await tx.cashRegister.updateMany({
      where: { branchId: source.id },
      data: { branchId: target.id },
    });
    await tx.cateringEvent.updateMany({
      where: { branchId: source.id },
      data: { branchId: target.id },
    });

    const sourceInvoice = await tx.invoiceSequence.findFirst({
      where: { companyId: COMPANY_ID, branchId: source.id },
    });
    const targetInvoice = await tx.invoiceSequence.findFirst({
      where: { companyId: COMPANY_ID, branchId: target.id },
    });
    if (sourceInvoice) {
      if (targetInvoice) {
        await tx.invoiceSequence.delete({ where: { id: sourceInvoice.id } });
      } else {
        await tx.invoiceSequence.update({
          where: { id: sourceInvoice.id },
          data: { branchId: target.id },
        });
      }
    }

    const sourcePy = await tx.pedidosYaConfig.findFirst({
      where: { companyId: COMPANY_ID, branchId: source.id },
    });
    const targetPy = await tx.pedidosYaConfig.findFirst({
      where: { companyId: COMPANY_ID, branchId: target.id },
    });
    if (sourcePy) {
      if (targetPy) {
        await tx.pedidosYaConfig.delete({ where: { id: sourcePy.id } });
      } else {
        await tx.pedidosYaConfig.update({
          where: { id: sourcePy.id },
          data: { branchId: target.id },
        });
      }
    }

    await tx.branch.delete({ where: { id: source.id } });
  }, { maxWait: 60_000, timeout: 300_000 });

  const finalTables = await prisma.table.count({ where: { branchId: target.id } });
  const finalUsers = await prisma.user.count({ where: { branchId: target.id } });
  const remaining = await prisma.branch.count({
    where: { companyId: COMPANY_ID, code: SOURCE_CODE },
  });

  console.log('\n✓ Fusión completada');
  console.log(`  Sucursal destino: ${target.code} — ${finalUsers} usuarios, ${finalTables} mesas`);
  console.log(`  Sucursales ${SOURCE_CODE} restantes: ${remaining}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
