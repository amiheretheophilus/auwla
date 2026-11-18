export const markets = {
  forex: {
    label: 'Forex',
    symbols: ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'USDCAD', 'NZDUSD', 'EURGBP', 'EURJPY', 'GBPJPY', 'XAUUSD', 'XAGUSD'],
  },
  crypto: {
    label: 'Crypto',
    symbols: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT', 'DOGEUSDT'],
  },
  synthetics: {
    label: 'Synthetics',
    symbols: [
      'VOL 10', 'VOL 25', 'VOL 50', 'VOL 75', 'VOL 100',
      'VOL 10 (1s)', 'VOL 25 (1s)', 'VOL 50 (1s)', 'VOL 75 (1s)', 'VOL 100 (1s)',
      'BOOM 300', 'BOOM 500', 'BOOM 1000', 'CRASH 300', 'CRASH 500', 'CRASH 1000',
      'STEP', 'JUMP 10', 'JUMP 25', 'JUMP 50', 'JUMP 75', 'JUMP 100',
      'RANGE BREAK 100', 'RANGE BREAK 200',
    ],
  },
} as const;

export type Axis = keyof typeof markets;
export const axes: Axis[] = ['forex', 'crypto', 'synthetics'];

export const emptyFields = {
  axis: 'forex',
  symbol: '',
  direction: '',
  entryType: '',
  entry: '',
  stop: '',
  risk: '',
  note: '',
  targets: [''],
};

export type SignalFields = typeof emptyFields;

export function isAxis(value: string): value is Axis {
  return Object.hasOwn(markets, value);
}
