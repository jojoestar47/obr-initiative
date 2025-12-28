import OBR from "@owlbear-rodeo/sdk";

export type Combatant = {
  id: string; // tokenId for token-based rows, random uuid for manual rows
  tokenId?: string;
  name: string;
  initiative: number;
  imageUrl?: string;

  // NEW: Dex mod / bonus to initiative (optional)
  initiativeMod?: number;
};

export type TrackerState = {
  version: 1;
  activeIndex: number;
  round: number;
  combatants: Combatant[];
};

const META_KEY = "com.josiahf.initiative/state";

export const defaultState = (): TrackerState => ({
  version: 1,
  activeIndex: 0,
  round: 1,
  combatants: [],
});

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

export async function loadState(): Promise<TrackerState> {
  const meta = await OBR.scene.getMetadata();
  return parseState(meta[META_KEY]) ?? defaultState();
}

export async function saveState(state: TrackerState): Promise<void> {
  await OBR.scene.setMetadata({ [META_KEY]: JSON.stringify(state) });
}

export function onStateChange(cb: (s: TrackerState) => void): () => void {
  return OBR.scene.onMetadataChange((meta) => {
    cb(parseState(meta[META_KEY]) ?? defaultState());
  });
}
