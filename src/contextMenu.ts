// src/contextMenu.ts
import OBR from "@owlbear-rodeo/sdk";
import type { Combatant, TrackerState } from "./obrState";
import { defaultState } from "./obrState";

const ID = "com.josiahf.initiative";
const META_KEY = "com.josiahf.initiative/state";
const ITEM_FLAG_KEY = "com.josiahf.initiative/inInitiative";

type AnyItem = Record<string, any>;

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

async function getTrackerState(): Promise<TrackerState> {
  const meta = await OBR.scene.getMetadata();
  return parseState(meta[META_KEY]) ?? defaultState();
}

function isToken(item: AnyItem) {
  return item?.type === "IMAGE" && item?.layer === "CHARACTER";
}

function getTokenName(item: AnyItem): string {
  const name = item?.name;
  if (typeof name === "string" && name.trim()) return name.trim();
  return "Token";
}

function getTokenImageUrl(item: AnyItem): string | undefined {
  // OBR Image items use `image.url` when present
  const url = item?.image?.url;
  return typeof url === "string" && url.length > 0 ? url : undefined;
}

// Keep letter logic stable even when tokens are added later.
// baseName("Guard B") => "Guard"
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

/**
 * Given existing combatants and incoming base names, return names with A/B/C...
 * Uses existing counts so adding more later continues: Guard A, Guard B, then Guard C, Guard D...
 */
function assignLetteredNames(
  existing: Combatant[],
  incomingBaseNames: string[]
): string[] {
  // Count existing by base name
  const existingCounts = new Map<string, number>();
  for (const c of existing) {
    const bn = baseName(c.name);
    existingCounts.set(bn, (existingCounts.get(bn) ?? 0) + 1);
  }

  // Compute totals after adding incoming (so we only add letters when needed)
  const totalCounts = new Map<string, number>();
  for (const c of existing) {
    const bn = baseName(c.name);
    totalCounts.set(bn, (totalCounts.get(bn) ?? 0) + 1);
  }
  for (const n of incomingBaseNames) {
    const bn = baseName(n);
    totalCounts.set(bn, (totalCounts.get(bn) ?? 0) + 1);
  }

  // Track how many have been used so far (start from existing)
  const usedSoFar = new Map<string, number>(existingCounts);

  return incomingBaseNames.map((n) => {
    const bn = baseName(n);
    const total = totalCounts.get(bn) ?? 1;

    // If there's only one of this name total, don't add a letter
    if (total <= 1) return bn;

    // Otherwise assign next letter after the existing ones
    const idx = usedSoFar.get(bn) ?? 0;
    usedSoFar.set(bn, idx + 1);
    return `${bn} ${nextLetter(idx)}`;
  });
}

/** GM guard (players should never be able to write) */
async function isCurrentUserGM(): Promise<boolean> {
  const role = await OBR.player.getRole();
  return role === "GM";
}

async function toggleInitiative(items: AnyItem[]) {
  // Extra safety: if a player somehow triggers this, do nothing.
  if (!(await isCurrentUserGM())) return;

  const tokens = items.filter(isToken);
  if (tokens.length === 0) return;

  const current = await getTrackerState();

  const inInit = tokens.filter((t) => t?.metadata?.[ITEM_FLAG_KEY] === true);
  const notInInit = tokens.filter((t) => t?.metadata?.[ITEM_FLAG_KEY] !== true);

  // Remove flagged tokens from state
  const removeIds = new Set(inInit.map((t) => String(t.id)));
  let nextCombatants = current.combatants.filter((c) => !removeIds.has(c.id));

  // Add unflagged tokens to state (avoid duplicates by id)
  const existingById = new Set(nextCombatants.map((c) => c.id));
  const toAddTokens = notInInit.filter((t) => !existingById.has(String(t.id)));

  if (toAddTokens.length > 0) {
    const baseNames = toAddTokens.map(getTokenName);
    const finalNames = assignLetteredNames(nextCombatants, baseNames);

    const added: Combatant[] = toAddTokens.map((t, i) => {
      const tokenId = String(t.id);
      return {
        id: tokenId,
        tokenId,
        name: finalNames[i],
        initiative: 10,
        imageUrl: getTokenImageUrl(t),
      };
    });

    nextCombatants = [...nextCombatants, ...added];
  }

  const next: TrackerState = {
    ...current,
    combatants: nextCombatants,
    activeIndex: Math.min(
      current.activeIndex,
      Math.max(0, nextCombatants.length - 1)
    ),
  };

  // GM-only write
  await OBR.scene.setMetadata({ [META_KEY]: JSON.stringify(next) });

  // Update flags to match new state
  if (inInit.length > 0) {
    await OBR.scene.items.updateItems(
      inInit.map((t) => String(t.id)),
      (drafts: AnyItem[]) => {
        for (const d of drafts) {
          if (!d.metadata) d.metadata = {};
          delete d.metadata[ITEM_FLAG_KEY];
        }
      }
    );
  }

  if (notInInit.length > 0) {
    await OBR.scene.items.updateItems(
      notInInit.map((t) => String(t.id)),
      (drafts: AnyItem[]) => {
        for (const d of drafts) {
          if (!d.metadata) d.metadata = {};
          d.metadata[ITEM_FLAG_KEY] = true;
        }
      }
    );
  }
}

// Register a single context menu entry whose icon/label is chosen by filters
OBR.onReady(async () => {
  // Only create the context menu for the GM (players won’t even see the buttons)
  if (!(await isCurrentUserGM())) return;

  await OBR.contextMenu.create({
    id: `${ID}/initiative`,
    icons: [
      // Shows when ALL selected tokens are already in initiative
      {
        icon: "/remove.svg",
        label: "Remove from Initiative",
        filter: {
          every: [
            { key: "type", value: "IMAGE" },
            { key: "layer", value: "CHARACTER" },
            { key: ["metadata", ITEM_FLAG_KEY], value: true },
          ],
        },
      },
      // Shows when ALL selected tokens are NOT in initiative
      {
        icon: "/add.svg",
        label: "Add to Initiative",
        filter: {
          every: [
            { key: "type", value: "IMAGE" },
            { key: "layer", value: "CHARACTER" },
            { key: ["metadata", ITEM_FLAG_KEY], value: true, operator: "!=" },
          ],
        },
      },
      // Fallback for mixed selections (some in, some out)
      {
        icon: "/toggle.svg",
        label: "Toggle Initiative",
        filter: {
          every: [
            { key: "type", value: "IMAGE" },
            { key: "layer", value: "CHARACTER" },
          ],
        },
      },
    ],
    async onClick(context) {
      await toggleInitiative(context.items as AnyItem[]);
    },
  });
});
