const price = /^(?:\d+\.?\d*|\.\d+)$/;
const labels = /\b(?:entry|sl|stop(?:\s+loss)?|tp\d*|target)\b\s*[:=]?/gi;

export function parsePastedLevels(text: string) {
  const values = text.replace(labels, ' ').trim().split(/[\s,;]+/);
  if (values.length < 3 || values.some(value => !price.test(value) || value.length > 64)) return null;

  const [entry, stop, ...targets] = values;
  return { entry, stop, targets };
}
