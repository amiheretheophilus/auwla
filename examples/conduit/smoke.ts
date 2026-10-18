// Smoke check: load a page in headless Chrome and print what renders.
import puppeteer from 'puppeteer-core';
const url = process.argv[2] ?? 'http://127.0.0.1:5400/';
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
try {
  const page = await browser.newPage();
  page.on('pageerror', error => console.log('pageerror:', String((error as Error).stack ?? error).slice(0, 1500)));
  page.on('console', message => { if (message.type() === 'error' || message.type() === 'warn') console.log(`console.${message.type()}:`, message.text().slice(0, 400)); });
  page.on('request', request => { if (request.url().includes('_fn') || request.url().includes('_memoized')) console.log('request:', request.method(), new URL(request.url()).pathname + new URL(request.url()).search, (request.postData() ?? '').slice(0, 300)); });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await new Promise(resolve => setTimeout(resolve, 4000));
  console.log((await page.evaluate(() => document.body.innerText)).slice(0, 1500));
} finally { await browser.close().catch(() => {}); }
