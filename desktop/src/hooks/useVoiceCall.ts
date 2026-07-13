import { useCallback } from 'react';
import { voiceCallManager } from '../services/voiceCall';
import type { StartCallOptions, VoiceCallPeer } from '../types/voiceCall';

export function useVoiceCall() {
  const startCall = useCallback(
    async (conversationId: string, peer: VoiceCallPeer, options?: StartCallOptions) => {
      await voiceCallManager.startCall(conversationId, peer, options);
    },
    [],
  );

  const startVoiceCall = useCallback(
    async (conversationId: string, peer: VoiceCallPeer) => {
      await voiceCallManager.startCall(conversationId, peer, { video: false });
    },
    [],
  );

  const startVideoCall = useCallback(
    async (conversationId: string, peer: VoiceCallPeer) => {
      await voiceCallManager.startCall(conversationId, peer, { video: true });
    },
    [],
  );

  return { startCall, startVoiceCall, startVideoCall };
}
