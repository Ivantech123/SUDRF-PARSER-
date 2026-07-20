import { useMemo, useState, type ReactNode } from "react";
import type { CourtFacet, CategoryFacet } from "../lib/api.js";
import {
  groupCategories,
  groupCourtsByRegion,
  DISPLAY_REGION,
  PARTICIPANT_ROLE_OPTIONS,
  type CaseSearchFilters,
  countActiveFilters,
  hasActiveFilters,
} from "../lib/case-filters.js";
import HearingCalendar from "./HearingCalendar.js";

type FilterTab = "search" | "date" | "court" | "more";

interface Props {
  filters: CaseSearchFilters;
  onChange: (patch: Partial<CaseSearchFilters>) => void;
  onReset: () => void;
  courts: CourtFacet[];
  categories: CategoryFacet[];
  loading: boolean;
  onRefresh: () => void;
  /** Compact layout inside mobile modal (no outer chrome). */
  embedded?: boolean;
}

const fieldClass =
  "w-full min-w-0 border border-white/15 bg-black px-3 py-2.5 font-mono text-[13px] text-white outline-none focus:border-white/60 placeholder:text-white/25";
const sectionTitle = "font-mono text-[10px] uppercase tracking-[0.2em] text-white/35";
const labelClass = "mb-1.5 block font-mono text-[9px] uppercase tracking-[0.15em] text-white/40";

function ToggleChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`border px-3 py-1.5 font-mono text-[10px] transition ${
        active
          ? "border-white bg-white text-black"
          : "border-white/15 text-white/55 hover:border-white/40 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

function FilterTabBtn({
  id,
  active,
  onClick,
  children,
  badge,
}: {
  id: FilterTab;
  active: boolean;
  onClick: (id: FilterTab) => void;
  children: string;
  badge?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onClick(id)}
      className={`shrink-0 border px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] transition ${
        active
          ? "border-amber-400/60 bg-amber-400/10 text-amber-200"
          : "border-white/15 text-white/50 hover:border-white/35 hover:text-white"
      }`}
    >
      {children}
      {badge ? <span className="ml-1.5 text-amber-300">•</span> : null}
    </button>
  );
}

export default function CaseFiltersPanel({
  filters,
  onChange,
  onReset,
  courts,
  categories,
  loading,
  onRefresh,
  embedded = false,
}: Props) {
  const [tab, setTab] = useState<FilterTab>("search");
  const [categorySearch, setCategorySearch] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const categoryGroups = useMemo(() => groupCategories(categories), [categories]);
  const courtGroups = useMemo(() => groupCourtsByRegion(courts), [courts]);
  const activeCount = countActiveFilters(filters);
  const active = hasActiveFilters(filters);

  const searchLower = categorySearch.trim().toLowerCase();
  const filteredGroups = useMemo(() => {
    if (!searchLower) return categoryGroups;
    return categoryGroups
      .map((g) => ({
        ...g,
        items: g.items.filter((c) => c.name.toLowerCase().includes(searchLower)),
      }))
      .filter((g) => g.items.length > 0)
      .map((g) => ({ ...g, total: g.items.reduce((s, c) => s + c.count, 0) }));
  }, [categoryGroups, searchLower]);

  const toggleGroupExpand = (id: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectCategory = (name: string) => {
    onChange({ category: name, categoryGroup: "all" });
  };

  const selectCategoryGroup = (groupId: string) => {
    onChange({ categoryGroup: groupId, category: "all" });
  };

  const clearCategoryFilters = () => {
    onChange({ category: "all", categoryGroup: "all" });
    setCategorySearch("");
  };

  const dateActive = Boolean(filters.hearingFrom || filters.hearingTo);
  const courtActive = filters.court !== "all"
    || filters.category !== "all"
    || filters.categoryGroup !== "all";
  const moreActive = filters.onlyWithDocuments || filters.onlyEnriched;

  return (
    <section className={embedded ? "" : "mt-8 border border-white/10"}>
      {!embedded ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
          <div>
            <p className={sectionTitle}>Поиск и фильтры</p>
            {activeCount > 0 && (
              <p className="mt-1 font-mono text-[10px] text-white/45">
                активно: {activeCount}
              </p>
            )}
          </div>
          <div className="tab-scroll pb-1">
            {active && (
              <button
                type="button"
                onClick={onReset}
                className="border border-white/20 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-white/50 hover:border-white hover:text-white"
              >
                Сбросить
              </button>
            )}
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              className="border border-white/30 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-white/70 hover:border-white disabled:opacity-30"
            >
              Обновить
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
          {activeCount > 0 ? (
            <p className="font-mono text-[10px] text-white/45">активно: {activeCount}</p>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            {active ? (
              <button
                type="button"
                onClick={onReset}
                className="border border-white/20 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-white/50"
              >
                Сбросить
              </button>
            ) : null}
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              className="border border-white/30 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-white/70 disabled:opacity-30"
            >
              Обновить
            </button>
          </div>
        </div>
      )}

      <div className={`tab-scroll border-b border-white/10 ${embedded ? "px-4 py-2.5" : "px-5 py-3"}`}>
        <FilterTabBtn id="search" active={tab === "search"} onClick={setTab}>Поиск</FilterTabBtn>
        <FilterTabBtn id="date" active={tab === "date"} onClick={setTab} badge={dateActive}>Дата</FilterTabBtn>
        <FilterTabBtn id="court" active={tab === "court"} onClick={setTab} badge={courtActive}>Суд</FilterTabBtn>
        <FilterTabBtn id="more" active={tab === "more"} onClick={setTab} badge={moreActive}>Ещё</FilterTabBtn>
      </div>

      <div className={embedded ? "p-4" : "p-5"}>
        {tab === "search" && (
          <div className="grid max-w-4xl gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="f-case-number" className={labelClass}>Номер дела</label>
              <input
                id="f-case-number"
                type="search"
                value={filters.caseNumber}
                onChange={(e) => onChange({ caseNumber: e.target.value })}
                placeholder="2-1234/2024"
                className={fieldClass}
              />
            </div>
            <div>
              <label htmlFor="f-uid" className={labelClass}>УИД</label>
              <input
                id="f-uid"
                type="search"
                value={filters.uid}
                onChange={(e) => onChange({ uid: e.target.value })}
                placeholder="Уникальный идентификатор"
                className={fieldClass}
              />
            </div>
            <div>
              <label htmlFor="f-participant" className={labelClass}>ФИО / организация</label>
              <input
                id="f-participant"
                type="search"
                value={filters.participant}
                onChange={(e) => onChange({ participant: e.target.value })}
                placeholder="Участник дела"
                className={fieldClass}
              />
            </div>
            <div>
              <label htmlFor="f-participant-role" className={labelClass}>Роль</label>
              <select
                id="f-participant-role"
                value={filters.participantRole}
                onChange={(e) => onChange({ participantRole: e.target.value })}
                className={fieldClass}
              >
                {PARTICIPANT_ROLE_OPTIONS.map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="f-judge" className={labelClass}>Судья</label>
              <input
                id="f-judge"
                type="search"
                value={filters.judge}
                onChange={(e) => onChange({ judge: e.target.value })}
                placeholder="Фамилия судьи"
                className={fieldClass}
              />
            </div>
          </div>
        )}

        {tab === "date" && (
          <div className="max-w-xl">
            <p className={`${sectionTitle} mb-3`}>Дата заседания</p>
            <HearingCalendar
              hearingFrom={filters.hearingFrom}
              hearingTo={filters.hearingTo}
              onChange={onChange}
            />
          </div>
        )}

        {tab === "court" && (
          <div className="space-y-6">
            <div className="max-w-xl">
              <p className="mb-2 font-mono text-[11px] text-white/50">Республика Мордовия</p>
              <label htmlFor="f-court" className={labelClass}>Суд</label>
              <select
                id="f-court"
                value={filters.court}
                onChange={(e) => onChange({ court: e.target.value })}
                className={fieldClass}
              >
                <option value="all">Все суды</option>
                {courtGroups.map((g) => (
                  <optgroup
                    key={g.region}
                    label={`${g.region} (${g.courts.reduce((s, c) => s + c.count, 0)})`}
                  >
                    {g.courts.map((c) => (
                      <option key={c.subdomain} value={c.subdomain}>
                        {c.name} ({c.count})
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>

            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className={sectionTitle}>Тип производства</p>
                {(filters.category !== "all" || filters.categoryGroup !== "all") && (
                  <button
                    type="button"
                    onClick={clearCategoryFilters}
                    className="font-mono text-[9px] uppercase tracking-wider text-white/40 hover:text-white"
                  >
                    сбросить категории
                  </button>
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <ToggleChip
                  active={filters.categoryGroup === "all" && filters.category === "all"}
                  onClick={() => selectCategoryGroup("all")}
                >
                  Все типы
                </ToggleChip>
                {categoryGroups.map((group) => (
                  <ToggleChip
                    key={group.id}
                    active={filters.categoryGroup === group.id}
                    onClick={() => selectCategoryGroup(group.id)}
                  >
                    {group.label}
                    <span className="ml-1.5 opacity-50">{group.items.length}</span>
                  </ToggleChip>
                ))}
              </div>

              <div className="mt-4 max-w-xl">
                <label htmlFor="f-cat-search" className={labelClass}>Поиск категории</label>
                <input
                  id="f-cat-search"
                  type="search"
                  value={categorySearch}
                  onChange={(e) => setCategorySearch(e.target.value)}
                  placeholder="Начните вводить…"
                  className={fieldClass}
                />
              </div>

              <div className="mt-3 max-h-[min(40vh,320px)] space-y-2 overflow-y-auto pr-1">
                {filteredGroups.map((group) => {
                  const isOpen = expandedGroups.has(group.id) || Boolean(searchLower);
                  return (
                    <div key={group.id} className="border border-white/10">
                      <button
                        type="button"
                        onClick={() => toggleGroupExpand(group.id)}
                        className="flex w-full items-center justify-between px-3 py-2 font-mono text-[11px] text-white/75 hover:bg-white/[0.03]"
                      >
                        <span>{group.label}</span>
                        <span className="text-white/35">
                          {group.items.length}
                          {!searchLower && (isOpen ? " ↑" : " ↓")}
                        </span>
                      </button>
                      {isOpen && (
                        <div className="flex flex-wrap gap-2 border-t border-white/10 p-3">
                          {group.items.map((cat) => (
                            <ToggleChip
                              key={cat.name}
                              active={filters.category === cat.name}
                              onClick={() => selectCategory(cat.name)}
                            >
                              <span title={cat.name}>
                                {cat.name.length > 36 ? `${cat.name.slice(0, 34)}…` : cat.name}
                              </span>
                              <span className="ml-1.5 opacity-50">{cat.count}</span>
                            </ToggleChip>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {tab === "more" && (
          <div className="flex flex-wrap gap-2">
            <ToggleChip
              active={filters.onlyWithDocuments}
              onClick={() => onChange({ onlyWithDocuments: !filters.onlyWithDocuments })}
            >
              С документами
            </ToggleChip>
            <ToggleChip
              active={filters.onlyEnriched}
              onClick={() => onChange({ onlyEnriched: !filters.onlyEnriched })}
            >
              С полными карточками
            </ToggleChip>
          </div>
        )}

        {active && (
          <div className="mt-5 border-t border-white/10 pt-4">
            <p className={sectionTitle}>Активные условия</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {filters.caseNumber.trim() && (
                <span className="border border-white/15 px-2 py-1 font-mono text-[10px] text-white/65">
                  № {filters.caseNumber.trim()}
                </span>
              )}
              {filters.uid.trim() && (
                <span className="border border-white/15 px-2 py-1 font-mono text-[10px] text-white/65">
                  УИД
                </span>
              )}
              {filters.participant.trim() && (
                <span className="border border-white/15 px-2 py-1 font-mono text-[10px] text-white/65">
                  {filters.participant.trim()}
                </span>
              )}
              {filters.participantRole !== "all" && (
                <span className="border border-amber-400/30 px-2 py-1 font-mono text-[10px] text-amber-300/80">
                  {PARTICIPANT_ROLE_OPTIONS.find((o) => o.id === filters.participantRole)?.label}
                </span>
              )}
              {filters.judge.trim() && (
                <span className="border border-purple-400/30 px-2 py-1 font-mono text-[10px] text-purple-300/80">
                  судья: {filters.judge.trim()}
                </span>
              )}
              {filters.region !== "all" && filters.region !== DISPLAY_REGION && (
                <span className="border border-sky-400/30 px-2 py-1 font-mono text-[10px] text-sky-300/80">
                  {filters.region}
                </span>
              )}
              {filters.court !== "all" && (
                <span className="border border-purple-400/30 px-2 py-1 font-mono text-[10px] text-purple-300/80">
                  {courts.find((c) => c.subdomain === filters.court)?.name ?? filters.court}
                </span>
              )}
              {filters.category !== "all" && (
                <span className="border border-emerald-400/30 px-2 py-1 font-mono text-[10px] text-emerald-300/80">
                  {filters.category}
                </span>
              )}
              {filters.categoryGroup !== "all" && (
                <span className="border border-emerald-400/30 px-2 py-1 font-mono text-[10px] text-emerald-300/80">
                  {categoryGroups.find((g) => g.id === filters.categoryGroup)?.label}
                </span>
              )}
              {filters.onlyWithDocuments && (
                <span className="border border-sky-400/30 px-2 py-1 font-mono text-[10px] text-sky-300/80">
                  с документами
                </span>
              )}
              {filters.onlyEnriched && (
                <span className="border border-emerald-400/30 px-2 py-1 font-mono text-[10px] text-emerald-300/80">
                  карточки
                </span>
              )}
              {(filters.hearingFrom || filters.hearingTo) && (
                <span className="border border-amber-400/30 px-2 py-1 font-mono text-[10px] text-amber-200/90">
                  {filters.hearingFrom || "…"}
                  {filters.hearingTo && filters.hearingTo !== filters.hearingFrom
                    ? ` — ${filters.hearingTo}`
                    : ""}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
