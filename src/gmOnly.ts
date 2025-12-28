import OBR from "@owlbear-rodeo/sdk";

/**
 * Simple GM gate.
 * - Call `await initGMGate()` once after OBR is ready.
 * - Use `isGM()` to enable/disable UI
 * - Use `requireGM()` at the top of every write handler
 */
let _isGM = false;

export async function initGMGate(): Promise<boolean> {
  const role = await OBR.player.getRole(); // "GM" | "PLAYER"
  _isGM = role === "GM";
  return _isGM;
}

export function isGM(): boolean {
  return _isGM;
}

/** Returns true if allowed, false if blocked */
export function requireGM(): boolean {
  return _isGM;
}
