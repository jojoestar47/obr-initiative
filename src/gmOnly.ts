// src/gmOnly.ts
import { useEffect, useState } from "react";
import OBR from "@owlbear-rodeo/sdk";

/** Awaitable onReady wrapper (your SDK types require a callback) */
function onReadyAsync(): Promise<void> {
  return new Promise((resolve) => {
    OBR.onReady(() => resolve());
  });
}

let _isGM: boolean | null = null;

export async function initGM(): Promise<boolean> {
  if (_isGM !== null) return _isGM;

  await onReadyAsync();
  const role = await OBR.player.getRole(); // "GM" | "PLAYER"
  _isGM = role === "GM";
  return _isGM;
}

export async function requireGM(): Promise<boolean> {
  return await initGM();
}

export function useIsGM() {
  const [isGM, setIsGM] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;

    (async () => {
      const gm = await initGM();
      if (!mounted) return;
      setIsGM(gm);
      setReady(true);
    })();

    return () => {
      mounted = false;
    };
  }, []);

  return { isGM, ready };
}
