// Scripted walk through the main Conduit flows: bun examples/conduit/flow.ts [origin]
import puppeteer, { type Page } from 'puppeteer-core';

const origin = process.argv[2] ?? 'http://127.0.0.1:5400';
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const problems: string[] = [];
const step = async (name: string, run: () => Promise<unknown>) => {
  try { await run(); console.log('ok  ', name); }
  catch (error) { console.log('FAIL', name, '-', String(error).split('\n')[0]); problems.push(name); }
};
const text = (page: Page, selector: string) => page.$eval(selector, node => node.textContent ?? '');
const until = (page: Page, check: () => boolean) => page.waitForFunction(check, { timeout: 10_000, polling: 100 });

try {
  const page = await browser.newPage();
  page.on('pageerror', error => problems.push('pageerror: ' + String(error).slice(0, 300)));
  await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });

  await step('home shows the global feed', () => until(page, () => document.querySelectorAll('.preview').length === 3));
  await step('a tag filters the feed', async () => {
    await page.click('.tag-cloud .tag:nth-child(4)'); // "history"
    await until(page, () => document.querySelector('.tabs .active')?.textContent?.includes('history') === true &&
      document.querySelectorAll('.preview').length === 2);
  });
  await step('sign in validates, then signs in', async () => {
    await page.click('a[href="/login"]');
    await page.waitForSelector('.auth form');
    // The browser itself rejects a malformed email; the schema catches a short password.
    await page.type('input[name=email]', 'ada@conduit.dev');
    await page.type('input[name=password]', 'short');
    await page.click('.auth form button');
    await until(page, () => (document.querySelector('.error-messages')?.textContent ?? '').includes('at least 8'));
    await page.$eval('input[name=password]', input => { (input as HTMLInputElement).value = ''; });
    await page.type('input[name=password]', 'password');
    await page.click('.auth form button');
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
    await page.click('.preview .favorite');
    await page.waitForFunction(count => Number(document.querySelector('.preview .favorite')?.textContent?.replace(/\D/g, '')) !== count,
      { timeout: 10_000, polling: 100 }, before);
    const after = Number((await text(page, '.preview .favorite')).replace(/\D/g, ''));
    if (after !== before + 1 && after !== before - 1) throw new Error(`count ${before} -> ${after}`);
  });
  await step('an article renders markdown and comments', async () => {
    await page.click('.preview-link');
    await page.waitForSelector('.article-page .markdown');
    await until(page, () => (document.querySelector('.markdown')?.innerHTML ?? '').includes('<'));
  });
  await step('posting a comment adds it', async () => {
    await page.waitForSelector('.comment-form textarea');
    await page.type('.comment-form textarea', 'A comment from the flow script');
    await page.click('.comment-form button');
    await until(page, () => [...document.querySelectorAll('.comment p')].some(node => node.textContent === 'A comment from the flow script'));
  });
  await step('publishing an article opens it', async () => {
    await page.click('a[href="/editor"]');
    await page.waitForSelector('.editor form');
    await page.type('input[name=title]', 'Flow script article');
    await page.type('input[name=description]', 'Written by a script');
    await page.type('textarea[name=body]', '# Hello\n\nFrom **the flow**.');
    await page.type('input[placeholder="Enter tags"]', 'flow');
    await page.keyboard.press('Enter');
    await until(page, () => document.querySelector('.tag-list.editable')?.textContent?.includes('flow') === true);
    await page.click('.editor form > button');
    await until(page, () => document.querySelector('.article-page h1')?.textContent === 'Flow script article');
  });
  await step('editing starts from the saved article', async () => {
    await page.click('.actions a.button');
    await until(page, () => (document.querySelector('input[name=title]') as HTMLInputElement | null)?.value === 'Flow script article');
  });
  await step('settings saves the bio', async () => {
    await page.click('a[href="/settings"]');
    await page.waitForSelector('.settings textarea');
    await page.$eval('.settings textarea', node => { (node as HTMLTextAreaElement).value = ''; });
    await page.type('.settings textarea', 'Updated by the flow');
    await page.click('.settings form button');
    await until(page, () => document.querySelector('.saved') !== null);
  });
  await step('the profile shows the new bio', async () => {
    await page.click('.navbar .me');
    await until(page, () => document.querySelector('.banner.user p')?.textContent === 'Updated by the flow');
  });
} finally {
  await browser.close().catch(() => {});
}
console.log(problems.length === 0 ? 'all flows passed' : `problems:\n${problems.join('\n')}`);
