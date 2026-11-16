// Every card ends with this: fonts and images first, THEN say it is finished.
await Promise.all([document.fonts.load('700 50px Geist'), document.fonts.load('600 20px JBM'), document.fonts.load('400 30px Geist')]);
await Promise.all([...document.images].map((i) => i.decode()));
// The render's size is the card's: the generator reads it back and fails on overflow.
window.__size = { w: document.body.scrollWidth, h: document.body.scrollHeight };
window.__ready = true;
