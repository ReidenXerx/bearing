import { ready } from "./draw.js";
export async function diptych(key, { hl = [] } = {}) {
  const d = (await (await fetch("data/rules.json")).json())[key];
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const fmt = (src) => esc(src).split("\n").map((l) => {
    if (/^\s*…/.test(l)) return `<span class="el">${l}</span>`;
    let x = document.body.classList.contains("prose")
      ? l.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`([^`]+)`/g, '<code>$1</code>')
      : l.replace(/(\/\/.*)$/, '<span class="cm">$1</span>');
    for (const h of hl) x = x.split(esc(h)).join(`<span class="hl">${esc(h)}</span>`);
    return x;
  }).join("\n");
  document.querySelector(".off pre").innerHTML = fmt(d.off);
  document.querySelector(".on pre").innerHTML = fmt(d.on);
  document.querySelector(".off .res").textContent = "→ " + d.offRes;
  document.querySelector(".on .res").textContent = "→ " + d.onRes;
  const dots = (a) => a.map((p) => `<i class="dot ${p ? "p" : "f"}"></i>`).join("");
  if (d.strip) {
    document.querySelector(".trials").innerHTML = d.strip;
    await ready("700 56px Geist", "600 21px JBM", "500 16px JBM", "400 25px Geist", "500 17.5px JBM");
    return;
  }
  if (d.arms) {
    const ARM = [["off", "no rules"], ["placebo", "other rules"], ["only", "this rule"], ["on", "all three"]];
    document.querySelector(".trials").innerHTML = Object.entries(d.arms).map(([m, a]) =>
      `<span class="arm"><b>${m}</b>${ARM.map(([k, l]) => `<em class="${k === "only" ? "key" : ""}">${l}</em>${dots(a[k])}`).join("")}</span>`).join("");
    await ready("700 56px Geist", "600 21px JBM", "500 16px JBM", "400 25px Geist", "500 17.5px JBM");
    return;
  }
  document.querySelector(".trials").innerHTML = Object.entries(d.trials).map(([m, t]) => `<span><b>${m}</b>${dots(t.off)} → ${dots(t.on)}</span>`).join("") +
    `<span style="margin-left:auto"><i class="dot p"></i>right <i class="dot f" style="margin-left:16px"></i>wrong · ${Object.values(d.trials)[0].off.length} runs each, without → with</span>`;
  await ready("700 56px Geist", "600 21px JBM", "500 16px JBM", "400 25px Geist", "500 17.5px JBM");
}
