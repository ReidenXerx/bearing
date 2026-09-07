// Every rule must fire here. Referenced by lib/kit.test.mjs.
const { createReport } = require('../../core/report');

const run = async (page) => {
  const report = createReport('dirty');
  report.check('seeded a fixture', true, 'HTTP 201');          // vacuous-assertion
  report.check('a row is present', rows > 0);                   // undebuggable-assertion
  const SAVE = 'button:has-text("Save")';                       // playwright-syntax-in-evaluate
  await page.evaluate((s) => document.querySelectorAll(s).length, SAVE);
  await page.request.post('/api/things', { data: { name: 'x' } }); // fixtures-without-a-ledger
};                                                              // report-never-finished
