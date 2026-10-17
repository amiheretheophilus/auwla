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
