/**
 * "Demo chrome": what a headless recording does not have, drawn into the page.
 *
 *   await installDemoChrome(context, { badge: 'Sample data' });
 *   await setCaption(page, 'This is the new page.');
 *
 * A headless video has NO cursor and NO native tooltips — the viewer sees buttons react to nothing.
 * So an init script draws a cursor that follows the mouse (and shrinks on press), a caption bar, a
 * badge that stays on screen the whole video, and a tooltip for the hovered element's `title`.
 *
 * The badge is not decoration. A demo shown to someone outside the team is a claim about the product;
 * if its data is sample data, the screen says so for the entire video, not in a closing sentence.
 */
async function installDemoChrome(context, { badge = 'Sample data' } = {}) {
  await context.addInitScript((badgeText) => {
    const install = () => {
      if (window.__demoInstalled) return;
      window.__demoInstalled = true;
      const css = document.createElement('style');
      css.textContent = `
        #__demo_cursor{position:fixed;z-index:2147483647;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;
          background:rgba(255,190,40,.55);border:2px solid #fff;box-shadow:0 0 8px rgba(0,0,0,.5);pointer-events:none;
          transition:transform .08s;left:-100px;top:-100px}
        #__demo_cursor.down{transform:scale(.6)}
        #__demo_caption{position:fixed;z-index:2147483646;left:50%;bottom:28px;transform:translateX(-50%);max-width:80%;
          padding:12px 20px;border-radius:10px;background:rgba(15,15,20,.86);color:#fff;font:600 22px/1.35 system-ui,sans-serif;
          text-align:center;pointer-events:none;display:none}
        #__demo_badge{position:fixed;z-index:2147483646;top:14px;right:14px;padding:6px 12px;border-radius:999px;
          background:#b45309;color:#fff;font:700 14px system-ui,sans-serif;letter-spacing:.04em;pointer-events:none}
        #__demo_tip{position:fixed;z-index:2147483646;padding:6px 10px;border-radius:6px;background:#111;color:#fff;
          font:14px system-ui,sans-serif;pointer-events:none;display:none;max-width:320px}`;
      document.head.appendChild(css);
      const el = (id, text) => {
        const d = document.createElement('div');
        d.id = id;
        if (text) d.textContent = text;
        document.body.appendChild(d);
        return d;
      };
      const cursor = el('__demo_cursor');
      const caption = el('__demo_caption');
      const tip = el('__demo_tip');
      if (badgeText) el('__demo_badge', badgeText);
      window.addEventListener('mousemove', (e) => {
        cursor.style.left = `${e.clientX}px`;
        cursor.style.top = `${e.clientY}px`;
        const t = e.target && e.target.closest && e.target.closest('[title]');
        if (t && t.getAttribute('title')) {
          tip.textContent = t.getAttribute('title');
          tip.style.left = `${e.clientX + 16}px`;
          tip.style.top = `${e.clientY + 18}px`;
          tip.style.display = 'block';
        } else tip.style.display = 'none';
      }, true);
      window.addEventListener('mousedown', () => cursor.classList.add('down'), true);
      window.addEventListener('mouseup', () => cursor.classList.remove('down'), true);
      window.__demoCaption = (text) => {
        caption.textContent = text || '';
        caption.style.display = text ? 'block' : 'none';
      };
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
    else install();
  }, badge);
}

async function setCaption(page, text) {
  await page.evaluate((t) => window.__demoCaption && window.__demoCaption(t), text);
}

module.exports = { installDemoChrome, setCaption };
