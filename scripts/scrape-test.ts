// Verify the Playwright scraper loads the search form and extracts the
// captcha challenge (captchaid + base64 PNG). We don't solve it here — that
// needs ddddocr/2captcha — we just prove the browser path works end-to-end
// up to the captcha gate.
import { chromium } from "playwright";

const subdomain = "vs--mor";
const deloId = 5; // civil
const url = `https://${subdomain}.sudrf.ru/modules.php?name=sud_delo&srv_num=1&name_op=sf&nc=1&delo_id=${deloId}`;

const browser = await chromium.launch({ headless: true, args: ["--disable-blink-features=AutomationControlled"] });
const page = await browser.newPage();
await page.goto(url, { waitUntil: "domcontentloaded" });

const captchaid = await page.$eval("input[name='captchaid']", el => (el as HTMLInputElement).value).catch(() => null);
const imgSrc = await page.$eval("img[src^='data:image/png;base64,']", el => (el as HTMLImageElement).getAttribute("src") ?? "").catch(() => "");

console.log("captchaid:", captchaid);
console.log("captcha image bytes (base64 length):", imgSrc.length);
console.log("captcha image prefix:", imgSrc.slice(0, 60));

// confirm the case-number field exists on this form
const hasCaseNum = await page.$("input[name='g2_case__CASE_NUMBERSS']") !== null;
console.log("has case-number field (g2_case__CASE_NUMBERSS):", hasCaseNum);

await browser.close();
