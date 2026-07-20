/**
 * Open the search form on a court site and list available delo_id / select options.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { ResidentDdddocrSolver } from "../src/sudrf/captcha.js";
import { courtFetchUrl } from "../src/sudrf/http.js";

const court = process.env.PROBE_COURT || "leninsky--mor";
const outDir = "data/probes";
mkdirSync(outDir, { recursive: true });

const solver = new ResidentDdddocrSolver(process.env.PYTHON_BIN);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

try {
  const url = courtFetchUrl(court, "/modules.php?name=sud_delo&srv_num=1&name_op=sf", true);
  console.log("goto", url);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(1500);

  // If captcha present, solve once so the form is usable
  const captcha = await page.$("input[name='captcha']");
  if (captcha) {
    const img = await page.$("img[src*='captcha'], img#captcha, img[src^='data:image']");
    const src = img ? await img.getAttribute("src") : null;
    if (src?.includes("base64")) {
      const b64 = src.replace(/^data:\s*image\/png;base64,/i, "").replace(/\s+/g, "");
      const code = await solver.solve(b64);
      await page.fill("input[name='captcha']", code);
      console.log("captcha solved");
    }
  }

  const html = await page.content();
  writeFileSync(`${outDir}/${court}-form.html`, html, "utf8");

  // Collect select options and links mentioning delo_id
  const selects = await page.$$eval("select", (els) =>
    els.map((el) => ({
      name: el.getAttribute("name") || "",
      id: el.id || "",
      options: [...el.querySelectorAll("option")].map((o) => ({
        value: o.value,
        text: (o.textContent || "").replace(/\s+/g, " ").trim(),
      })),
    })),
  );

  const deloLinks = await page.$$eval("a[href*='delo_id']", (as) =>
    as.map((a) => ({
      href: a.getAttribute("href") || "",
      text: (a.textContent || "").replace(/\s+/g, " ").trim(),
    })),
  );

  const radioDelo = await page.$$eval("input[name*='delo'], input[value*='delo']", (els) =>
    els.map((el) => ({
      name: el.getAttribute("name"),
      value: el.getAttribute("value"),
      type: el.getAttribute("type"),
    })),
  );

  // Heuristic: any text near "граждан" with numbers
  const civilMentions = [...html.matchAll(/граждан[а-яё\s]{0,40}.{0,20}delo_id[=_](\d+)/gi)].map(
    (m) => m[0].replace(/\s+/g, " ").slice(0, 120),
  );
  const allDeloIds = [...html.matchAll(/delo_id[=_](\d+)/gi)].map((m) => m[1]!);
  const uniqDelo = [...new Set(allDeloIds)];

  const report = { court, selects, deloLinks: deloLinks.slice(0, 40), radioDelo, uniqDelo, civilMentions };
  writeFileSync(`${outDir}/${court}-form-options.json`, JSON.stringify(report, null, 2), "utf8");
  console.log("uniq delo_id in HTML:", uniqDelo);
  console.log("selects:", selects.map((s) => `${s.name||s.id}(${s.options.length})`).join(", "));
  for (const s of selects) {
    if (s.options.length && s.options.length < 30) {
      console.log(`\n[${s.name || s.id}]`);
      for (const o of s.options) console.log(`  ${o.value} | ${o.text.slice(0, 80)}`);
    }
  }
  if (deloLinks.length) {
    console.log("\ndelo links:");
    for (const l of deloLinks.slice(0, 20)) console.log(`  ${l.text.slice(0, 60)} → ${l.href.slice(0, 100)}`);
  }
} finally {
  await page.close();
  await browser.close();
  solver.close();
}
