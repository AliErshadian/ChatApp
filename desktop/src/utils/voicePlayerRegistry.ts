let activePlayerId: string | null = null;
let activePause: (() => void) | null = null;

export function claimVoicePlayer(playerId: string, pause: () => void) {
  if (activePlayerId && activePlayerId !== playerId && activePause) {
    activePause();
  }
  activePlayerId = playerId;
  activePause = pause;
}

export function releaseVoicePlayer(playerId: string) {
  if (activePlayerId !== playerId) return;
  activePlayerId = null;
  activePause = null;
}
