import { captureDiagnostics, InspectorStore, metadataText, type Subscription } from './store';
import { inspectorClose, inspectorEvent, inspectorOpen, inspectorReady, type DiagnosticEvent, type Stamp } from './protocol';
import type { InspectorHot } from './bootstrap';
import { authoredLocation, sourceSection, traceTitle } from './presentation';

const stylesheet = new URL('./inspector.css', import.meta.url).href;
const fontStylesheet = new URL('./fonts.css', import.meta.url).href;
const escape = (value: unknown): string => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const human = (value: string) => value.replaceAll('-', ' ');
const empty = (title: string, text: string) => `<div class="empty"><strong>${title}</strong>${text}</div>`;
const badge = (value: unknown) => `<span class="badge mono">${escape(value)}</span>`;
const clock = (value: number) => new Date(value).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
/** Presentation only: no application subscriptions, mutation controls, observers or console patching. */
export function mountInspector(options: { hot?: InspectorHot; server: boolean; close(): void }): { dispose(): void } {
  const previousFocus = document.activeElement;
  const host = document.createElement('memoized-dom-inspector');
  host.setAttribute('data-mmd-inspector', '');
  const shadow = host.attachShadow({ mode: 'open' });
  const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = stylesheet; shadow.append(link);
  // Chrome does not register @font-face inside shadow stylesheets. Namespaced
  // font declarations have no application selectors and are released on close.
  const fonts = document.createElement('link'); fonts.rel = 'stylesheet'; fonts.href = fontStylesheet; fonts.setAttribute('data-mmd-inspector-fonts', ''); document.head.append(fonts);
  const panel = document.createElement('section'); panel.className = 'inspector'; panel.setAttribute('aria-label', 'Memoized DOM development inspector');
  panel.innerHTML = `<header class="toolbar"><div class="brand"><span class="mark" aria-hidden="true">m.</span>Memoized DOM <span class="dev">DEV</span></div><div class="tools"><button class="tool theme" data-action="theme" aria-label="Change inspector color theme">System</button><button class="tool symbol" data-action="expand" aria-label="Expand inspector" aria-pressed="false">↗</button><button class="tool symbol" data-action="close" aria-label="Close inspector">×</button></div></header>
    <nav class="tabs" role="tablist" aria-label="Inspector views">${[['live', 'Live'], ['events', 'Events'], ['regions', 'Regions'], ['issues', 'Issues']].map(([id, name]) => `<button type="button" id="mmd-tab-${id}" data-tab="${id}" role="tab" aria-selected="${id === 'live'}" aria-controls="mmd-inspector-panel"${id === 'regions' ? ' aria-label="Conditional regions"' : ''}>${name}<span class="badge" data-count="${id}">0</span></button>`).join('')}</nav>
    <div class="filterbar"><span class="row" data-summary></span><label class="sr" for="mmd-inspector-filter">Filter diagnostic names and sources</label><input id="mmd-inspector-filter" placeholder="Filter names or sources…" type="search" autocomplete="off" spellcheck="false"></div>
    <div class="body" id="mmd-inspector-panel" role="tabpanel" aria-labelledby="mmd-tab-live"></div>
    <footer class="footer"><span data-capture>Local development only</span><span class="row"><span data-dropped></span><button data-action="clear">Clear history</button><button data-action="export">Export metadata</button><span class="mono">Alt ⇧ M</span></span></footer><span class="sr" aria-live="polite" data-announcement></span>`;
  shadow.append(panel); document.documentElement.append(host);
  const body = panel.querySelector<HTMLDivElement>('.body')!, summary = panel.querySelector<HTMLElement>('[data-summary]')!;
  const filter = panel.querySelector<HTMLInputElement>('input')!;
  const announcement = panel.querySelector<HTMLElement>('[data-announcement]')!;
  const store = new InspectorStore();
  const expandedIssues = new Set<number>();
  const issueSources = new WeakMap<HTMLElement, DiagnosticEvent>();
  const traceIds = new WeakMap<DiagnosticEvent, number>();
  let nextTraceId = 0, followLatest = true, renderedTrace: DiagnosticEvent | undefined;
  const traceId = (event: DiagnosticEvent) => {
    let id = traceIds.get(event); if (id === undefined) traceIds.set(event, id = ++nextTraceId); return id;
  };
  const tooling = (action: () => void) => { try { action(); } catch { /* A disconnected dev channel never blocks cleanup. */ } };
  let tab = 'live', selected: string | undefined, selectedTrace: DiagnosticEvent | undefined;
  let traces: DiagnosticEvent[] = [], raf: number | undefined, disposed = false, theme = 0, serverConnected = false;
  const traceSelections = new Map<string, { selected?: DiagnosticEvent; follow: boolean }>();
  const matches = (value: unknown) => String(value).toLowerCase().includes(filter.value.toLowerCase());
  const visibleEvent = (event: DiagnosticEvent) => matches([event.event, event.data.source, event.data.component, event.data.sources, event.data.key].join(' '));
  function live(): string {
    const sources = [...store.subscriptions.values()].filter(source => matches([source.source, source.key, source.id].join(' ')));
    if (!sources.some(source => source.id === selected)) selected = sources[0]?.id;
    const source = sources.find(source => source.id === selected);
    summary.innerHTML = `<span class="dot"></span>${store.connections.size} connection${store.connections.size === 1 ? '' : 's'} <span>·</span>${store.subscriptions.size} subscriptions`;
    const list = sources.map(item => {
      const amber = ['held', 'protected', 'reconnecting', 'connecting'].includes(item.state), red = item.state === 'error';
      return `<button class="source" data-source="${escape(item.id)}" data-focus="${escape(item.id)}" aria-pressed="${selected === item.id}"><span class="top"><strong>${escape(item.source)}</strong><span class="status ${red ? 'red' : amber ? 'amber' : ''}"><span class="dot ${red ? 'red' : amber ? 'amber' : ''}"></span>${escape(human(item.state))}</span></span><span class="key">${escape(item.key ?? 'Waiting for first cursor')}</span><small>${escape(item.id)} · ${escape(item.transport ?? 'transport not reported')}</small></button>`;
    }).join('');
    const connections = [...store.connections.values()].map(item => `<div class="connection"><span>${escape(item.transport)} <span class="mono muted">${escape(item.id)}</span></span><span class="muted">${escape(item.state)}${item.attempt ? ` · attempt ${item.attempt}` : ''}</span></div>`).join('');
    return `<div class="live-layout"><aside class="sources" aria-label="Live subscriptions"><div class="listhead"><span class="eyebrow">Subscriptions</span>${badge(sources.length)}</div>${list || empty('No matching live sources', 'Existing live sources announce their active metadata when capture opens. No refetch is triggered.')}<div class="listnote">Equal keys do not merge subscriptions. Each query keeps its own result and context.</div>${connections ? `<div class="listnote"><div class="eyebrow">Physical connections</div>${connections}</div>` : ''}</aside><section class="detail" aria-label="Selected subscription">${source ? subscription(source) : empty('Select a live source', 'Names, cursors and transport state appear here. Request and response payloads are never captured.')}</section></div>`;
  }
  function subscription(source: Subscription): string {
    const held = source.state === 'held' || source.pending > 0;
    const error = source.state === 'error';
    const label = held ? source.pending ? 'Waiting for optimistic action' : 'Waiting for mutation confirmation' : error ? 'Stream stopped with an error' : source.state === 'connecting' ? 'Connecting to the live source' : source.state === 'reconnecting' ? 'Transport is reconnecting' : 'Latest source metadata';
    const message = held ? 'A buffered snapshot must not overwrite the protected local change.' : 'This is delivery state, not a claim that the browser painted.';
    const fields: [string, unknown][] = [['Live key', source.key ?? 'Not received'], ['Source', source.id], ['Transport', source.transport ?? 'Not reported'],
      ['Connection', source.connectionId ?? 'Not reported'], ['Epoch', source.epoch ?? 'Not received'], ['Revision', source.revision ?? 'Not received'],
      ['Patch sequence', source.sequence ?? 'Not reported'], ['Optimistic actions', source.pending], ['Reason', source.reason ?? '—']];
    const recent = store.events.filter(event => event.data.sourceId === source.id).slice(-7);
    const serverEvents = store.events.filter(event => event.origin === 'server' && event.data.source === source.source && (event.data.stamp as Stamp | undefined)?.key === source.key).slice(-4);
    return `<div class="eyebrow">Subscription detail</div><div class="title"><h3>${escape(source.source)}</h3>${badge(source.method)}</div><div class="notice ${held ? 'amber' : error ? 'red' : ''}">${escape(label)}<small>${message}</small></div><dl class="fields">${fields.map(([name, value]) => `<dt>${name}</dt><dd class="mono">${escape(value)}</dd>`).join('')}</dl><div class="rule"></div><div class="eyebrow">Recent browser delivery</div><ol class="delivery">${recent.map(event => `<li><time>${clock(event.timestamp)}</time><span>${escape(human(event.event))}${typeof event.data.reason === 'string' ? ` <span class="muted">· ${escape(event.data.reason)}</span>` : ''}</span></li>`).join('')}</ol>${serverEvents.length ? `<div class="rule"></div><div class="eyebrow">Server observations · instance scope</div><p class="muted privacy">Same name and key, not necessarily this browser's request.</p><ol class="delivery">${serverEvents.map(event => `<li><time>${clock(event.timestamp)}</time><span>${escape(human(event.event))}</span></li>`).join('')}</ol>` : ''}`;
  }
  function reactivity(): void {
    const facts = [...store.traceSites.values()].filter(site => site.registration.data.kind === (tab === 'events' ? 'event' : 'conditional'));
    const records = facts.map(site => site.registration);
    traces = records.filter(visibleEvent);
    if (selectedTrace && !records.includes(selectedTrace)) selectedTrace = undefined;
    if (followLatest) selectedTrace = facts.filter(site => visibleEvent(site.registration)).sort((a,b) => (b.activatedAt ?? 0) - (a.activatedAt ?? 0))[0]?.registration;
    const count = records.length;
    summary.textContent = `${count} attached ${tab === 'events' ? 'handlers' : 'regions'} · ${followLatest ? 'following activity' : 'selection pinned'}`;
    if (!body.querySelector('[data-trace-list]')) {
      body.innerHTML = `<section class="section"><div class="sectionhead"><div><h3 data-trace-heading></h3><p data-trace-intro></p></div><button class="tool" data-action="trace-follow" aria-pressed="true">Following latest</button></div><div class="trace-layout"><div class="trace-list" data-trace-list aria-label="Runtime trace"></div><section class="trace-detail" aria-label="Selected trace event"></section></div></section>`;
      renderedTrace = undefined;
    }
    body.querySelector('[data-trace-heading]')!.textContent = tab === 'events' ? 'Event handlers' : 'Conditional regions';
    body.querySelector('[data-trace-intro]')!.textContent = tab === 'events' ? 'Attached handlers appear before they run. A row flashes when its handler runs.' : 'Active regions appear before they change. A row flashes when its condition is checked.';
    const follow = body.querySelector<HTMLButtonElement>('[data-action="trace-follow"]')!;
    follow.textContent = followLatest ? 'Following latest' : 'Follow latest'; follow.setAttribute('aria-pressed', String(followLatest));
    // A selected record has one bounded extra reference, even after it leaves
    // the rolling window. Stable IDs, never row indexes, identify trace cards.
    const displayed = selectedTrace && !followLatest && !traces.includes(selectedTrace) ? [selectedTrace, ...traces] : traces;
    const list = body.querySelector<HTMLElement>('[data-trace-list]')!, wanted = new Set(displayed.map(event => String(traceId(event))));
    for (const node of list.querySelectorAll<HTMLElement>('[data-trace]')) if (!wanted.has(node.dataset.trace!)) node.remove();
    list.querySelector('.empty')?.remove();
    for (let index = 0; index < displayed.length; index++) {
      const event = displayed[index]!, id = traceId(event);
      let card = list.querySelector<HTMLButtonElement>(`[data-trace="${id}"]`);
      if (!card) {
        card = document.createElement('button'); card.className = 'trace'; card.dataset.trace = String(id); card.dataset.focus = `trace-${id}`;
        const site = authoredLocation(event);
        card.innerHTML = `<span><b>${escape(traceTitle(event))}</b><small>${escape(site ? `${site.component} · ${site.file}:${site.line}` : event.data.component ?? 'Generated UI step')}</small><small data-runs></small></span><span class="activity-dot" aria-hidden="true"></span>`;
      }
      const fact = store.traceSites.get(String(event.data.siteId));
      card.querySelector('[data-runs]')!.textContent = fact?.runs ? `${fact.runs} ${tab === 'events' ? 'invocations' : 'checks'}` : 'Attached · not run during this capture';
      if (fact?.activatedAt !== undefined && card.dataset.activation !== String(fact.activatedAt)) {
        card.dataset.activation = String(fact.activatedAt);
        if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) card.animate?.([{backgroundColor:'var(--green-bg)'},{backgroundColor:'transparent'}],{duration:850});
        card.querySelector('.activity-dot')?.animate?.([{opacity:1},{opacity:0}],{duration:1000});
      }
      card.setAttribute('aria-pressed', String(event === selectedTrace));
      if (list.children[index] !== card) list.insertBefore(card, list.children[index] ?? null);
    }
    if (!displayed.length) list.innerHTML = empty(tab === 'events' ? 'No attached handlers' : 'No registered regions', 'Mounted development-compiled UI announces its sites automatically; clicking is not required.');
    const detail = body.querySelector<HTMLElement>('.trace-detail')!;
    if (renderedTrace !== selectedTrace || !detail.hasChildNodes()) {
      renderedTrace = selectedTrace;
      const site = selectedTrace && authoredLocation(selectedTrace);
      detail.innerHTML = selectedTrace ? `<h3>${escape(traceTitle(selectedTrace))}</h3><p data-site-status></p>${site ? sourceSection(site) : `<div class="empty"><strong>Internal boundary · source not mapped</strong>This boundary is registered at runtime, but has no authored JSX address. It is not presented as a source-level condition.</div>`}<details class="trace-raw"><summary>Internal details</summary><pre class="code">${escape(JSON.stringify(selectedTrace.data, (key, value) => key === 'code' ? undefined : value, 2))}</pre></details>` : empty('Select an attached site', 'Its component, source line and JSX will appear here.');
      const code = detail.querySelector<HTMLElement>('.source-code'), highlight = detail.querySelector<HTMLElement>('.source-line.selected');
      if (code && highlight) {
        code.scrollTop = Math.max(0, highlight.offsetTop - code.clientHeight / 3);
        const mark = highlight.querySelector('mark');
        if (mark) code.scrollLeft = Math.max(0, mark.offsetLeft - code.clientWidth / 4);
      }
    }
    const selectedFact = selectedTrace && store.traceSites.get(String(selectedTrace.data.siteId));
    const status = detail.querySelector('[data-site-status]');
    if (status) status.textContent = selectedFact?.runs ? `${selectedFact.runs} ${tab === 'events' ? 'invocations' : 'checks'} during this capture · last ${clock(selectedFact.activatedAt!)}` : 'Attached · not run during this capture';
  }
  function issues(): void {
    const observations = store.issues.filter(issue => visibleEvent(issue.event)).slice().reverse();
    summary.textContent = `${observations.length} observations · ${options.server ? 'browser and native server instance' : 'browser diagnostics; server relay unavailable for this host'}`;
    if (!body.querySelector('[data-issues-list]')) body.innerHTML = `<section class="section"><div class="sectionhead"><div><h3>Explain what did—and didn’t—update.</h3><p>Observations, not guesses about application intent.</p></div></div><div data-issues-list></div><p class="muted privacy">Request bodies, response values, cookies, authorization headers and DOM text are not collected.</p></section>`;
    const list = body.querySelector<HTMLElement>('[data-issues-list]')!;
    const active = new Set(store.issues.map(issue => issue.id));
    for (const id of expandedIssues) if (!active.has(id)) expandedIssues.delete(id);
    const visible = new Set(observations.map(issue => String(issue.id)));
    for (const node of list.querySelectorAll<HTMLElement>('[data-issue]')) if (!visible.has(node.dataset.issue!)) node.remove();
    if (!observations.length) {
      if (!list.querySelector('.empty')) list.innerHTML = empty('No observations captured', options.server ? 'Warnings and unmatched server invalidations will appear here when observed.' : 'Browser warnings appear here. Server invalidations require the native Bun/Node development host relay.');
      return;
    }
    list.querySelector('.empty')?.remove();
    // Keep the actual disclosure nodes, focus, selection and scroll while trace
    // events arrive. Replacing innerHTML here would reset <details open>.
    for (let index = 0; index < observations.length; index++) {
      const issue = observations[index]!;
      let article = list.querySelector<HTMLElement>(`[data-issue="${issue.id}"]`);
      if (!article) {
        article = document.createElement('article'); article.className = 'issue'; article.dataset.issue = String(issue.id);
        const message = issue.event.event === 'trace-throttled' ? 'Tracing reached its sampling limit. Repeated notices are grouped here; this is not a failed live query or evidence that the DOM changed. Background binding evaluations can also produce trace traffic.' : issue.event.event === 'invalidate' ? 'No active key matched on this application instance at that moment. The intended subscriber could be unmounted or on another instance.' : issue.event.event === 'subscription-fallback' ? 'The query uses the normal direct transport. Middleware and HTTP response semantics remain intact.' : issue.event.event === 'missing-mutation-confirmation' ? 'Pending protection still works. This result cannot establish a comparable mutation acknowledgement.' : 'The metadata below records the boundary and reason. Payloads, exceptions and application state are intentionally omitted.';
        article.innerHTML = `<div class="issue-label"></div><h4>${escape(issue.summary)}</h4><p>${message}</p><div data-issue-source></div><div class="issue-context"><div class="eyebrow">Latest observed boundary</div><dl class="fields"><dt>Component</dt><dd data-location="component" class="mono"></dd><dt>Source</dt><dd data-location="source" class="mono"></dd><dt>Binding</dt><dd data-location="binding" class="mono"></dd><dt>Trigger</dt><dd data-location="trigger" class="mono"></dd></dl><small>Identifies the observed boundary, not a claim that it caused all preceding work.</small></div><details data-issue-details="${issue.id}"><summary>Diagnostic metadata</summary><pre class="code"></pre></details>`;
        article.querySelector('details')!.open = expandedIssues.has(issue.id);
      }
      const label = `${human(issue.event.event)} · ${issue.event.origin} · ${clock(issue.event.timestamp)}${issue.count > 1 ? ` · ${issue.count} occurrences` : ''}`;
      const heading = article.querySelector('.issue-label')!; if (heading.textContent !== label) heading.textContent = label;
      if (issueSources.get(article) !== issue.event) {
        const site = authoredLocation(issue.event);
        article.querySelector('[data-issue-source]')!.innerHTML = site ? sourceSection(site) : '';
        issueSources.set(article, issue.event);
      }
      for (const field of ['component', 'source', 'binding', 'trigger'] as const) {
        const node = article.querySelector(`[data-location="${field}"]`)!;
        const value = issue.event.data[field] ?? (field === 'source' && Array.isArray(issue.event.data.sources) && issue.event.data.sources.length ? issue.event.data.sources.join(', ') : 'Not reported');
        if (node.textContent !== String(value)) node.textContent = String(value);
      }
      const metadata = article.querySelector('pre')!, text = metadataText(issue.event.data);
      if (metadata.textContent !== text) metadata.textContent = text;
      if (list.children[index] !== article) list.insertBefore(article, list.children[index] ?? null);
    }
  }
  function render(): void {
    if (disposed) return;
    const focus = shadow.activeElement?.getAttribute('data-focus');
    if (tab === 'issues') issues();
    else if (['events', 'regions'].includes(tab)) reactivity();
    else body.innerHTML = live();
    body.setAttribute('aria-labelledby', `mmd-tab-${tab}`);
    for (const button of panel.querySelectorAll<HTMLButtonElement>('[data-tab]')) button.setAttribute('aria-selected', String(button.dataset.tab === tab));
    for (const name of ['live', 'events', 'regions', 'issues']) {
      const count = name === 'live' ? store.subscriptions.size : name === 'issues' ? store.issues.length : [...store.traceSites.values()].filter(site => site.registration.data.kind === (name === 'events' ? 'event' : 'conditional')).length;
      panel.querySelector(`[data-count="${name}"]`)!.textContent = String(count);
    }
    panel.querySelector('[data-dropped]')!.textContent = store.dropped ? `${store.dropped} events omitted ·` : '';
    panel.querySelector('[data-capture]')!.textContent = serverConnected ? 'Local development · browser + native server' : options.server ? 'Local development · browser · server channel not connected' : 'Local development · browser';
    if (focus) shadow.querySelector<HTMLElement>(`[data-focus="${CSS.escape(focus)}"]`)?.focus({ preventScroll: true });
  }
  const schedule = () => { if (raf !== undefined || disposed) return; raf = requestAnimationFrame(() => { raf = undefined; render(); }); };
  const unsubscribe = store.subscribe(schedule);
  const receive = (input: unknown) => store.accept(input);
  const ready = (input: unknown) => {
    if (input && typeof input === 'object' && (input as { version?: unknown }).version === 1 && (input as { server?: unknown }).server === true && options.server) { serverConnected = true; schedule(); }
  };
  const reconnect = () => { if (!disposed) tooling(() => options.hot?.send(inspectorOpen)); };
  const disconnect = () => { serverConnected = false; schedule(); };
  tooling(() => options.hot?.on(inspectorEvent, receive));
  tooling(() => options.hot?.on(inspectorReady, ready)); tooling(() => options.hot?.on('vite:ws:connect', reconnect)); tooling(() => options.hot?.on('vite:ws:disconnect', disconnect));
  tooling(() => options.hot?.send(inspectorOpen));
  const release = captureDiagnostics(store);
  const click = (event: Event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button'); if (!button) return;
    if (button.dataset.tab) {
      if (['events', 'regions'].includes(tab)) traceSelections.set(tab, { selected: followLatest ? undefined : selectedTrace, follow: followLatest });
      tab = button.dataset.tab;
      const previous = traceSelections.get(tab); selectedTrace = previous?.selected; followLatest = previous?.follow ?? true;
      body.scrollTop = 0; render(); announcement.textContent = `${button.textContent} view selected`;
    }
    else if (button.dataset.source) { selected = button.dataset.source; render(); announcement.textContent = 'Subscription selected'; }
    else if (button.dataset.trace !== undefined) {
      selectedTrace = traces.find(event => traceId(event) === Number(button.dataset.trace)) ?? selectedTrace;
      followLatest = false; render(); announcement.textContent = 'Trace event pinned';
      // Selecting a card must reveal its code on a narrow dock as well as a workbench.
      // Do not scroll on incoming events, which would interrupt source inspection.
      if (window.matchMedia('(max-width:700px)').matches) body.querySelector('.trace-detail')?.scrollIntoView({ block: 'start' });
    }
    else if (button.dataset.action === 'close') options.close();
    else if (button.dataset.action === 'expand') {
      const expanded = host.toggleAttribute('data-expanded'); button.setAttribute('aria-pressed', String(expanded)); button.setAttribute('aria-label', expanded ? 'Dock inspector' : 'Expand inspector'); button.textContent = expanded ? '↙' : '↗';
    } else if (button.dataset.action === 'theme') {
      theme = (theme + 1) % 3; const name = ['system', 'light', 'dark'][theme]!;
      if (name === 'system') host.removeAttribute('data-theme'); else host.setAttribute('data-theme', name);
      button.textContent = name[0]!.toUpperCase() + name.slice(1);
    } else if (button.dataset.action === 'trace-follow') { followLatest = !followLatest; render(); }
    else if (button.dataset.action === 'clear') { selectedTrace = undefined; followLatest = true; traceSelections.clear(); store.clear(); announcement.textContent = 'Diagnostic history cleared. Live sources were not changed.'; }
    else if (button.dataset.action === 'export') {
      const url = URL.createObjectURL(new Blob([JSON.stringify(store.report(), null, 2)], { type: 'application/json' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'memoized-dom-inspector.json'; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }
  };
  const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); options.close(); } };
  const toggle = (event: Event) => {
    const details = event.target;
    if (!(details instanceof HTMLDetailsElement) || !details.dataset.issueDetails || !details.isConnected) return;
    const id = Number(details.dataset.issueDetails);
    if (details.open) expandedIssues.add(id); else expandedIssues.delete(id);
  };
  panel.addEventListener('click', click); panel.addEventListener('keydown', key);
  panel.addEventListener('toggle', toggle, true);
  filter.addEventListener('input', render);
  render(); panel.querySelector<HTMLButtonElement>('[data-tab="live"]')!.focus({ preventScroll: true });
  return { dispose() {
    if (disposed) return; disposed = true;
    release(); unsubscribe(); tooling(() => options.hot?.off(inspectorEvent, receive)); tooling(() => options.hot?.send(inspectorClose));
    tooling(() => options.hot?.off(inspectorReady, ready)); tooling(() => options.hot?.off('vite:ws:connect', reconnect)); tooling(() => options.hot?.off('vite:ws:disconnect', disconnect));
    if (raf !== undefined) cancelAnimationFrame(raf);
    panel.removeEventListener('click', click); panel.removeEventListener('keydown', key); filter.removeEventListener('input', render);
    panel.removeEventListener('toggle', toggle, true); expandedIssues.clear(); traceSelections.clear(); selectedTrace = renderedTrace = undefined; traces = [];
    store.dispose(); host.remove(); fonts.remove();
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
  } };
}
