import { parseArgs } from 'node:util';

export function benchmarkOptions(args: string[]) {
  const { values } = parseArgs({ args, strict: true, allowPositionals: false, options: {
    smoke: { type: 'boolean' }, samples: { type: 'string' }, sizes: { type: 'string' },
    operations: { type: 'string' }, frames: { type: 'string' }, warmups: { type: 'string' },
    chrome: { type: 'string' }, output: { type: 'string' }, help: { type: 'boolean' },
  } });
  const integer = (name: string, value: string | undefined, fallback: number, min: number, max: number) => {
    const parsed = value === undefined ? fallback : Number(value);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max || value?.trim() === '') throw new Error(`${name} must be an integer in ${min}..${max}`);
    return parsed;
  };
  const sizes = (values.sizes ?? (values.smoke ? '1,8' : '1,32,128')).split(',')
    .map(value => integer('sizes', value, 1, 1, 4096));
  if (sizes.length > 12 || new Set(sizes).size !== sizes.length) throw new Error('sizes must contain 1..12 distinct values');
  return {
    smoke: values.smoke ?? false, help: values.help ?? false,
    samples: integer('samples', values.samples, values.smoke ? 3 : 7, 1, 51), sizes,
    operations: integer('operations', values.operations, values.smoke ? 20 : 100, 1, 1_000_000),
    frames: integer('frames', values.frames, values.smoke ? 20 : 120, 1, 1_000_000),
    warmups: integer('warmups', values.warmups, values.smoke ? 1 : 2, 0, 20),
    chrome: values.chrome, output: values.output,
  };
}

export function summary(samples: number[]) {
  if (!samples.length || samples.some(value => !Number.isFinite(value) || value < 0)) throw new Error('Invalid timing samples');
  const sorted = [...samples].sort((a, b) => a - b);
  const quantile = (fraction: number) => {
    const position = (sorted.length - 1) * fraction, low = Math.floor(position), weight = position - low;
    return sorted[low]! * (1 - weight) + sorted[Math.ceil(position)]! * weight;
  };
  return { medianMs: quantile(0.5), p25Ms: quantile(0.25), p75Ms: quantile(0.75), samplesMs: samples };
}
