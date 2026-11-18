import { isAxis, markets, type Axis, type SignalFields } from '../desk/draft/model/signal-fields';

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
