import { useCallback } from 'react';
import { voiceCallManager } from '../services/voiceCall';
import type { VoiceCallPeer } from '../types/voiceCall';

export function useVoiceCall() {
  const startCall = useCallback(async (conversationId: string, peer: VoiceCallPeer) => {
    await voiceCallManager.startCall(conversationId, peer);
  }, []);

  return { startCall };
}
