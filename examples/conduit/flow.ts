// Scripted walk through the main Conduit flows: bun examples/conduit/flow.ts [origin]
import puppeteer, { type Page } from 'puppeteer-core';

const origin = process.argv[2] ?? 'http://127.0.0.1:5400';
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const problems: string[] = [];
let currentPage: Page | undefined;
const step = async (name: string, run: () => Promise<unknown>) => {
  try { await run(); console.log('ok  ', name); }
  catch (error) {
    console.log('FAIL', name, '-', String(error).split('\n')[0]);
    problems.push(name);
    if (process.env.FLOW_DEBUG && currentPage) console.log('  at', new URL(currentPage.url()).pathname, '\n  page:',
      (await currentPage.evaluate(() => document.querySelector('main, .app')?.textContent?.replace(/\s+/g, ' ').slice(0, 500)).catch(String)));
  }
};
const text = (page: Page, selector: string) => page.$eval(selector, node => node.textContent ?? '');
const until = (page: Page, check: () => boolean) => page.waitForFunction(check, { timeout: 10_000, polling: 100 });
// Click the element itself: avatars load from another site and shift the layout,
// so a mouse click at measured coordinates can miss.
const press = (page: Page, selector: string) => page.$eval(selector, node => (node as HTMLElement).click());
// Type into a field without depending on where keyboard focus is.
const fill = (page: Page, selector: string, text: string) => page.$eval(selector, (node, value) => {
  const field = node as HTMLInputElement | HTMLTextAreaElement;
  field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
}, text);

try {
  const page = await browser.newPage();
  currentPage = page;
  // Browser UI (an autofill/save prompt after the sign-in form) can take window
  // focus, and an unfocused headless page receives no key events.
  await (await page.createCDPSession()).send('Emulation.setFocusEmulationEnabled', { enabled: true });
  // Render failures arrive as one AggregateError; report each inner error.
  await page.evaluateOnNewDocument(() => {
    window.addEventListener('error', event => {
      for (const inner of (event.error as { errors?: unknown[] } | undefined)?.errors ?? []) {
        console.error('[render error]', String((inner as Error)?.stack ?? inner).slice(0, 600));
      }
    });
  });
  page.on('console', message => { if (message.text().startsWith('[render error]')) problems.push(message.text()); });
  page.on('pageerror', error => problems.push('pageerror: ' + String(error).slice(0, 300)));
  if (process.env.FLOW_DEBUG) page.on('response', r => { if (r.request().method() !== 'GET' && r.url().includes('_fn')) console.log('  response', r.status(), new URL(r.url()).pathname, r.request().postData()?.slice(0, 120)); });
  await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });

  await step('home shows the global feed', () => until(page, () => document.querySelectorAll('.preview').length === 3));
  await step('a tag filters the feed', async () => {
    await press(page, '.tag-cloud .tag:nth-child(4)'); // "history"
    await until(page, () => document.querySelector('.tabs .active')?.textContent?.includes('history') === true &&
      document.querySelectorAll('.preview').length === 2);
  });
  await step('sign in validates, then signs in', async () => {
    await press(page, 'a[href="/login"]');
    await page.waitForSelector('.auth form');
    // The browser itself rejects a malformed email; the schema catches a short password.
    await fill(page, 'input[name=email]', 'ada@conduit.dev');
    await fill(page, 'input[name=password]', 'short');
    await press(page, '.auth form button');
    await until(page, () => (document.querySelector('.error-messages')?.textContent ?? '').includes('at least 8'));
    await page.$eval('input[name=password]', input => { (input as HTMLInputElement).value = ''; });
    await fill(page, 'input[name=password]', 'wrong-password');
    await press(page, '.auth form button');
    await until(page, () => (document.querySelector('.error-messages')?.textContent ?? '').includes('Email or password is invalid'));
    await page.$eval('input[name=password]', input => { (input as HTMLInputElement).value = ''; });
    await fill(page, 'input[name=password]', 'password');
    await press(page, '.auth form button');
    await until(page, () => document.querySelector('.navbar .me')?.textContent?.includes('ada') === true);
  });
  await step('your feed shows followed authors', async () => {
    await until(page, () => [...document.querySelectorAll('.tabs button')].some(button => button.textContent === 'Your Feed'));
    await page.evaluate(() => ([...document.querySelectorAll('.tabs button')].find(button => button.textContent === 'Your Feed') as HTMLElement).click());
    await until(page, () => [...document.querySelectorAll('.preview .author')].every(author => author.textContent === 'grace') &&
      document.querySelectorAll('.preview').length === 2);
  });
  await step('favoriting updates the count at once', async () => {
    const before = Number((await text(page, '.preview .favorite')).replace(/\D/g, ''));
    await press(page, '.preview .favorite');
    await page.waitForFunction(count => Number(document.querySelector('.preview .favorite')?.textContent?.replace(/\D/g, '')) !== count,
      { timeout: 10_000, polling: 100 }, before);
    const after = Number((await text(page, '.preview .favorite')).replace(/\D/g, ''));
    if (after !== before + 1 && after !== before - 1) throw new Error(`count ${before} -> ${after}`);
  });
  await step('an article renders markdown and comments', async () => {
    await press(page, '.preview-link');
    await page.waitForSelector('.article-page .markdown');
    await until(page, () => (document.querySelector('.markdown')?.innerHTML ?? '').includes('<'));
  });
  await step('posting a comment adds it', async () => {
    await page.waitForSelector('.comment-form textarea');
    await fill(page, '.comment-form textarea', 'A comment from the flow script');
    await press(page, '.comment-form button');
    await until(page, () => [...document.querySelectorAll('.comment p')].some(node => node.textContent === 'A comment from the flow script'));
  });
  await step('publishing an article opens it', async () => {
    await press(page, 'a[href="/editor"]');
    await page.waitForSelector('.editor form');
    await fill(page, 'input[name=title]', 'Flow script article');
    await fill(page, 'input[name=description]', 'Written by a script');
    await fill(page, 'textarea[name=body]', '# Hello\n\nFrom **the flow**.');
    // After the sign-in form, Chrome's own UI can capture key events, so deliver
    // the input and Enter the way the page receives them.
    await fill(page, 'input[placeholder="Enter tags"]', 'flow');
    await page.$eval('input[placeholder="Enter tags"]', node => node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
    await until(page, () => document.querySelector('.tag-list.editable')?.textContent?.includes('flow') === true);
    await press(page, '.editor form > button');
    await until(page, () => document.querySelector('.article-page h1')?.textContent === 'Flow script article');
  });
  await step('editing starts from the saved article', async () => {
    await press(page, '.actions a.button');
    await until(page, () => (document.querySelector('input[name=title]') as HTMLInputElement | null)?.value === 'Flow script article');
  });
  await step('settings saves the bio', async () => {
    await press(page, 'a[href="/settings"]');
    await page.waitForSelector('.settings textarea');
    await page.$eval('.settings textarea', node => { (node as HTMLTextAreaElement).value = ''; });
    await fill(page, '.settings textarea', 'Updated by the flow');
    await press(page, '.settings form button');
    await until(page, () => document.querySelector('.saved') !== null);
  });
  await step('the profile shows the new bio', async () => {
    await press(page, '.navbar .me');
    await until(page, () => document.querySelector('.banner.user p')?.textContent === 'Updated by the flow');
  });
} finally {
  await browser.close().catch(() => {});
}
console.log(problems.length === 0 ? 'all flows passed' : `problems:\n${problems.join('\n')}`);
