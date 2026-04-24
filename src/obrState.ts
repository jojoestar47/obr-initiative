import OBR from "@owlbear-rodeo/sdk";

export type Combatant = {
  id: string; // tokenId for token-based rows, random uuid for manual rows
  tokenId?: string;
  name: string;
  initiative: number;
  imageUrl?: string;
  initiativeMod?: number;
  hp?: number;
  maxHp?: number;
};

export type TrackerSettings = {
  showHpToPlayers: boolean;
  panToActive: boolean;
  showNotifications: boolean;
};

export const defaultSettings: TrackerSettings = {
  showHpToPlayers: true,
  panToActive: true,
  showNotifications: true,
};

export type TrackerState = {
  version: 1;
  activeIndex: number;
  round: number;
  combatants: Combatant[];
  settings: TrackerSettings;
};

const META_KEY = "com.josiahf.initiative/state";

export const defaultState = (): TrackerState => ({
  version: 1,
  activeIndex: 0,
  round: 1,
  combatants: [],
  settings: { ...defaultSettings },
});

function parseState(raw: unknown): TrackerState | null {
  if (typeof raw !== "string") return null;
  try {
    const s = JSON.parse(raw) as TrackerState;
    if (!s || s.version !== 1) return null;
    if (!Array.isArray(s.combatants)) return null;
    // Backward compat: fill missing settings with defaults
    if (!s.settings) s.settings = { ...defaultSettings };
    return s;
  } catch {
    return null;
  }
}

export async function loadState(): Promise<TrackerState> {
  const meta = await OBR.scene.getMetadata();
  return parseState(meta[META_KEY]) ?? defaultState();
}

/** GM-only write. Players will no-op. */
export async function saveState(state: TrackerState): Promise<void> {
  const role = await OBR.player.getRole();
  if (role !== "GM") return;

  await OBR.scene.setMetadata({ [META_KEY]: JSON.stringify(state) });
}

export function onStateChange(cb: (s: TrackerState) => void): () => void {
  return OBR.scene.onMetadataChange((meta) => {
    cb(parseState(meta[META_KEY]) ?? defaultState());
  });
}
