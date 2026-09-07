// Every line here was a FALSE POSITIVE in a real version of this tool. Nothing may fire.
const { createReport } = require('../../core/report');

const run = async (page) => {
  const report = createReport('traps');
  // Never write report.check('anything', true, 'x') — that is a vacuous assertion.
  /* Nor a page.evaluate containing document.querySelector('.x:has-text("y")'). */
  const glob = '/*.js';                       // a string that opens a fake comment
  const paren = /\(/.source;                  // a regex literal with an unbalanced paren
  await page.check('#terms', { timeout: 5000 });   // Playwright's check(), not the report's
  // `:has()` is standard CSS, not Playwright syntax:
  const n = await page.evaluate(() => document.querySelectorAll('tr:has(input:checked)').length);
  report.check('rows are selected', n > 0, `${n} of them, glob ${glob}, paren ${paren}`);
  return report?.finish?.();                  // reached through optional chaining
};
