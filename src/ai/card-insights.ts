import type { LawyerCard } from "../lawyers/aggregate.js";
import type { ParticipantDossier } from "../participants/aggregate.js";
import { chatCompletion, claudeHubConfigured, claudeHubModel } from "./claudehub.js";

export type CardAiKind = "lawyer" | "participant";
export type CardAiMode = "profile" | "hints" | "brief";

export interface CardAiResult {
  markdown: string;
  model: string;
  generatedAt: string;
  mode: CardAiMode;
  kind: CardAiKind;
}

const MODE_PROMPTS: Record<CardAiMode, string> = {
  profile: `Режим: РАЗБОР ПРОФИЛЯ.
Формат markdown:
## Краткий портрет
2–3 предложения.
## Что видно в цифрах
маркированный список 4–7 пунктов с конкретными числами из JSON.
## Оговорки
1–3 пункта про малую выборку / неизвестные исходы / неполные карточки, если уместно.`,

  hints: `Режим: НА ЧТО СМОТРЕТЬ.
Формат markdown:
## Риски данных
что может искажать картину.
## На что кликнуть дальше
2–5 конкретных шагов в интерфейсе (суды, категории, дела, карта, исходы).
## Красные флаги
если есть аномалии в цифрах — коротко; иначе напиши, что явных флагов нет.`,

  brief: `Режим: СПРАВКА.
Напиши связный текст 5–8 предложений на русском для заметки/отчёта.
Без заголовков ## — можно один абзац или два.
В конце одной строкой: «Это ориентир по каталогу дел, не юридическое заключение.»`,
};

const SYSTEM = `Ты аналитик судебного каталога (ГАС «Правосудие», выборка Мордовии и связанных судов).
Пиши по-русски. Не выдумывай цифры — только из JSON. Не обвиняй людей и не давай юридических заключений.
Не цитируй тексты актов: их нет во входе. Бренд помощника в ответах не упоминай.`;

function compactLawyer(card: LawyerCard): Record<string, unknown> {
  return {
    kind: "lawyer_card",
    name: card.name,
    primaryRole: card.primaryRole,
    roleLabel: card.roleLabel,
    roles: card.roles.slice(0, 8),
    rating: card.rating,
    tier: card.tier,
    mainCourt: card.mainCourt,
    region: card.region,
    stats: card.stats,
    topCourts: (card.courtHeat ?? []).slice(0, 8),
    topCategories: (card.categoryHeat ?? []).slice(0, 8),
    topRegions: (card.geoHeat ?? []).slice(0, 8),
    ratingFactors: (card.ratingFactors ?? []).slice(0, 8),
    judgePractice: card.judgePractice
      ? {
          medianDays: card.judgePractice.medianDays,
          p75Days: card.judgePractice.p75Days,
          withDuration: card.judgePractice.withDuration,
          plaintiffFavorRate: card.judgePractice.plaintiffFavorRate,
          appealChangeRate: card.judgePractice.appealChangeRate,
          bankFavorRate: card.judgePractice.bankFavorRate,
          bankCases: card.judgePractice.bankCases,
          appealReviewed: card.judgePractice.appealReviewed,
          knownOutcomes: card.judgePractice.knownOutcomes,
          outcomes: card.judgePractice.outcomes,
        }
      : null,
    recentCaseCount: card.recentCases.length,
    sampleCases: card.recentCases.slice(0, 6).map((c) => ({
      caseNumber: c.caseNumber,
      court: c.courtName,
      category: c.category,
      status: c.status,
    })),
  };
}

function compactParticipant(d: ParticipantDossier): Record<string, unknown> {
  return {
    kind: "participant_dossier",
    name: d.person.name,
    roleLabel: d.roleLabel,
    roles: d.person.roles.slice(0, 10),
    families: d.person.families,
    rating: d.rating,
    tier: d.tier,
    stats: d.stats,
    outcomes: d.outcomes,
    topCourts: d.byCourt.slice(0, 8),
    topCategories: d.byCategory.slice(0, 8),
    byYear: d.byYear.slice(0, 10),
    topRegions: (d.geoHeat ?? []).slice(0, 8),
    ratingFactors: (d.ratingFactors ?? []).slice(0, 8),
    caveat: d.caveat,
    sampleCases: d.cases.slice(0, 6).map((c) => ({
      caseNumber: c.caseNumber,
      court: c.courtName,
      category: c.category,
      status: c.status,
      role: c.roleOnCase,
    })),
  };
}

export async function generateCardInsight(opts: {
  kind: CardAiKind;
  mode: CardAiMode;
  lawyer?: LawyerCard;
  participant?: ParticipantDossier;
}): Promise<CardAiResult> {
  if (!claudeHubConfigured()) {
    throw new Error("A2chatski не настроен: задайте CLAUDEHUB_API_KEY в .env");
  }

  const payload =
    opts.kind === "lawyer" && opts.lawyer
      ? compactLawyer(opts.lawyer)
      : opts.kind === "participant" && opts.participant
        ? compactParticipant(opts.participant)
        : null;

  if (!payload) throw new Error("Нет данных карточки для разбора");

  const cases =
    opts.kind === "lawyer"
      ? opts.lawyer!.stats.cases
      : opts.participant!.stats.cases;
  if (cases < 1) throw new Error("Недостаточно данных в карточке");

  const markdown = await chatCompletion({
    system: SYSTEM,
    user:
      `${MODE_PROMPTS[opts.mode]}\n\nДанные карточки:\n\`\`\`json\n`
      + JSON.stringify(payload)
      + "\n```",
    maxTokens: opts.mode === "brief" ? 900 : 1600,
    temperature: opts.mode === "brief" ? 0.45 : 0.35,
  });

  return {
    markdown,
    model: claudeHubModel(),
    generatedAt: new Date().toISOString(),
    mode: opts.mode,
    kind: opts.kind,
  };
}
