import type { AuthoredLocation, DiagnosticEvent } from './protocol';
export const escapeHtml = (value: unknown): string => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
export function authoredLocation(event: DiagnosticEvent): AuthoredLocation | undefined {
  const value = event.data.location;
  return value && typeof value === 'object' && 'code' in value ? value as AuthoredLocation : undefined;
}
export function traceTitle(event: DiagnosticEvent): string {
  if (event.event === 'event-registered') return `${({onClick:'Click',onDblClick:'Double-click',onSubmit:'Submit',onInput:'Input',onChange:'Change'} as Record<string,string>)[String(event.data.type)] ?? String(event.data.type ?? 'Event').replace(/^on/, '')} handler`;
  if (event.event === 'region-registered') return authoredLocation(event) ? 'Conditional region' : 'Internal region';
  if (event.data.kind === 'conditional') return event.event === 'update-started' ? 'Conditional region checked' : event.event === 'update-completed' ? 'Conditional region check completed' : event.event === 'update-threw' ? 'Conditional region failed' : 'Conditional region observation';
  if (event.event === 'event-started') return `${({ onClick: 'Click', onDblClick: 'Double-click', onSubmit: 'Submit', onInput: 'Input', onChange: 'Change' } as Record<string, string>)[String(event.data.type)] ?? String(event.data.type ?? 'Event').replace(/^on/, '')} handler ran`;
  if (event.event === 'dom-write') return event.data.operation === 'text' ? 'Text updated' : String(event.data.operation).startsWith('attribute:') ? `Attribute updated: ${String(event.data.operation).slice(10)}` : 'Element updated';
  return ({ 'event-returned': 'Handler returned', 'event-threw': 'Handler failed', 'binding-evaluated': 'JSX expression checked', 'write-published': 'State update reported', 'update-started': 'UI update began', 'update-completed': 'UI update completed', 'update-threw': 'UI update failed', 'trace-throttled': 'Trace recording limit reached' } as Record<string, string>)[event.event] ?? event.event.replaceAll('-', ' ');
}
export function traceView(event: DiagnosticEvent): 'events' | 'regions' | 'reactivity' {
  return event.event.startsWith('event-') ? 'events' : event.data.kind === 'conditional' ? 'regions' : 'reactivity';
}
/** Whole JSX section, real file line numbers, exact highlighted expression. */
export function sourceSection(site: AuthoredLocation): string {
  let offset = 0;
  const lines = site.code.split('\n').map((line, index) => {
    const content = line.endsWith('\r') ? line.slice(0, -1) : line;
    const from = Math.max(0, site.highlightStart - offset), to = Math.min(content.length, site.highlightEnd - offset);
    const selected = from < to;
    const code = selected ? `${escapeHtml(content.slice(0, from))}<mark>${escapeHtml(content.slice(from, to))}</mark>${escapeHtml(content.slice(to))}` : escapeHtml(content);
    offset += line.length + 1;
    return `<div class="source-line${selected ? ' selected' : ''}"><span class="source-number" aria-hidden="true">${site.sectionLine + index}</span><code>${code || ' '}</code></div>`;
  }).join('');
  return `<section class="source-panel"><div class="source-heading"><span><span class="eyebrow">Authored JSX</span><strong>${escapeHtml(site.component)}</strong></span><span class="mono">${escapeHtml(site.file)}:${site.line}:${site.column}</span></div><div class="source-code" role="region" aria-label="Authored JSX section" tabindex="0">${lines}</div></section>`;
}
