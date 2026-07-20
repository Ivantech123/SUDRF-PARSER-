import { CaseCatalog } from "../src/cases/store.js";
import { buildDeepAnalytics, parseMoneyRu, parseRuDate } from "../src/analytics/deep-analytics.js";
import { buildMordoviaDashboard } from "../src/analytics/mordovia-dashboard.js";

console.assert(parseRuDate("15.03.2024")?.getFullYear() === 2024);
console.assert(parseMoneyRu("12 345,50") === 12345.5);
console.assert(parseMoneyRu("1.234.567,89") === 1234567.89);

const catalog = new CaseCatalog();
catalog.load("./cases-store.json");
const dash = buildMordoviaDashboard(catalog);
const d = dash.deep;
console.log(
  JSON.stringify(
    {
      catalog: dash.totals.catalog,
      judges: d.judges.length,
      lifecycleMedian: d.lifecycle.medianDays,
      lifecycleN: d.lifecycle.sampleSize,
      amountPairs: d.amounts.casesWithBoth,
      serial: d.serialPlaintiffs.length,
      stuck: d.stuckUnknown.length,
      practiceMonths: d.practiceShift.length,
      seasonPeak: [...d.seasonality].sort((a, b) => b.total - a.total)[0],
    },
    null,
    2,
  ),
);
