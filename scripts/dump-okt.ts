import { chromium } from "playwright";
import { DdddocrSolver } from "../src/sudrf/captcha.js";
import { writeFileSync } from "node:fs";
const browser = await chromium.launch({ headless: true });
const solver = new DdddocrSolver();
const url = "https://oktyabrsky--mor.sudrf.ru/modules.php?name=sud_delo&srv_num=1&name_op=sf&nc=1&delo_id=5";
const page = await browser.newPage();
await page.goto(url, { waitUntil: "domcontentloaded" });
const b64 = await page.$$eval("img", els => {
  for (const e of els) { const src = e.getAttribute("src") ?? "";
    if (/^data:\s*image\/png;base64,/i.test(src)) return src.replace(/^data:\s*image\/png;base64,\s*/i,"").replace(/\s+/g,""); }
  return "";
});
const code = await solver.solve(b64);
await page.fill("input[name='captcha']", code);
await page.fill("input[name='g2_case__ENTRY_DATE1D']", "01.01.2024");
await page.fill("input[name='g2_case__ENTRY_DATE2D']", "30.06.2026");
await Promise.all([page.waitForLoadState("domcontentloaded"), page.click("input[name='Submit']")]);
await page.waitForTimeout(2000);
console.log("final URL:", page.url().slice(0, 120));
const contentText = await page.$eval("#content", el => (el as HTMLElement).innerText.slice(0, 800)).catch(() => "no #content");
console.log("--- #content ---\n", contentText);
writeFileSync("scripts/okt-postsubmit.html", await page.content());
await browser.close();
