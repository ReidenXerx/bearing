/**
 * Drive the page like a person, paced by the voice, and keep the timeline the mux needs.
 *
 *   const director = createDirector(page, narration);   // narration = narration.json, loaded
 *   await director.narrate('intro', async () => { await director.moveTo(page.getByRole('heading')); });
 *   await director.narrate('save', async () => { await director.clickOn(page.getByRole('button', { name: 'Save' })); });
 *   director.save('demo/timeline.json');
 *
 * Video time zero is when the PAGE was created, so create the director right after `newPage()` —
 * every step's offset is measured from there. Each step shows its caption, runs its actions, then
 * waits out the rest of its clip (plus a beat), so the next sentence never talks over the last.
 *
 * Locators: scope by role or attribute. A text-only locator collides — an "All" tab and an "All"
 * range button, and the click went to the tab.
 */
const fs = require('node:fs');
const { setCaption } = require('./chrome');

function createDirector(page, narration, { beat = 0.8 } = {}) {
  const t0 = Date.now();
  const byKey = new Map(narration.map((s) => [s.key, s]));
  const timeline = [];

  const moveTo = async (locator, { steps = 28 } = {}) => {
    await locator.scrollIntoViewIfNeeded().catch(() => {});
    const box = await locator.boundingBox();
    if (!box) throw new Error(`moveTo: nothing visible to move to (${locator})`);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps });
  };
  const clickOn = async (locator) => {
    await moveTo(locator);
    await page.mouse.down();
    await page.mouse.up();
  };
  const typeSlowly = async (locator, text, { delay = 100 } = {}) => {
    await clickOn(locator);
    await page.keyboard.type(text, { delay });
  };

  const narrate = async (key, actions = async () => {}) => {
    const step = byKey.get(key);
    if (!step) throw new Error(`narrate: no step "${key}" in the narration`);
    const started = Date.now();
    timeline.push({ key, ms: started - t0, audio: step.audio, seconds: step.seconds });
    await setCaption(page, step.text);
    await actions();
    const remaining = step.seconds + beat - (Date.now() - started) / 1000;
    if (remaining > 0) await page.waitForTimeout(remaining * 1000); // pacing to a measured clip, not a guess at latency
  };

  const save = (file) => {
    const missing = narration.filter((s) => !timeline.some((t) => t.key === s.key)).map((s) => s.key);
    fs.writeFileSync(file, JSON.stringify({ steps: timeline, missing }, null, 2));
    if (missing.length) console.log(`  ⚠ narrated steps never shown: ${missing.join(', ')}`);
    return file;
  };

  return { moveTo, clickOn, typeSlowly, narrate, save, timeline };
}

module.exports = { createDirector };
