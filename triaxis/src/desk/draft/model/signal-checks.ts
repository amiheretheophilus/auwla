// The signal rules, shared by the browser and the server. The editor runs them as the analyst
// types; the server runs them again when a draft is saved and when it is posted, so the browser's
// result is a preview and never the authority.
import { emptyFields, isAxis, markets, type SignalFields } from './signal-fields';
import type { SignalCheck, SignalReview } from './signal-review';

const textFields = ['axis', 'symbol', 'direction', 'entryType', 'entry', 'stop', 'risk', 'note'] as const;

function readTargets(source: Record<string, unknown>): string[] | null {
  // Drafts saved before editable targets used three numbered fields.
  const values = source.targets ?? [source.tp1, source.tp2, source.tp3].filter(value => value !== undefined);
  if (!Array.isArray(values)) return null;

  const targets: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string' || value.length > 64) return null;
    targets.push(value.trim());
  }

  // Only TP1 is required. Empty rows after the last price are ignored, so an extra target
  // box left blank does not hold the draft back. A blank row between prices still needs one.
  while (targets.length > 1 && targets.at(-1) === '') targets.pop();
  return targets.length > 0 ? targets : [''];
}

export function readSignalFields(input: unknown): SignalFields | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;

  const source = input as Record<string, unknown>;
  const fields = { ...emptyFields };

  for (const name of textFields) {
    const value = source[name];
    if (value === undefined) continue;
    if (typeof value !== 'string' || value.length > (name === 'note' ? 500 : 64)) return null;
    fields[name] = value.trim();
  }

  if (!isAxis(fields.axis)) return null;
  if (fields.symbol && !(markets[fields.axis].symbols as readonly string[]).includes(fields.symbol)) return null;
  if (!['', 'buy', 'sell'].includes(fields.direction)) return null;
  if (!['', 'market', 'limit', 'stop'].includes(fields.entryType)) return null;
  const targets = readTargets(source);
  if (!targets) return null;

  return { ...fields, targets };
}

function decimal(value: string): number | null {
  if (!/^(?:\d+\.?\d*|\.\d+)$/.test(value)) return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}

export function isOptionalRiskPercentage(value: string): boolean {
  return value === '' || decimal(value) !== null;
}

function positiveDecimal(value: string): number | null {
  const amount = decimal(value);
  return amount !== null && amount > 0 ? amount : null;
}

const distanceFormat = new Intl.NumberFormat('en', { maximumFractionDigits: 4 });

function priceChecks(fields: SignalFields): [SignalCheck, SignalCheck] {
  const prices = [fields.entry, fields.stop, ...fields.targets];
  const labels = ['Entry price', 'Stop loss', ...fields.targets.map((_, index) => `TP${index + 1}`)];
  const levelLabel = 'Level order';
  const rewardLabel = 'Target vs. stop distance';
  const rewardPending = {
    label: rewardLabel,
    status: 'pending',
    detail: 'Compares how far the target and stop are from the entry price.',
  } as const;

  if (!fields.direction) {
    return [{ label: levelLabel, status: 'pending', detail: 'Choose a direction.' }, rewardPending];
  }
  const empty = prices.findIndex(value => value === '');
  if (empty !== -1) {
    return [{ label: levelLabel, status: 'pending', detail: `Enter a price for ${labels[empty]}.` }, rewardPending];
  }

  const amounts = prices.map(positiveDecimal);
  const invalid = amounts.indexOf(null);
  if (invalid !== -1) {
    return [{ label: levelLabel, status: 'fail', detail: `${labels[invalid]} must be a positive number.` }, rewardPending];
  }

  const [entry, stop, ...targets] = amounts as number[];
  const direction = fields.direction === 'buy' ? 1 : -1;
  if ((entry - stop) * direction <= 0) {
    const side = direction > 0 ? 'below' : 'above';
    return [{ label: levelLabel, status: 'fail', detail: `Stop loss must be ${side} entry (${fields.entry}).` }, rewardPending];
  }

  for (const [index, target] of targets.entries()) {
    const previous = index === 0 ? entry : targets[index - 1];
    if ((target - previous) * direction > 0) continue;

    const previousLabel = index === 0 ? 'entry' : `TP${index}`;
    const previousPrice = index === 0 ? fields.entry : fields.targets[index - 1];
    const side = direction > 0 ? 'above' : 'below';
    const detail = target === previous
      ? `TP${index + 1} matches ${previousLabel} at ${previousPrice}. It must be ${side} that price.`
      : `TP${index + 1} must be ${side} ${previousLabel} (${previousPrice}).`;
    return [{ label: levelLabel, status: 'fail', detail }, rewardPending];
  }

  // Preserve the TP2 check for multi-target drafts and use TP1 for a single target.
  const rewardTarget = targets.length > 1 ? 1 : 0;
  const ratio = Math.abs(targets[rewardTarget] - entry) / Math.abs(entry - stop);
  const rewardStatus = ratio + 1e-9 < 1.5 ? 'fail' : ratio + 1e-9 < 2 ? 'warning' : 'pass';
  const distance = `Entry to target ${rewardTarget + 1} is ${distanceFormat.format(ratio)}× the distance from entry to the stop.`;
  const rewardThreshold = rewardStatus === 'fail'
    ? ' The minimum for this check is 1.5×.'
    : rewardStatus === 'warning'
      ? ' Meets the minimum. A full pass starts at 2×.'
      : '';
  return [
    { label: levelLabel, status: 'pass', detail: 'The stop and targets match the direction.' },
    { label: rewardLabel, status: rewardStatus, detail: distance + rewardThreshold },
  ];
}

export function inspectSignal(fields: SignalFields): SignalReview {
  const checks = priceChecks(fields);
  const missing = [];
  if (!fields.symbol) missing.push('Asset');
  if (!fields.entryType) missing.push('Entry type');

  const verdict = checks.some(check => check.status === 'fail')
    ? 'Rejected'
    : missing.length || checks.some(check => check.status === 'pending')
      ? 'Incomplete'
      : 'Price checks complete';

  return { checks, missing, verdict };
}
