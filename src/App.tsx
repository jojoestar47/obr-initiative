import { useEffect, useMemo, useState } from "react";
import OBR, { isImage } from "@owlbear-rodeo/sdk";
import type { Image } from "@owlbear-rodeo/sdk";

import type { Combatant, TrackerState } from "./obrState";
import { defaultState, loadState, onStateChange, saveState } from "./obrState";
import { useIsGM, requireGM } from "./gmOnly";

const uid = () => crypto.randomUUID();
type AnyItem = Record<string, any>;

// Keep in sync with contextMenu.ts
const ITEM_FLAG_KEY = "com.josiahf.initiative/inInitiative";

function clampIndex(idx: number, len: number) {
  if (len <= 0) return 0;
  return Math.max(0, Math.min(idx, len - 1));
}

function baseName(name: string): string {
  const n = (name ?? "").trim();
  const m = n.match(/^(.*?)(?:\s+([A-Z]))$/);
  if (!m) return n;
  const maybeBase = m[1].trim();
  const maybeLetter = m[2];
  if (maybeBase.length > 0 && maybeLetter) return maybeBase;
  return n;
}

function nextLetter(index: number): string {
  return String.fromCharCode("A".charCodeAt(0) + index);
}

function assignLetteredNames(existing: Combatant[], incomingBaseNames: string[]): string[] {
  const existingCounts = new Map<string, number>();
  for (const c of existing) {
    const bn = baseName(c.name);
    existingCounts.set(bn, (existingCounts.get(bn) ?? 0) + 1);
  }

  const totalCounts = new Map<string, number>();
  for (const c of existing) {
    const bn = baseName(c.name);
    totalCounts.set(bn, (totalCounts.get(bn) ?? 0) + 1);
  }
  for (const n of incomingBaseNames) {
    const bn = baseName(n);
    totalCounts.set(bn, (totalCounts.get(bn) ?? 0) + 1);
  }

  const usedSoFar = new Map<string, number>(existingCounts);

  return incomingBaseNames.map((n) => {
    const bn = baseName(n);
    const total = totalCounts.get(bn) ?? 1;
    if (total <= 1) return bn;

    const idx = usedSoFar.get(bn) ?? 0;
    usedSoFar.set(bn, idx + 1);
    return `${bn} ${nextLetter(idx)}`;
  });
}

async function getSelectedCharacterTokens(): Promise<Image[]> {
  const selection = (await OBR.player.getSelection()) ?? [];
  if (selection.length === 0) return [];

  const items = await OBR.scene.items.getItems(selection);
  return items.filter((item): item is Image => item.layer === "CHARACTER" && isImage(item));
}

function initials(name: string) {
  const parts = (name ?? "").trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("");
}

function rollD20(): number {
  return Math.floor(Math.random() * 20) + 1;
}

function toIntOr0(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function SortIcon({ desc, className = "" }: { desc: boolean; className?: string }) {
  const activeUp = !desc; // ascending
  const activeDown = desc; // descending

  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d="M4 6h9M4 10h7M4 14h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <g opacity={activeUp ? 1 : 0.35}>
        <path d="M17 20V9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path
          d="M14.5 11.5L17 9l2.5 2.5"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
      <g opacity={activeDown ? 1 : 0.35}>
        <path d="M20 4v11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path
          d="M17.5 12.5L20 15l2.5-2.5"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}

function ChevronIcon({ open, className = "" }: { open: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={[
        className,
        "transition-transform duration-300",
        open ? "rotate-0" : "rotate-180",
      ].join(" ")}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M6 14l6-6 6 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function App() {
  const { isGM, ready: gmReady } = useIsGM();

  const [ready, setReady] = useState(false);
  const [state, setState] = useState<TrackerState>(defaultState());

  // global roll modifier (optional)
  const [globalMod, setGlobalMod] = useState<number>(0);

  // sort direction toggle: true = high->low, false = low->high
  const [sortDesc, setSortDesc] = useState(true);

  // collapsible bottom ribbon (GM only will be shown)
  const [controlsOpen, setControlsOpen] = useState(true);

  useEffect(() => {
    return OBR.onReady(async () => {
      setReady(true);
      setState(await loadState());
    });
  }, []);

  useEffect(() => {
    if (!ready) return;
    return onStateChange(setState);
  }, [ready]);

  const activeId = useMemo(() => state.combatants[state.activeIndex]?.id ?? null, [state]);

  async function commit(next: TrackerState) {
    // Absolute write lock: players can never persist changes
    if (!(await requireGM())) return;

    next.activeIndex = clampIndex(next.activeIndex, next.combatants.length);
    if (next.round < 1) next.round = 1;

    setState(next);
    await saveState(next);
  }

  async function selectTokenForCombatant(c: Combatant) {
    if (!c.tokenId) return;
    try {
      await OBR.player.select([c.tokenId]);
    } catch {
      // ignore
    }
  }

  async function addCombatantManual() {
    if (!(await requireGM())) return;
    const c: Combatant = { id: uid(), name: "New", initiative: 10 };
    await commit({
      ...state,
      combatants: [...state.combatants, c],
      activeIndex: state.combatants.length,
    });
  }

  async function addSelectedTokens() {
    if (!ready) return;
    if (!(await requireGM())) return;

    const tokens = await getSelectedCharacterTokens();
    if (tokens.length === 0) return;

    const existingIds = new Set(state.combatants.map((c) => c.id));
    const toAdd = tokens.filter((t) => !existingIds.has(t.id));
    if (toAdd.length === 0) return;

    const incomingBaseNames = toAdd.map((t) => (t.name?.trim() ? t.name.trim() : "Token"));
    const finalNames = assignLetteredNames(state.combatants, incomingBaseNames);

    const added: Combatant[] = toAdd.map((t, i) => ({
      id: t.id,
      tokenId: t.id,
      name: finalNames[i],
      initiative: 10,
      imageUrl: t.image?.url,
    }));

    await commit({
      ...state,
      combatants: [...state.combatants, ...added],
      activeIndex: state.activeIndex,
    });

    // mark as in initiative so context menu can show remove
    await OBR.scene.items.updateItems(
      added.map((c) => c.tokenId!).filter(Boolean),
      (drafts: AnyItem[]) => {
        for (const d of drafts) {
          if (!d.metadata) d.metadata = {};
          d.metadata[ITEM_FLAG_KEY] = true;
        }
      }
    );
  }

  async function removeCombatant(id: string) {
    if (!(await requireGM())) return;

    const removed = state.combatants.find((c) => c.id === id);

    const idx = state.combatants.findIndex((c) => c.id === id);
    const nextList = state.combatants.filter((c) => c.id !== id);
    const nextActive = idx < state.activeIndex ? state.activeIndex - 1 : state.activeIndex;

    await commit({ ...state, combatants: nextList, activeIndex: nextActive });

    if (removed?.tokenId) {
      await OBR.scene.items.updateItems([removed.tokenId], (drafts: AnyItem[]) => {
        for (const d of drafts) {
          if (!d.metadata) d.metadata = {};
          delete d.metadata[ITEM_FLAG_KEY];
        }
      });
    }
  }

  async function updateCombatant(id: string, patch: Partial<Combatant>) {
    if (!(await requireGM())) return;
    const nextList = state.combatants.map((c) => (c.id === id ? { ...c, ...patch } : c));
    await commit({ ...state, combatants: nextList });
  }

  async function sortByInitiative() {
    if (state.combatants.length === 0) return;
    if (!(await requireGM())) return;

    const sorted = [...state.combatants].sort((a, b) =>
      sortDesc ? b.initiative - a.initiative : a.initiative - b.initiative
    );

    await commit({
      ...state,
      combatants: sorted,
      activeIndex: 0,
    });

    setSortDesc((v) => !v);
  }

  async function nextTurn() {
    const len = state.combatants.length;
    if (len === 0) return;
    if (!(await requireGM())) return;

    const nextIndex = (state.activeIndex + 1) % len;
    const roundBump = nextIndex === 0 ? 1 : 0;
    await commit({ ...state, activeIndex: nextIndex, round: state.round + roundBump });
  }

  async function prevTurn() {
    const len = state.combatants.length;
    if (len === 0) return;
    if (!(await requireGM())) return;

    const nextIndex = (state.activeIndex - 1 + len) % len;
    const roundDrop = state.activeIndex === 0 ? 1 : 0;
    await commit({
      ...state,
      activeIndex: nextIndex,
      round: Math.max(1, state.round - roundDrop),
    });
  }

  async function clearAll() {
    if (!(await requireGM())) return;

    const tokenIds = state.combatants
      .map((c) => c.tokenId)
      .filter((id): id is string => typeof id === "string" && id.length > 0);

    await commit(defaultState());

    if (tokenIds.length > 0) {
      await OBR.scene.items.updateItems(tokenIds, (drafts: AnyItem[]) => {
        for (const d of drafts) {
          if (!d.metadata) d.metadata = {};
          delete d.metadata[ITEM_FLAG_KEY];
        }
      });
    }
  }

  async function rollAllInitiative() {
    if (state.combatants.length === 0) return;
    if (!(await requireGM())) return;

    const mod = toIntOr0(globalMod);
    const nextList = state.combatants.map((c) => ({ ...c, initiative: rollD20() + mod }));
    await commit({ ...state, combatants: nextList });
  }

  async function rollSelectedTokenInitiative() {
    if (!(await requireGM())) return;

    const tokens = await getSelectedCharacterTokens();
    if (tokens.length === 0) return;

    const selectedIds = new Set(tokens.map((t) => t.id));
    const mod = toIntOr0(globalMod);

    const nextList = state.combatants.map((c) => {
      const tid = c.tokenId ?? c.id;
      if (!selectedIds.has(tid)) return c;
      return { ...c, initiative: rollD20() + mod };
    });

    await commit({ ...state, combatants: nextList });
  }

  const showReady = ready && gmReady;

  return (
    <div className="h-screen w-screen bg-zinc-950 text-zinc-100">
      <style>
        {`
          @keyframes initGlow {
            0%   { box-shadow: 0 0 0px rgba(16,185,129,0.0), 0 0 0px rgba(16,185,129,0.0); }
            50%  { box-shadow: 0 0 18px rgba(16,185,129,0.35), 0 0 36px rgba(16,185,129,0.18); }
            100% { box-shadow: 0 0 0px rgba(16,185,129,0.0), 0 0 0px rgba(16,185,129,0.0); }
          }
          .active-glow { animation: initGlow 1.8s ease-in-out infinite; }
        `}
      </style>

      <div className="h-full p-3">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 shadow-sm h-full flex flex-col overflow-hidden">
          <header className="p-3 border-b border-zinc-800 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xs text-zinc-400">Round</div>
              <div className="text-2xl font-semibold leading-tight">{state.round}</div>
              {showReady && !isGM && (
                <div className="text-[11px] text-zinc-400 mt-1">Read-only</div>
              )}
            </div>

            <div className="flex gap-2 shrink-0 items-center">
              <button
                className="h-10 w-10 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-sm disabled:opacity-50 flex items-center justify-center"
                onClick={sortByInitiative}
                disabled={!showReady || !isGM || state.combatants.length === 0}
                title={sortDesc ? "Sort high → low" : "Sort low → high"}
              >
                <SortIcon desc={sortDesc} className="h-5 w-5" />
              </button>

              <button
                className="px-3 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-sm disabled:opacity-50"
                onClick={prevTurn}
                disabled={!showReady || !isGM || state.combatants.length === 0}
              >
                Prev
              </button>

              <button
                className="px-3 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-sm disabled:opacity-50"
                onClick={nextTurn}
                disabled={!showReady || !isGM || state.combatants.length === 0}
              >
                Next
              </button>
            </div>
          </header>

          <main className="flex-1 overflow-auto p-3">
            {!ready ? (
              <div className="text-zinc-400 text-sm">Loading Owlbear SDK…</div>
            ) : state.combatants.length === 0 ? (
              <div className="text-zinc-400 text-sm">
                No combatants yet.
                {isGM ? (
                  <>
                    {" "}
                    Select tokens, then click{" "}
                    <span className="text-zinc-200">Add Selected</span>.
                  </>
                ) : null}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="px-3 pb-1 grid grid-cols-[44px_minmax(0,1fr)_72px_40px] items-center gap-2 text-[11px] text-zinc-400">
                  <div />
                  <div>Name</div>
                  <div className="text-center">Init</div>
                  <div />
                </div>

                <ul className="space-y-2">
                  {state.combatants.map((c) => {
                    const active = c.id === activeId;

                    return (
                      <li
                        key={c.id}
                        onClick={() => selectTokenForCombatant(c)}
                        className={[
                          "rounded-2xl border p-2.5",
                          c.tokenId ? "cursor-pointer" : "",
                          "grid grid-cols-[44px_minmax(0,1fr)_72px_40px] items-center gap-2",
                          active
                            ? "border-emerald-500/70 bg-emerald-500/10 active-glow"
                            : "border-zinc-800 bg-zinc-950/30",
                        ].join(" ")}
                        title={c.tokenId ? "Select token on map" : undefined}
                      >
                        <div className="shrink-0">
                          {c.imageUrl ? (
                            <img
                              src={c.imageUrl}
                              alt=""
                              className="h-11 w-11 rounded-xl object-cover border border-zinc-800"
                              referrerPolicy="no-referrer"
                              onClick={(e) => e.stopPropagation()}
                            />
                          ) : (
                            <div
                              className="h-11 w-11 rounded-xl border border-zinc-800 bg-zinc-900 flex items-center justify-center text-xs text-zinc-300"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {initials(c.name)}
                            </div>
                          )}
                        </div>

                        <div className="min-w-0">
                          <input
                            onClick={(e) => e.stopPropagation()}
                            className="w-full min-w-0 rounded-xl bg-zinc-900 border border-zinc-800 px-2.5 py-2 text-sm disabled:opacity-70"
                            value={c.name}
                            disabled={!isGM}
                            onChange={(e) =>
                              isGM && updateCombatant(c.id, { name: e.target.value })
                            }
                            title={c.name}
                          />
                        </div>

                        <div>
                          <input
                            onClick={(e) => e.stopPropagation()}
                            className="w-full rounded-xl bg-zinc-900 border border-zinc-800 px-2 py-2 text-sm text-center disabled:opacity-70"
                            type="number"
                            value={c.initiative}
                            disabled={!isGM}
                            onChange={(e) =>
                              isGM &&
                              updateCombatant(c.id, { initiative: Number(e.target.value) })
                            }
                          />
                        </div>

                        {isGM ? (
                          <button
                            className="h-10 w-10 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-sm flex items-center justify-center"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeCombatant(c.id);
                            }}
                            title="Remove"
                          >
                            ✕
                          </button>
                        ) : (
                          <div />
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </main>

          {/* GM-only Controls */}
          {isGM && (
            <footer className="border-t border-zinc-800">
              <div className="p-3 flex items-center justify-between">
                <div className="text-sm text-zinc-300 font-medium">Controls</div>

                <button
                  className="h-9 w-9 rounded-xl bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center"
                  onClick={() => setControlsOpen((v) => !v)}
                  title={controlsOpen ? "Collapse controls" : "Expand controls"}
                >
                  <ChevronIcon open={controlsOpen} className="h-5 w-5" />
                </button>
              </div>

              <div
                className={[
                  "overflow-hidden transition-all duration-300 ease-in-out",
                  controlsOpen ? "max-h-[320px] opacity-100" : "max-h-0 opacity-0",
                ].join(" ")}
              >
                <div className="px-3 pb-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs text-zinc-400">Global roll mod (optional)</div>
                    <input
                      className="w-16 rounded-xl bg-zinc-900 border border-zinc-800 px-2 py-1 text-sm text-center"
                      type="number"
                      value={globalMod}
                      onChange={(e) => setGlobalMod(Number(e.target.value))}
                      title="Adds to all rolls"
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-sm font-semibold disabled:opacity-50"
                      onClick={addCombatantManual}
                      disabled={!showReady}
                      title="Add a manual row"
                    >
                      Add
                    </button>

                    <button
                      className="px-3 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-sm disabled:opacity-50"
                      onClick={addSelectedTokens}
                      disabled={!showReady}
                      title="Add selected tokens"
                    >
                      Add Selected
                    </button>

                    <button
                      className="px-3 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-sm disabled:opacity-50"
                      onClick={rollSelectedTokenInitiative}
                      disabled={!showReady || state.combatants.length === 0}
                      title="Roll initiative for selected tokens"
                    >
                      Roll Selected
                    </button>

                    <button
                      className="px-3 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-sm disabled:opacity-50"
                      onClick={rollAllInitiative}
                      disabled={!showReady || state.combatants.length === 0}
                      title="Roll initiative for everyone"
                    >
                      Roll All
                    </button>

                    <button
                      className="px-3 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-sm disabled:opacity-50 col-span-2"
                      onClick={clearAll}
                      disabled={!showReady}
                    >
                      Clear
                    </button>
                  </div>
                </div>
              </div>
            </footer>
          )}
        </div>
      </div>
    </div>
  );
}
