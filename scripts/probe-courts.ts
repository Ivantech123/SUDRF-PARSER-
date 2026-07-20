// Probe candidate sudrf.ru court subdomains: keep only those that respond
// with a real page (not 404 / DNS failure / antibot challenge).
// Run: npx tsx scripts/probe-courts.ts
import { fetchSudrf } from "../src/sudrf/http.js";

const CANDIDATES: { subdomain: string; name: string; region: string; type: string }[] = [
  // Верховные суды республик
  { subdomain: "vs--tatarstan", name: "Верховный Суд Республики Татарстан", region: "Республика Татарстан", type: "vs" },
  { subdomain: "vs--bashkortostan", name: "Верховный Суд Республики Башкортостан", region: "Республика Башкортостан", type: "vs" },
  { subdomain: "vs--udmurtia", name: "Верховный Суд Удмуртской Республики", region: "Удмуртская Республика", type: "vs" },
  { subdomain: "vs--chel", name: "Верховный Суд Челябинской области", region: "Челябинская область", type: "vs" },
  { subdomain: "vs--sverdlovsk", name: "Верховный Суд Свердловской области", region: "Свердловская область", type: "vs" },
  { subdomain: "vs--perm", name: "Верховный Суд Пермского края", region: "Пермский край", type: "vs" },
  { subdomain: "vs--krasnodar", name: "Верховный Суд Краснодарского края", region: "Краснодарский край", type: "vs" },
  { subdomain: "vs--stavropol", name: "Верховный Суд Ставропольского края", region: "Ставропольский край", type: "vs" },
  { subdomain: "vs--rostov", name: "Верховный Суд Ростовской области", region: "Ростовская область", type: "vs" },
  { subdomain: "vs--nnov", name: "Верховный Суд Нижегородской области", region: "Нижегородская область", type: "vs" },
  { subdomain: "vs--samara", name: "Верховный Суд Самарской области", region: "Самарская область", type: "vs" },
  { subdomain: "vs--vladimir", name: "Верховный Суд Владимирской области", region: "Владимирская область", type: "vs" },
  { subdomain: "vs--ryazan", name: "Верховный Суд Рязанской области", region: "Рязанская область", type: "vs" },
  { subdomain: "vs--tula", name: "Верховный Суд Тульской области", region: "Тульская область", type: "vs" },
  { subdomain: "vs--lipetsk", name: "Верховный Суд Липецкой области", region: "Липецкая область", type: "vs" },
  { subdomain: "vs--tambov", name: "Верховный Суд Тамбовской области", region: "Тамбовская область", type: "vs" },
  { subdomain: "vs--penza", name: "Верховный Суд Пензенской области", region: "Пензенская область", type: "vs" },
  { subdomain: "vs--saransk", name: "Верховный Суд Республики Мордовия", region: "Республика Мордовия", type: "vs" },
  // Областные/краевые
  { subdomain: "oblsud--kln", name: "Калининградский областной суд", region: "Калининградская область", type: "oblsud" },
  { subdomain: "oblsud--tver", name: "Тверской областной суд", region: "Тверская область", type: "oblsud" },
  { subdomain: "oblsud--yar", name: "Ярославский областной суд", region: "Ярославская область", type: "oblsud" },
  { subdomain: "oblsud--ivanovo", name: "Ивановский областной суд", region: "Ивановская область", type: "oblsud" },
  { subdomain: "oblsud--kostroma", name: "Костромской областной суд", region: "Костромская область", type: "oblsud" },
  { subdomain: "oblsud--kursk", name: "Курский областной суд", region: "Курская область", type: "oblsud" },
  { subdomain: "oblsud--orel", name: "Орловский областной суд", region: "Орловская область", type: "oblsud" },
  { subdomain: "oblsud--belgorod", name: "Белгородский областной суд", region: "Белгородская область", type: "oblsud" },
  { subdomain: "oblsud--voronezh", name: "Воронежский областной суд", region: "Воронежская область", type: "oblsud" },
  { subdomain: "oblsud--smolensk", name: "Смоленский областной суд", region: "Смоленская область", type: "oblsud" },
  { subdomain: "oblsud--bryansk", name: "Брянский областной суд", region: "Брянская область", type: "oblsud" },
  { subdomain: "oblsud--kaluga", name: "Калужский областной суд", region: "Калужская область", type: "oblsud" },
  { subdomain: "oblsud--vlg", name: "Вологодский областной суд", region: "Вологодская область", type: "oblsud" },
  { subdomain: "oblsud--arkhangelsk", name: "Архангельский областной суд", region: "Архангельская область", type: "oblsud" },
  { subdomain: "oblsud--murmansk", name: "Мурманский областной суд", region: "Мурманская область", type: "oblsud" },
  { subdomain: "oblsud--pskov", name: "Псковский областной суд", region: "Псковская область", type: "oblsud" },
  { subdomain: "oblsud--novgorod", name: "Новгородский областной суд", region: "Новгородская область", type: "oblsud" },
  { subdomain: "oblsud--astrakhan", name: "Астраханский областной суд", region: "Астраханская область", type: "oblsud" },
  { subdomain: "oblsud--volgograd", name: "Волгоградский областной суд", region: "Волгоградская область", type: "oblsud" },
  { subdomain: "oblsud--krasnodar", name: "Краснодарский краевой суд", region: "Краснодарский край", type: "oblsud" },
  { subdomain: "oblsud--stavropol", name: "Ставропольский краевой суд", region: "Ставропольский край", type: "oblsud" },
  { subdomain: "oblsud--perm", name: "Пермский краевой суд", region: "Пермский край", type: "oblsud" },
  { subdomain: "oblsud--nnov", name: "Нижегородский областной суд", region: "Нижегородская область", type: "oblsud" },
  { subdomain: "oblsud--kirov", name: "Кировский областной суд", region: "Кировская область", type: "oblsud" },
  { subdomain: "oblsud--saratov", name: "Саратовский областной суд", region: "Саратовская область", type: "oblsud" },
  { subdomain: "oblsud--ulyanovsk", name: "Ульяновский областной суд", region: "Ульяновская область", type: "oblsud" },
  { subdomain: "oblsud--orenburg", name: "Оренбургский областной суд", region: "Оренбургская область", type: "oblsud" },
  { subdomain: "oblsud--kurgan", name: "Курганский областной суд", region: "Курганская область", type: "oblsud" },
  { subdomain: "oblsud--tyumen", name: "Тюменский областной суд", region: "Тюменская область", type: "oblsud" },
  { subdomain: "oblsud--chel", name: "Челябинский областной суд", region: "Челябинская область", type: "oblsud" },
  { subdomain: "oblsud--irkutsk", name: "Иркутский областной суд", region: "Иркутская область", type: "oblsud" },
  { subdomain: "oblsud--kemerovo", name: "Кемеровский областной суд", region: "Кемеровская область", type: "oblsud" },
  { subdomain: "oblsud--tomsk", name: "Томский областной суд", region: "Томская область", type: "oblsud" },
  { subdomain: "oblsud--omsk", name: "Омский областной суд", region: "Омская область", type: "oblsud" },
  { subdomain: "oblsud--novosibirsk", name: "Новосибирский областной суд", region: "Новосибирская область", type: "oblsud" },
  { subdomain: "oblsud--altai", name: "Алтайский краевой суд", region: "Алтайский край", type: "oblsud" },
  { subdomain: "oblsud--khabarovsk", name: "Хабаровский краевой суд", region: "Хабаровский край", type: "oblsud" },
  { subdomain: "oblsud--prim", name: "Приморский краевой суд", region: "Приморский край", type: "oblsud" },
  { subdomain: "oblsud--amur", name: "Амурский областной суд", region: "Амурская область", type: "oblsud" },
  { subdomain: "oblsud--saha", name: "Верховный Суд Республики Саха (Якутия)", region: "Республика Саха (Якутия)", type: "oblsud" },
];

const ok: typeof CANDIDATES = [];
const bad: string[] = [];

await Promise.all(CANDIDATES.map(async (c) => {
  try {
    const res = await fetchSudrf({ subdomain: c.subdomain, path: "/", timeoutMs: 15000 });
    // a real court page: 200 and contains "sudrf" or cyrillic court markers, not a 404 stub
    const looksReal = res.status === 200 && /суд|sudrf|modules\.php/i.test(res.html);
    if (looksReal) {
      ok.push(c);
      console.log("OK  ", c.subdomain, "—", c.name);
    } else {
      bad.push(c.subdomain);
      console.log("BAD ", c.subdomain, "(status", res.status, ", len", res.html.length, ")");
    }
  } catch (e) {
    bad.push(c.subdomain);
    console.log("ERR ", c.subdomain, "—", (e as Error).message.slice(0, 80));
  }
}));

console.log("\n=== OK:", ok.length, "| BAD:", bad.length, "===");
console.log("bad:", bad.join(", "));
