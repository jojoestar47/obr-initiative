import { useEffect, useMemo, useRef, useState } from "react";
import OBR, { isImage } from "@owlbear-rodeo/sdk";
import type { Image } from "@owlbear-rodeo/sdk";

import type { Combatant, TrackerSettings, TrackerState } from "./obrState";
import { defaultSettings, defaultState, loadState, onStateChange, saveState } from "./obrState";
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

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={[
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors active:opacity-80",
        checked ? "bg-emerald-600" : "bg-zinc-700",
      ].join(" ")}
    >
      <span
        className={[
          "inline-block h-4 w-4 rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-6" : "translate-x-1",
        ].join(" ")}
      />
    </button>
  );
}

function GearIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path
        d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  );
}

function HpBar({ hp, maxHp, className = "" }: { hp: number; maxHp: number; className?: string }) {
  if (maxHp <= 0) return null;
  const pct = Math.max(0, Math.min(100, (hp / maxHp) * 100));
  const color = pct > 60 ? "bg-emerald-500" : pct > 30 ? "bg-amber-400" : "bg-red-500";
  return (
    <div className={`h-1.5 w-full rounded-full bg-zinc-800 ${className}`}>
      <div
        className={`h-full rounded-full transition-all duration-300 ${color}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
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
  const [settingsOpen, setSettingsOpen] = useState(false);

  // global roll modifier (optional)
  const [globalMod, setGlobalMod] = useState<number>(0);

  // sort direction toggle: true = high->low, false = low->high
  const [sortDesc, setSortDesc] = useState(true);

  // collapsible bottom ribbon (GM only will be shown)
  const [controlsOpen, setControlsOpen] = useState(true);

  // Notification refs
  const prevActiveIdRef = useRef<string | null | undefined>(undefined);
  const notifIdRef = useRef<string | null>(null);
  // Pan ref — avoid stale closure without adding deps that trigger extra renders
  const panSettingRef = useRef(defaultSettings.panToActive);
  // Arm pan after first render (skip pan on initial load)
  const panArmedRef = useRef(false);

  useEffect(() => {
    return OBR.onReady(async () => {
      setReady(true);
      const loaded = await loadState();
      // Pre-arm the notification ref with the real active ID *before* calling
      // setState so the upcoming render doesn't look like a turn change.
      prevActiveIdRef.current = loaded.combatants[loaded.activeIndex]?.id ?? null;
      panSettingRef.current = loaded.settings?.panToActive ?? defaultSettings.panToActive;
      setState(loaded);
    });
  }, []);

  useEffect(() => {
    if (!ready) return;
    return onStateChange(setState);
  }, [ready]);

  // Stable primitives — effect only re-runs when these string values change,
  // not on every HP/name edit (those produce a new array ref but same ID/name).
  const activeCombatantId   = state.combatants[state.activeIndex]?.id      ?? null;
  const activeCombatantName = state.combatants[state.activeIndex]?.name    ?? "";
  const activeTokenId       = state.combatants[state.activeIndex]?.tokenId ?? null;

  // Keep the pan setting ref in sync whenever settings change in state.
  panSettingRef.current = state.settings?.panToActive ?? defaultSettings.panToActive;

  // Notification: fires when the active combatant ID changes, never on load.
  useEffect(() => {
    if (!ready) return;
    // Fallback arm: covers the edge case where setReady fires before loadState resolves.
    if (prevActiveIdRef.current === undefined) {
      prevActiveIdRef.current = activeCombatantId;
      return;
    }
    if (prevActiveIdRef.current === activeCombatantId) return;
    prevActiveIdRef.current = activeCombatantId;
    if (!activeCombatantId) return;

    // Close previous toast then show new one — prevents stacking on rapid clicks.
    (async () => {
      try { if (notifIdRef.current) await OBR.notification.close(notifIdRef.current); } catch {}
      try { notifIdRef.current = await OBR.notification.show(`${activeCombatantName}'s turn`, "INFO"); } catch {}
    })();
  }, [activeCombatantId, activeCombatantName, ready]);

  // Viewport pan: animates to the active token when the turn changes (if enabled).
  useEffect(() => {
    if (!ready) return;
    if (!panArmedRef.current) { panArmedRef.current = true; return; }
    if (!panSettingRef.current) return;
    if (!activeTokenId) return;

    (async () => {
      try {
        const items = await OBR.scene.items.getItems([activeTokenId]);
        if (!items.length) return;
        const pos = (items[0] as Image).position;
        const scale  = await OBR.viewport.getScale();
        const vWidth  = await OBR.viewport.getWidth();
        const vHeight = await OBR.viewport.getHeight();
        await OBR.viewport.animateTo({
          position: { x: pos.x - vWidth / (2 * scale), y: pos.y - vHeight / (2 * scale) },
          scale,
        });
      } catch { /* non-critical */ }
    })();
  }, [activeCombatantId, activeTokenId, ready]);

  const activeCombatant = useMemo(() => state.combatants[state.activeIndex] ?? null, [state]);
  const upNext = useMemo(() => {
    if (state.combatants.length === 0) return [];
    return [
      ...state.combatants.slice(state.activeIndex + 1),
      ...state.combatants.slice(0, state.activeIndex),
    ];
  }, [state.combatants, state.activeIndex]);

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

  async function updateSettings(patch: Partial<TrackerSettings>) {
    if (!(await requireGM())) return;
    await commit({ ...state, settings: { ...defaultSettings, ...state.settings, ...patch } });
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
          @keyframes spotlightIn {
            from { opacity: 0; transform: translateY(-8px) scale(0.97); }
            to   { opacity: 1; transform: translateY(0)    scale(1);    }
          }
          .spotlight-in { animation: spotlightIn 0.2s ease-out; }
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
                className="h-11 w-11 rounded-xl bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-sm disabled:opacity-50 flex items-center justify-center"
                onClick={sortByInitiative}
                disabled={!showReady || !isGM || state.combatants.length === 0}
                title={sortDesc ? "Sort high → low" : "Sort low → high"}
              >
                <SortIcon desc={sortDesc} className="h-6 w-6" />
              </button>

              <button
                className="px-4 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-sm disabled:opacity-50"
                onClick={prevTurn}
                disabled={!showReady || !isGM || state.combatants.length === 0}
              >
                Prev
              </button>

              <button
                className="px-4 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-sm disabled:opacity-50"
                onClick={nextTurn}
                disabled={!showReady || !isGM || state.combatants.length === 0}
              >
                Next
              </button>

              {isGM && (
                <button
                  className={[
                    "h-11 w-11 rounded-xl text-sm flex items-center justify-center",
                    settingsOpen
                      ? "bg-zinc-700 text-zinc-100"
                      : "bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-zinc-400 hover:text-zinc-200",
                  ].join(" ")}
                  onClick={() => setSettingsOpen((v) => !v)}
                  title="Settings"
                >
                  <GearIcon className="h-5 w-5" />
                </button>
              )}
            </div>
          </header>

          <main className="flex-1 min-h-0 overflow-auto p-3">
            {/* ── Settings panel ── */}
            {settingsOpen ? (
              <div className="space-y-3">
                <div className="text-sm font-semibold text-zinc-300 px-1">DM Settings</div>

                <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-3 flex items-center justify-between gap-4">
                  <div>
                    <div className="text-sm text-zinc-200">Show HP to players</div>
                    <div className="text-xs text-zinc-500 mt-0.5">Players can see health bars and HP values</div>
                  </div>
                  <Toggle
                    checked={state.settings?.showHpToPlayers ?? defaultSettings.showHpToPlayers}
                    onChange={(v) => updateSettings({ showHpToPlayers: v })}
                  />
                </div>

                <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-3 flex items-center justify-between gap-4">
                  <div>
                    <div className="text-sm text-zinc-200">Pan to active token</div>
                    <div className="text-xs text-zinc-500 mt-0.5">Map pans to the active token when turns change</div>
                  </div>
                  <Toggle
                    checked={state.settings?.panToActive ?? defaultSettings.panToActive}
                    onChange={(v) => updateSettings({ panToActive: v })}
                  />
                </div>
              </div>
            ) : !ready ? (
              <div className="text-zinc-400 text-sm">Loading Owlbear SDK…</div>
            ) : state.combatants.length === 0 ? (
              <div className="text-zinc-400 text-sm">
                No combatants yet.
                {isGM && (
                  <> Select tokens, then click <span className="text-zinc-200">Add Selected</span>.</>
                )}
              </div>
            ) : (() => {
              const showHp = isGM || (state.settings?.showHpToPlayers ?? defaultSettings.showHpToPlayers);
              return (
              <div className="space-y-4">

                {/* ── Spotlight: active combatant ── */}
                {activeCombatant && (
                  <div key={activeCombatant.id} className="spotlight-in rounded-2xl border border-emerald-500/70 bg-emerald-500/10 active-glow p-4">
                    <div className="flex items-start gap-3">
                      {/* Avatar */}
                      <div
                        className={activeCombatant.tokenId ? "shrink-0 cursor-pointer" : "shrink-0"}
                        onClick={() => selectTokenForCombatant(activeCombatant)}
                      >
                        {activeCombatant.imageUrl ? (
                          <img
                            src={activeCombatant.imageUrl}
                            alt=""
                            className="h-14 w-14 rounded-full object-cover border border-zinc-700"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <div className="h-14 w-14 rounded-full border border-zinc-700 bg-zinc-900 flex items-center justify-center text-base text-zinc-300">
                            {initials(activeCombatant.name)}
                          </div>
                        )}
                      </div>

                      {/* Name + initiative + HP */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          {isGM ? (
                            <input
                              className="flex-1 min-w-0 rounded-xl bg-zinc-900/80 border border-zinc-700 px-2.5 py-1.5 text-base font-semibold"
                              value={activeCombatant.name}
                              onChange={(e) => updateCombatant(activeCombatant.id, { name: e.target.value })}
                              onClick={(e) => e.stopPropagation()}
                            />
                          ) : (
                            <div className="flex-1 min-w-0 text-base font-semibold truncate">{activeCombatant.name}</div>
                          )}
                          {/* Initiative badge — editable for GM */}
                          {isGM ? (
                            <input
                              type="number"
                              inputMode="numeric"
                              className="h-11 w-11 shrink-0 rounded-full bg-emerald-600 text-white font-bold text-center text-base border-2 border-emerald-500"
                              value={activeCombatant.initiative}
                              onChange={(e) => updateCombatant(activeCombatant.id, { initiative: Number(e.target.value) })}
                              onClick={(e) => e.stopPropagation()}
                            />
                          ) : (
                            <div className="h-11 w-11 shrink-0 rounded-full bg-emerald-600 text-white font-bold flex items-center justify-center text-base">
                              {activeCombatant.initiative}
                            </div>
                          )}
                        </div>

                        {/* HP bar + inputs (respects showHp setting) */}
                        {showHp && (
                          <div className="mt-2.5">
                            <HpBar hp={activeCombatant.hp ?? 0} maxHp={activeCombatant.maxHp ?? 0} />
                            <div className="mt-1.5 flex items-center gap-1">
                              {isGM ? (
                                <>
                                  <input
                                    type="number"
                                    inputMode="numeric"
                                    className="w-14 rounded-lg bg-zinc-900 border border-zinc-700 px-1.5 py-0.5 text-xs text-center"
                                    value={activeCombatant.hp ?? 0}
                                    onChange={(e) => updateCombatant(activeCombatant.id, { hp: Number(e.target.value) })}
                                    onClick={(e) => e.stopPropagation()}
                                  />
                                  <span className="text-xs text-zinc-500">/</span>
                                  <input
                                    type="number"
                                    inputMode="numeric"
                                    className="w-14 rounded-lg bg-zinc-900 border border-zinc-700 px-1.5 py-0.5 text-xs text-center"
                                    value={activeCombatant.maxHp ?? 0}
                                    onChange={(e) => updateCombatant(activeCombatant.id, { maxHp: Number(e.target.value) })}
                                    onClick={(e) => e.stopPropagation()}
                                  />
                                  <span className="text-xs text-zinc-500">hp</span>
                                </>
                              ) : (activeCombatant.maxHp ?? 0) > 0 ? (
                                <span className="text-xs text-zinc-400">
                                  {activeCombatant.hp ?? 0} / {activeCombatant.maxHp} hp
                                </span>
                              ) : null}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {isGM && (
                      <div className="mt-3 flex justify-end">
                        <button
                          className="text-xs text-zinc-500 hover:text-zinc-300 active:text-zinc-100 px-2 py-1 rounded-lg hover:bg-zinc-800 active:bg-zinc-700"
                          onClick={() => removeCombatant(activeCombatant.id)}
                        >
                          Remove
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* ── Up Next ── */}
                {upNext.length > 0 && (
                  <div>
                    <div className="text-[11px] font-semibold tracking-widest text-zinc-500 uppercase px-1 mb-2">
                      Up Next
                    </div>
                    <ul className="space-y-2">
                      {upNext.map((c) => (
                        <li
                          key={c.id}
                          onClick={() => selectTokenForCombatant(c)}
                          className={[
                            "rounded-2xl border border-zinc-800 bg-zinc-950/30 px-2.5 pt-2.5",
                            showHp && (isGM || (c.maxHp ?? 0) > 0) ? "pb-2" : "pb-2.5",
                            c.tokenId ? "cursor-pointer" : "",
                          ].join(" ")}
                        >
                          {/* Main row */}
                          <div className="flex items-center gap-2">
                            <div className="shrink-0">
                              {c.imageUrl ? (
                                <img
                                  src={c.imageUrl}
                                  alt=""
                                  className="h-9 w-9 rounded-full object-cover border border-zinc-800"
                                  referrerPolicy="no-referrer"
                                  onClick={(e) => e.stopPropagation()}
                                />
                              ) : (
                                <div
                                  className="h-9 w-9 rounded-full border border-zinc-800 bg-zinc-900 flex items-center justify-center text-xs text-zinc-300"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {initials(c.name)}
                                </div>
                              )}
                            </div>

                            <div className="flex-1 min-w-0">
                              {isGM ? (
                                <input
                                  className="w-full rounded-xl bg-zinc-900 border border-zinc-800 px-2 py-1.5 text-sm"
                                  value={c.name}
                                  onChange={(e) => updateCombatant(c.id, { name: e.target.value })}
                                  onClick={(e) => e.stopPropagation()}
                                />
                              ) : (
                                <div className="text-sm truncate">{c.name}</div>
                              )}
                            </div>

                            {isGM ? (
                              <input
                                type="number"
                                inputMode="numeric"
                                className="w-14 shrink-0 rounded-xl bg-zinc-900 border border-zinc-800 px-2 py-1.5 text-sm text-center"
                                value={c.initiative}
                                onChange={(e) => updateCombatant(c.id, { initiative: Number(e.target.value) })}
                                onClick={(e) => e.stopPropagation()}
                              />
                            ) : (
                              <div className="text-sm text-zinc-400 shrink-0 w-8 text-right">{c.initiative}</div>
                            )}

                            {isGM && (
                              <button
                                className="h-9 w-9 shrink-0 rounded-xl bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-sm flex items-center justify-center"
                                onClick={(e) => { e.stopPropagation(); removeCombatant(c.id); }}
                                title="Remove"
                              >
                                ✕
                              </button>
                            )}
                          </div>

                          {/* HP row */}
                          {showHp ? isGM ? (
                            <div className="mt-2 pl-[44px] flex items-center gap-1">
                              <HpBar hp={c.hp ?? 0} maxHp={c.maxHp ?? 0} className="flex-1" />
                              <input
                                type="number"
                                inputMode="numeric"
                                className="w-11 shrink-0 rounded-lg bg-zinc-900 border border-zinc-800 px-1 py-0.5 text-xs text-center"
                                value={c.hp ?? 0}
                                onChange={(e) => updateCombatant(c.id, { hp: Number(e.target.value) })}
                                onClick={(e) => e.stopPropagation()}
                              />
                              <span className="text-xs text-zinc-600">/</span>
                              <input
                                type="number"
                                inputMode="numeric"
                                className="w-11 shrink-0 rounded-lg bg-zinc-900 border border-zinc-800 px-1 py-0.5 text-xs text-center"
                                value={c.maxHp ?? 0}
                                onChange={(e) => updateCombatant(c.id, { maxHp: Number(e.target.value) })}
                                onClick={(e) => e.stopPropagation()}
                              />
                              <span className="text-xs text-zinc-600">hp</span>
                            </div>
                          ) : (c.maxHp ?? 0) > 0 ? (
                            <div className="mt-2 pl-[44px]">
                              <HpBar hp={c.hp ?? 0} maxHp={c.maxHp!} />
                              <div className="mt-0.5 text-xs text-zinc-500">{c.hp ?? 0} / {c.maxHp} hp</div>
                            </div>
                          ) : null : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            );
          })()}
          </main>

          {/* GM-only Controls */}
          {isGM && (
            <footer className="border-t border-zinc-800">
              <div className="p-3 flex items-center justify-between">
                <div className="text-sm text-zinc-300 font-medium">Controls</div>

                <button
                  className="h-11 w-11 rounded-xl bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 flex items-center justify-center"
                  onClick={() => setControlsOpen((v) => !v)}
                  title={controlsOpen ? "Collapse controls" : "Expand controls"}
                >
                  <ChevronIcon open={controlsOpen} className="h-6 w-6" />
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
                      inputMode="numeric"
                      value={globalMod}
                      onChange={(e) => setGlobalMod(Number(e.target.value))}
                      title="Adds to all rolls"
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      className="px-3 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-400 text-sm font-semibold disabled:opacity-50"
                      onClick={addCombatantManual}
                      disabled={!showReady}
                      title="Add a manual row"
                    >
                      Add
                    </button>

                    <button
                      className="px-3 py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-sm disabled:opacity-50"
                      onClick={addSelectedTokens}
                      disabled={!showReady}
                      title="Add selected tokens"
                    >
                      Add Selected
                    </button>

                    <button
                      className="px-3 py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-sm disabled:opacity-50"
                      onClick={rollSelectedTokenInitiative}
                      disabled={!showReady || state.combatants.length === 0}
                      title="Roll initiative for selected tokens"
                    >
                      Roll Selected
                    </button>

                    <button
                      className="px-3 py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-sm disabled:opacity-50"
                      onClick={rollAllInitiative}
                      disabled={!showReady || state.combatants.length === 0}
                      title="Roll initiative for everyone"
                    >
                      Roll All
                    </button>

                    <button
                      className="px-3 py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-sm disabled:opacity-50 col-span-2"
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
