import { define } from '../define';

const marketAxes = [
  {
    id: 'forex',
    tag: 'Axis 1',
    name: 'Forex',
    groups: 'Majors, minors and metals, including gold and silver.',
    instruments: 'XAUUSD · EURUSD',
  },
  {
    id: 'crypto',
    tag: 'Axis 2',
    name: 'Crypto',
    groups: 'USDT perpetual futures, including newly listed coins.',
    instruments: 'BTCUSDT · ETHUSDT',
  },
  {
    id: 'synthetics',
    tag: 'Axis 3',
    name: 'Synthetics',
    groups: 'Volatility 10 to 100, Boom and Crash, Step, Jump and Range Break.',
    instruments: 'VOL 75 · BOOM 1000',
  },
];

export const getMarketAxes = define.function({
  async get() {
    return marketAxes;
  },
});
