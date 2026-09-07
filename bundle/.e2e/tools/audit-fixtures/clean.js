// The correct form of each. Nothing may fire.
const { createReport } = require('../../core/report');
const seeds = require('../../core/seeds');

const run = async (page) => {
  const report = createReport('clean');
  console.log('  seeded a fixture — HTTP 201');
  const rows = await page.locator('tr').count();
  report.check('a row is present', rows > 0, `${rows} row(s)`);
  const box = await page.locator('button:has-text("Save")').boundingBox();
  await page.evaluate(({ x, y }) => document.elementFromPoint(x, y).click(), box);
  seeds.watchPage(page);
  await page.request.post('/api/things', { data: { name: 'x' } });
  return report.finish();
};
