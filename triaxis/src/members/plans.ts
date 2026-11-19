// Plans members can buy (brief, section 5). Only the two prices the owner has given are on sale;
// the others stay listed here, without a price, until the owner sets them.
import { axes, markets, type Axis } from '../desk/draft/model/signal-fields';

export interface Plan {
  id: string;
  /** 'single': the member chooses one axis. 'all': forex, crypto and synthetics. */
  scope: 'single' | 'all';
  months: number;
  /** In US dollars, or null while the owner has not set it. */
  price: number | null;
}

export const plans: Plan[] = [
  { id: 'single-1m', scope: 'single', months: 1, price: 35 },
  { id: 'single-3m', scope: 'single', months: 3, price: null },
  { id: 'single-6m', scope: 'single', months: 6, price: null },
  { id: 'all-1m', scope: 'all', months: 1, price: null },
  { id: 'all-3m', scope: 'all', months: 3, price: 100 },
  { id: 'all-6m', scope: 'all', months: 6, price: null },
];

/** The plans on sale: those with a price. */
export function plansOnSale(): Plan[] {
  return plans.filter(plan => plan.price !== null);
}

export function findPlan(id: string): Plan | null {
  return plans.find(plan => plan.id === id && plan.price !== null) ?? null;
}

export function planTitle(plan: Plan): string {
  if (plan.scope === 'all') {
    return 'All three axes';
  }
  return 'One axis';
}

/** "1 month", "3 months". */
export function monthsText(months: number): string {
  if (months === 1) {
    return '1 month';
  }
  return `${months} months`;
}

export function planLength(plan: Plan): string {
  return monthsText(plan.months);
}

/** The axes a plan covers, given the axis a member chose for a single-axis plan. */
export function planAxes(plan: Plan, chosen: string): Axis[] {
  if (plan.scope === 'all') {
    return [...axes];
  }
  return axes.filter(axis => axis === chosen);
}

export function axisLabel(axis: string): string {
  if (axis === 'forex' || axis === 'crypto' || axis === 'synthetics') {
    return markets[axis].label;
  }
  return axis;
}

/** How a member pays in version 1. An admin confirms each payment by hand. */
export const paymentMethods = [
  { id: 'bank', label: 'Bank transfer' },
  { id: 'mobile_money', label: 'Mobile money' },
  { id: 'usdt', label: 'USDT' },
] as const;

export type PaymentMethod = (typeof paymentMethods)[number]['id'];

export function isPaymentMethod(value: string): value is PaymentMethod {
  return paymentMethods.some(method => method.id === value);
}

export function paymentMethodLabel(value: string): string {
  return paymentMethods.find(method => method.id === value)?.label ?? value;
}
