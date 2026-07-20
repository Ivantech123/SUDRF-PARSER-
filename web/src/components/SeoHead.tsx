// Per-route document title + meta description for SPA hash routes.

import { useEffect } from "react";
import type { Route } from "./Router.js";

const SITE = "A2CHATSKY";
const DEFAULT_DESC =
  "Каталог судебных дел ГАС «Правосудие»: поиск по номеру и УИД, рейтинг юристов и судей, аналитика практики. Ранний доступ по заявке.";

const META: Partial<Record<Route, { title: string; description: string }>> = {
  "/": {
    title: `${SITE} — судебные дела и аналитика`,
    description: DEFAULT_DESC,
  },
  "/login": {
    title: `Войти · ${SITE}`,
    description: "Вход в кабинет A2CHATSKY по приглашению.",
  },
  "/register": {
    title: `Регистрация · ${SITE}`,
    description: "Регистрация в A2CHATSKY по инвайт-токену.",
  },
  "/coming-soon": {
    title: `Скоро · ${SITE}`,
    description: "Раздел A2CHATSKY готовится к открытию. Оставьте заявку на ранний доступ.",
  },
  "/privacy": {
    title: `Политика персональных данных · ${SITE}`,
    description:
      "Политика обработки персональных данных A2CHATSKY: заявки на доступ, цели, сроки, права субъекта.",
  },
  "/cases": {
    title: `Судебные дела · ${SITE}`,
    description: "Поиск судебных дел: номер, УИД, участник, судья. Карточка дела и акты.",
  },
  "/lawyers": {
    title: `Юристы и судьи · ${SITE}`,
    description: "Рейтинг юристов и судей по судебной практике, карточки и досье.",
  },
  "/analytics": {
    title: `Аналитика судебной практики · ${SITE}`,
    description: "Сводка по исходам, срокам и корпусу судей — методика и цифры.",
  },
  "/api-docs": {
    title: `API документация · ${SITE}`,
    description: "REST и MCP API A2CHATSKY для доступа к каталогу судебных дел.",
  },
  "/methodology": {
    title: `Методика · ${SITE}`,
    description: "Как A2CHATSKY считает показатели судебной практики.",
  },
};

function setMeta(name: string, content: string, attr: "name" | "property" = "name") {
  let el = document.head.querySelector(`meta[${attr}="${name}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, name);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

export default function SeoHead({ route }: { route: Route }) {
  useEffect(() => {
    const m = META[route] ?? { title: SITE, description: DEFAULT_DESC };
    document.title = m.title;
    setMeta("description", m.description);
    setMeta("og:title", m.title, "property");
    setMeta("og:description", m.description, "property");
    setMeta("twitter:title", m.title);
    setMeta("twitter:description", m.description);
  }, [route]);

  return null;
}
