// The ignore comment must work on the line above and on the line itself. Nothing may fire.
const { createReport } = require('../../core/report');

const run = async () => {
  const report = createReport('suppressed');
  // audit-checks: ignore vacuous-assertion
  report.check('a deliberate placeholder', true, 'documented above');
  report.check('another one', true, 'x'); // audit-checks: ignore vacuous-assertion
  report.check('a real one', 1 + 1 === 2, '2');
  return report.finish();
};
