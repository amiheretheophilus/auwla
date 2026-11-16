import { existsSync } from 'node:fs';

/**
 * A Chromium browser to test in: `MMD_CHROME_PATH`, Chrome, Chromium, or Edge (which every
 * Windows machine has, and the only one on some). Null when none is installed.
 */
export function browserExecutable(): string | null {
  const candidates = [
    process.env.MMD_CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  return candidates.find((candidate): candidate is string => candidate !== undefined && existsSync(candidate)) ?? null;
}

/**
 * Close a test browser. On Windows, Chrome can still hold its temporary
 * profile when Puppeteer deletes it; that cleanup lock is not a test failure.
 */
export async function closeBrowser(browser: { close(): Promise<void> }): Promise<void> {
  try { await browser.close(); }
  catch (error) {
    if ((error as { code?: string }).code !== 'EBUSY' || !String((error as { path?: string }).path).includes('puppeteer_dev_chrome_profile')) throw error;
  }
}
