import { useCallback, useEffect, useState } from 'react';
import { screenShareManager, type ScreenShareSessionState } from '../services/screenShare';
import type { ScreenShareSourceKind } from '../utils/screenCapture';

export function useScreenShare(localUserId?: string | null) {
  const [state, setState] = useState<ScreenShareSessionState>(screenShareManager.getState());

  useEffect(() => {
    screenShareManager.setLocalUserId(localUserId ?? null);
  }, [localUserId]);

  useEffect(() => screenShareManager.subscribe(setState), []);

  const startShare = useCallback(
    async (
      conversationId: string,
      options: { sourceId?: string; kind?: ScreenShareSourceKind },
    ) => {
      await screenShareManager.startAsHost(conversationId, options);
    },
    [],
  );

  const joinShare = useCallback(async (sessionId: string) => {
    await screenShareManager.joinSession(sessionId);
  }, []);

  const stopShare = useCallback(async () => {
    await screenShareManager.stopSharing();
  }, []);

  const leaveShare = useCallback(async () => {
    await screenShareManager.leave();
  }, []);

  return { state, startShare, joinShare, stopShare, leaveShare };
}
