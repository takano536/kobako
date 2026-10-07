import { isCalendarDate } from './validation.js';
import { isValidMonth, shiftMonth } from './month.js';

export type BillingDay = string;
export type BillingMonthOffset = 'same_month' | 'next_month' | 'two_months_later';

export interface BillingPeriodWindow {
  periodStart: string;
  periodEnd: string;
  dueOn: string;
}

function parseMonth(month: string): { year: number; month: number } {
  if (!isValidMonth(month)) {
    throw new Error('Billing month is outside the supported range');
  }
  return { year: Number(month.slice(0, 4)), month: Number(month.slice(5, 7)) };
}

function daysInMonth(month: string): number {
  const { year, month: monthNumber } = parseMonth(month);
  if (monthNumber === 2) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(monthNumber) ? 30 : 31;
}

function addOneDay(value: string): string {
  if (!isCalendarDate(value)) {
    throw new Error('Billing date is invalid');
  }
  const month = value.slice(0, 7);
  const day = Number(value.slice(8, 10));
  const lastDay = daysInMonth(month);
  if (day < lastDay) {
    return `${month}-${String(day + 1).padStart(2, '0')}`;
  }
  const nextMonth = shiftMonth(month, 1);
  return `${nextMonth}-01`;
}

export function resolveBillingDay(month: string, day: BillingDay): string {
  const lastDay = daysInMonth(month);
  const resolvedDay = day === 'last' ? lastDay : Number(day);
  if (!Number.isInteger(resolvedDay) || resolvedDay < 1 || resolvedDay > 31) {
    throw new Error('Billing day is invalid');
  }
  return `${month}-${String(Math.min(resolvedDay, lastDay)).padStart(2, '0')}`;
}

function monthOffset(offset: BillingMonthOffset): number {
  if (offset === 'same_month') return 0;
  if (offset === 'next_month') return 1;
  return 2;
}

export function derivePaymentDueOn(
  periodEnd: string,
  paymentDay: BillingDay,
  paymentMonthOffset: BillingMonthOffset,
): string {
  const month = shiftMonth(periodEnd.slice(0, 7), monthOffset(paymentMonthOffset));
  return resolveBillingDay(month, paymentDay);
}

export function deriveBillingPeriod(
  occurredOn: string,
  closingDay: BillingDay,
  paymentDay: BillingDay,
  paymentMonthOffset: BillingMonthOffset,
): BillingPeriodWindow {
  if (!isCalendarDate(occurredOn)) {
    throw new Error('Billing date is invalid');
  }
  const occurredMonth = occurredOn.slice(0, 7);
  const currentClose = resolveBillingDay(occurredMonth, closingDay);
  const periodEnd =
    occurredOn <= currentClose
      ? currentClose
      : resolveBillingDay(shiftMonth(occurredMonth, 1), closingDay);
  const previousClose = resolveBillingDay(shiftMonth(periodEnd.slice(0, 7), -1), closingDay);
  return {
    periodStart: addOneDay(previousClose),
    periodEnd,
    dueOn: derivePaymentDueOn(periodEnd, paymentDay, paymentMonthOffset),
  };
}
