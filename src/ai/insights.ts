import type { MordoviaDashboard } from "../analytics/mordovia-dashboard.js";
import { chatCompletion, claudeHubConfigured, claudeHubModel } from "./claudehub.js";

export interface AiInsightResult {
  markdown: string;
  model: string;
  generatedAt: string;
}

function compactDashboard(d: MordoviaDashboard): Record<string, unknown> {
  return {
    region: d.regionLabel,
    generatedAt: d.generatedAt,
    totals: d.totals,
    outcomesFi: d.outcomes.firstInstance,
    depersFi: {
      identifiableRate: d.depersonalization.firstInstance.identifiableRate,
      goNoGo: d.depersonalization.firstInstance.goNoGo,
      withRepresentativeSignal: d.depersonalization.firstInstance.withRepresentativeSignal,
      identifiable: d.depersonalization.firstInstance.identifiable,
    },
    lifecycle: d.deep.lifecycle,
    amounts: {
      medianClaim: d.deep.amounts.medianClaim,
      medianAward: d.deep.amounts.medianAward,
      medianConversion: d.deep.amounts.medianConversion,
      casesWithBoth: d.deep.amounts.casesWithBoth,
    },
    seasonalityTop: [...d.deep.seasonality]
      .sort((a, b) => b.total - a.total)
      .slice(0, 4),
    slowJudges: d.deep.judges
      .filter((j) => j.medianDays != null && j.withDuration >= 3)
      .sort((a, b) => (b.medianDays ?? 0) - (a.medianDays ?? 0))
      .slice(0, 8)
      .map((j) => ({
        name: j.name,
        medianDays: j.medianDays,
        appealChangeRate: j.appealChangeRate,
        bankFavorRate: j.bankFavorRate,
        cases: j.cases,
      })),
    overturnJudges: d.deep.judges
      .filter((j) => j.appealReviewed >= 3)
      .sort((a, b) => (b.appealChangeRate ?? 0) - (a.appealChangeRate ?? 0))
      .slice(0, 6)
      .map((j) => ({
        name: j.name,
        appealChangeRate: j.appealChangeRate,
        appealChanged: j.appealChanged,
        appealReviewed: j.appealReviewed,
      })),
    serialPlaintiffs: d.deep.serialPlaintiffs.slice(0, 8).map((p) => ({
      name: p.name,
      kind: p.kind,
      cases: p.cases,
      winRate: p.winRate,
    })),
    stuckUnknown: d.deep.stuckUnknown.length,
    participants: d.participants,
    repHeat: d.repHeatmaps
      ? {
          appearances: d.repHeatmaps.totals.appearances,
          uniquePeople: d.repHeatmaps.totals.uniquePeople,
          bySubtype: d.repHeatmaps.totals.bySubtype,
          topCourts: d.repHeatmaps.byCourt.slice(0, 8).map((c) => ({
            subdomain: c.subdomain,
            appearances: c.appearances,
            uniquePeople: c.uniquePeople,
          })),
        }
      : null,
    topCourts: d.courtHeatmap.slice(0, 8).map((c) => ({
      subdomain: c.subdomain,
      total: c.total,
      enriched: c.enriched,
      withActText: c.withActText,
    })),
    winrateLeaders: d.winrate.leaders.slice(0, 8).map((r) => ({
      name: r.name,
      cases: r.cases,
      winRate: r.winRate,
      wins: r.wins,
      losses: r.losses,
    })),
    notes: d.deep.notes,
  };
}

const SYSTEM = `Ты аналитик судебных данных по каталогу дел судов Республики Мордовия (ГАС «Правосудие»).
Пиши по-русски, коротко и по делу. Не выдумывай цифры — опирайся только на JSON.
Не давай юридических заключений и не обвиняй судей/адвокатов. Это ориентиры по выборке каталога.
Формат ответа — markdown:
## Краткий вывод
2–4 предложения.
## Что бросается в глаза
маркированный список 4–7 пунктов с цифрами.
## Риски и пробелы данных
что может искажать картину (малые выборки, неизвестные исходы, обезличивание).
## Что проверить дальше
2–4 конкретных следующих шага в интерфейсе аналитики.`;

export async function generateMordoviaInsights(
  dashboard: MordoviaDashboard,
): Promise<AiInsightResult> {
  if (!claudeHubConfigured()) {
    throw new Error("A2chatski не настроен: задайте CLAUDEHUB_API_KEY в .env");
  }

  const payload = compactDashboard(dashboard);
  const markdown = await chatCompletion({
    system: SYSTEM,
    user:
      "Сделай инсайты по этой сводке аналитики Мордовии:\n\n```json\n"
      + JSON.stringify(payload)
      + "\n```",
    maxTokens: 2000,
    temperature: 0.35,
  });

  return {
    markdown,
    model: claudeHubModel(),
    generatedAt: new Date().toISOString(),
  };
}
