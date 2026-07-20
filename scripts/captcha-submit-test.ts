// Verify the captcha submit actually clears the gate: solve, submit, then
// inspect the resulting page for (a) captcha still present = wrong code, or
// (b) a results table / "no cases" notice = gate passed.
import { chromium } from "playwright";
import { DdddocrSolver } from "../src/sudrf/captcha.js";

const browser = await chromium.launch({ headless: true });
const solver = new DdddocrSolver();
const url = "https://vs--mor.sudrf.ru/modules.php?name=sud_delo&srv_num=1&name_op=sf&nc=1&delo_id=5";

for (let attempt = 1; attempt <= 5; attempt++) {
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  const b64 = await page.$$eval("img", els => {
    for (const e of els) {
      const src = e.getAttribute("src") ?? "";
      if (/^data:\s*image\/png;base64,/i.test(src)) return src.replace(/^data:\s*image\/png;base64,\s*/i, "").replace(/\s+/g, "");
    }
    return "";
  });
  const code = await solver.solve(b64);
  await page.fill("input[name='captcha']", code);
  // broad filter so we'd see results if any exist
  await page.fill("input[name='g2_case__ENTRY_DATE1D']", "01.01.2024");
  await page.fill("input[name='g2_case__ENTRY_DATE2D']", "30.06.2026");
  await Promise.all([page.waitForLoadState("domcontentloaded"), page.click("input[name='Submit']")]);
  const html = await page.content();
  const stillCaptcha = /name=['"]captcha['"]/i.test(html);
  const hasResultsTable = /номер дела|уид|истец|ответчик/i.test(html);
  const noResults = /дел не найдено|ничего не найдено|по вашему запросу ничего/i.test(html);
  console.log(`attempt ${attempt}: code="${code}" captchaStillPresent=${stillCaptcha} resultsTable=${hasResultsTable} noResultsNotice=${noResults}`);
  if (!stillCaptcha) {
    console.log("  → GATE PASSED on attempt", attempt);
    // dump a snippet to see what the post-submit page looks like
    const snippet = await page.$$eval("table", ts => ts.map(t => t.innerText.slice(0, 200)).filter(t => /дело|истец|ответчик|найдено/i.test(t)).slice(0, 2));
    console.log("  table snippet:", JSON.stringify(snippet));
    await page.close();
    break;
  }
  await page.close();
}
await browser.close();
