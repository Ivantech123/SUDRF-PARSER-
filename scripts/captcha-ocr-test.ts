// Isolate the captcha solver: load the form, grab the captcha PNG, run
// ddddocr, and print what it recognized. Repeat 3 times to gauge accuracy.
import { chromium } from "playwright";
import { DdddocrSolver } from "../src/sudrf/captcha.js";

const browser = await chromium.launch({ headless: true });
const solver = new DdddocrSolver();
for (let i = 0; i < 3; i++) {
  const page = await browser.newPage();
  await page.goto("https://vs--mor.sudrf.ru/modules.php?name=sud_delo&srv_num=1&name_op=sf&nc=1&delo_id=5", { waitUntil: "domcontentloaded" });
  const b64 = await page.$$eval("img", els => {
    for (const e of els) {
      const src = e.getAttribute("src") ?? "";
      if (/^data:\s*image\/png;base64,/i.test(src)) return src.replace(/^data:\s*image\/png;base64,\s*/i, "").replace(/\s+/g, "");
    }
    return "";
  });
  try {
    const code = await solver.solve(b64);
    console.log(`attempt ${i + 1}: OCR="${code}" (len ${code.length})`);
  } catch (e: any) {
    console.log(`attempt ${i + 1}: ERR ${e.message}`);
  }
  await page.close();
}
await browser.close();
