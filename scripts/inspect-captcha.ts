// Inspect all <img> srcs on the captcha form to find the real captcha image.
import { chromium } from "playwright";

const url = "https://vs--mor.sudrf.ru/modules.php?name=sud_delo&srv_num=1&name_op=sf&nc=1&delo_id=5";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto(url, { waitUntil: "domcontentloaded" });

const imgs = await page.$$eval("img", els => els.map(e => ({
  src: e.getAttribute("src") ?? "",
  alt: e.getAttribute("alt") ?? "",
  cls: e.getAttribute("class") ?? "",
  w: e.getAttribute("width") ?? "",
})));
for (const i of imgs) {
  if (i.src.length > 80 || /captcha|data:image/i.test(i.src)) {
    console.log("SRC:", i.src.slice(0, 120), "| alt:", i.alt, "| class:", i.cls, "| w:", i.w);
  }
}
// also dump the captcha input's surrounding HTML
const ctx = await page.$eval("input[name='captcha']", el => el.parentElement?.parentElement?.innerHTML?.slice(0, 800) ?? "").catch(() => "");
console.log("\n--- captcha cell context ---\n", ctx);

await browser.close();
