import type { HrVacationBalance } from '../../types/hr-workforce';

function normalized(value?: string | null): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase();
}

export function isVacationBalance(balance: HrVacationBalance): boolean {
  const code = normalized(balance.leaveType?.code);
  const name = normalized(balance.leaveType?.name);
  const period = normalized(balance.periodLabel);
  return code.includes('vac') || name.includes('vacaci') || period.includes('vacaci');
}

export function selectVacationBalance(
  balances?: HrVacationBalance[] | null
): HrVacationBalance | null {
  return balances?.find(isVacationBalance) ?? null;
}
