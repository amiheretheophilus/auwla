import { define } from '../define';

const marketAxes = [
  { id: 'forex', name: 'Forex', instruments: 'XAUUSD · EURUSD' },
  { id: 'crypto', name: 'Crypto', instruments: 'BTCUSDT · ETHUSDT' },
  { id: 'synthetics', name: 'Synthetics', instruments: 'VOL 75 · BOOM 1000' },
];

export const getMarketAxes = define.function({
  async get() {
    return marketAxes;
  },
});
