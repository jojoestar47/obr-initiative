import OBR from "@owlbear-rodeo/sdk";
import type { TrackerState } from "./obrState";
import { defaultState } from "./obrState";
import { requireGM } from "./gmOnly";

const META_KEY = "com.josiahf.initiative/state";

function parseState(raw: unknown): TrackerState | null {
  if (typeof raw !== "string") return null;
  try {
    const s = JSON.parse(raw) as TrackerState;
    if (!s || s.version !== 1) return null;
    if (!Array.isArray(s.combatants)) return null;
    return s;
  } catch {
    return null;
  }
}

export async function getTrackerState(): Promise<TrackerState> {
  const meta = await OBR.scene.getMetadata();
  return parseState(meta[META_KEY]) ?? defaultState();
}

/**
 * GM-only setter.
 * Players will no-op.
 */
export async function setTrackerState(next: TrackerState): Promise<void> {
  if (!requireGM()) return;

  await OBR.scene.setMetadata({
    [META_KEY]: JSON.stringify(next),
  });
}
