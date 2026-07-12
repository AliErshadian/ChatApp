import { useEffect, useState } from 'react';
import { Avatar } from './Avatar';
import { voiceCallManager } from '../services/voiceCall';
import type { VoiceCallState } from '../types/voiceCall';

function getStatusLabel(state: VoiceCallState): string {
  switch (state.phase) {
    case 'outgoing':
      return 'Calling...';
    case 'incoming':
      return 'Incoming voice call';
    case 'connecting':
      return 'Connecting...';
    case 'active':
      return state.muted ? 'On call (muted)' : 'On call';
    default:
      return '';
  }
}

export function VoiceCallModal() {
  const [state, setState] = useState<VoiceCallState>(voiceCallManager.getState());

  useEffect(() => voiceCallManager.subscribe(setState), []);

  if (state.phase === 'idle' || state.phase === 'ended') {
    return null;
  }

  const peerName = state.peer?.displayName ?? 'Contact';
  const status = state.error ?? getStatusLabel(state);

  return (
    <div className="voice-call-overlay" role="dialog" aria-label="Voice call">
      <div className="voice-call-card">
        <div className="voice-call-avatar-wrap">
          <Avatar name={peerName} size="lg" />
        </div>
        <h3 className="voice-call-name">{peerName}</h3>
        <p className="voice-call-status">{status}</p>

        <div className="voice-call-actions">
          {state.phase === 'incoming' ? (
            <>
              <button
                type="button"
                className="voice-call-btn voice-call-btn--reject"
                onClick={() => void voiceCallManager.rejectCall()}
                aria-label="Decline call"
              >
                ✕
              </button>
              <button
                type="button"
                className="voice-call-btn voice-call-btn--accept"
                onClick={() => void voiceCallManager.acceptCall()}
                aria-label="Accept call"
              >
                📞
              </button>
            </>
          ) : (
            <>
              {(state.phase === 'active' || state.phase === 'connecting' || state.phase === 'outgoing') && (
                <button
                  type="button"
                  className={`voice-call-btn voice-call-btn--mute${state.muted ? ' voice-call-btn--muted' : ''}`}
                  onClick={() => voiceCallManager.toggleMute()}
                  aria-label={state.muted ? 'Unmute' : 'Mute'}
                  title={state.muted ? 'Unmute' : 'Mute'}
                >
                  {state.muted ? '🔇' : '🎤'}
                </button>
              )}
              <button
                type="button"
                className="voice-call-btn voice-call-btn--end"
                onClick={() => void voiceCallManager.endCall()}
                aria-label="End call"
              >
                📵
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
