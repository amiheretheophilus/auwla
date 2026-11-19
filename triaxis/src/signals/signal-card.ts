import { isAxis, markets, type Axis, type SignalFields } from '../desk/draft/model/signal-fields';
import type { SignalReview } from '../desk/draft/model/signal-review';

/**
 * The checks every posted card passed. Posting is refused unless both price checks pass
 * (`server/desk/analyses.ts`), so a posted card can show them as passed.
 */
export const postedReview: SignalReview = {
  checks: [
    { label: 'Level order', status: 'pass', detail: 'The stop and targets match the direction.' },
    { label: 'Target vs. stop distance', status: 'pass', detail: 'The target is at least 1.5 times as far from entry as the stop.' },
  ],
  missing: [],
  verdict: 'Price checks complete',
};

/** The levels as plain text a member can paste into a trading app. */
export function levelsText(card: SignalCardData): string {
  const lines = [
    `${card.symbol} ${card.direction.toUpperCase()} (${card.entryType} entry)`,
    `Entry ${card.entry}`,
    `Stop loss ${card.stop}`,
    ...card.targets.map((target, index) => `TP${index + 1} ${target}`),
  ];
  return lines.join('\n');
}

export interface SignalCardData {
  axis: Axis;
  market: string;
  symbol: string;
  direction: string;
  entryType: string;
  entry: string;
  stop: string;
  targets: string[];
}

export interface PublishedSignal {
  id: string;
  card: SignalCardData;
  publishedAt: string;
}

export function signalCardFromDraft(fields: SignalFields): SignalCardData {
  const axis = isAxis(fields.axis) ? fields.axis : 'forex';
  const directionLabels = axis === 'crypto'
    ? { buy: 'Long', sell: 'Short' }
    : { buy: 'Buy', sell: 'Sell' };

  return {
    axis,
    market: markets[axis].label,
    symbol: fields.symbol,
    direction: fields.direction === 'buy' || fields.direction === 'sell' ? directionLabels[fields.direction] : '',
    entryType: fields.entryType,
    entry: fields.entry,
    stop: fields.stop,
    targets: [...fields.targets],
  };
}

export function formatSignalTime(value: string) {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(value)) + ' UTC';
}
