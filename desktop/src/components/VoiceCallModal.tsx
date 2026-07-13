import { useEffect, useState, type ReactNode } from 'react';
import { Avatar } from './Avatar';
import { voiceCallManager } from '../services/voiceCall';
import type { VoiceCallState } from '../types/voiceCall';
import { useMediaQuery } from '../hooks/useMediaQuery';

function getStatusLabel(state: VoiceCallState): string {
  if (state.phase === 'active') {
    if (state.muted && state.speakerOn) return 'Muted · Speaker';
    if (state.muted) return 'Muted';
    if (state.speakerOn) return 'Speaker on';
    return 'On call';
  }

  switch (state.phase) {
    case 'outgoing':
      return 'Calling...';
    case 'incoming':
      return 'Incoming voice call';
    case 'connecting':
      return 'Connecting...';
    default:
      return '';
  }
}

function CallIcon({ name }: { name: 'mute' | 'speaker' | 'audio' | 'end' | 'accept' | 'reject' }) {
  switch (name) {
    case 'mute':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <path d="M12 19v4" />
          <path d="M8 23h8" />
        </svg>
      );
    case 'speaker':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M11 5 6 9H2v6h4l5 4V5z" />
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
        </svg>
      );
    case 'audio':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 18v-6h3l4-4V3l7 7-7 7v-2l-4-4H6v5H3z" />
          <path d="M16 8.82v6.36" />
          <path d="M19 6v12" />
        </svg>
      );
    case 'end':
    case 'reject':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.58 2.81.7A2 2 0 0 1 22 16.92z" />
          <path d="m15 9-6 6" />
          <path d="m9 9 6 6" />
        </svg>
      );
    case 'accept':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.58 2.81.7A2 2 0 0 1 22 16.92z" />
        </svg>
      );
    default:
      return null;
  }
}

interface CallControlProps {
  label: string;
  active?: boolean;
  disabled?: boolean;
  danger?: boolean;
  accept?: boolean;
  onClick: () => void;
  children: ReactNode;
}

function CallControl({
  label,
  active = false,
  disabled = false,
  danger = false,
  accept = false,
  onClick,
  children,
}: CallControlProps) {
  return (
    <button
      type="button"
      className={`voice-call-control${active ? ' voice-call-control--active' : ''}${
        danger ? ' voice-call-control--danger' : ''
      }${accept ? ' voice-call-control--accept' : ''}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
    >
      <span className="voice-call-control-icon">{children}</span>
      <span className="voice-call-control-label">{label}</span>
    </button>
  );
}

export function VoiceCallModal() {
  const [state, setState] = useState<VoiceCallState>(voiceCallManager.getState());
  const isMobile = useMediaQuery('(max-width: 768px)');

  useEffect(() => {
    const unsubscribe = voiceCallManager.subscribe(setState);
    return () => {
      unsubscribe();
    };
  }, []);

  if (state.phase === 'idle' || state.phase === 'ended') {
    return null;
  }

  const peerName = state.peer?.displayName ?? 'Contact';
  const status = state.error ?? getStatusLabel(state);
  const showInCallControls =
    state.phase === 'active' || state.phase === 'connecting' || state.phase === 'outgoing';

  return (
    <div
      className={`voice-call-overlay${isMobile ? ' voice-call-overlay--phone' : ''}`}
      role="dialog"
      aria-label="Voice call"
    >
      <div className={`voice-call-card${isMobile ? ' voice-call-card--phone' : ''}`}>
        <div className="voice-call-header">
          <div className="voice-call-avatar-wrap">
            <Avatar name={peerName} size={isMobile ? 'lg' : 'lg'} />
          </div>
          <h3 className="voice-call-name">{peerName}</h3>
          <p className="voice-call-status">{status}</p>
        </div>

        {state.phase === 'incoming' ? (
          <div className="voice-call-actions voice-call-actions--incoming">
            <CallControl label="Decline" danger onClick={() => void voiceCallManager.rejectCall()}>
              <CallIcon name="reject" />
            </CallControl>
            <CallControl label="Accept" accept onClick={() => void voiceCallManager.acceptCall()}>
              <CallIcon name="accept" />
            </CallControl>
          </div>
        ) : (
          <div className="voice-call-actions voice-call-actions--in-call">
            {showInCallControls && (
              <div className="voice-call-controls-row">
                <CallControl
                  label={state.muted ? 'Unmute' : 'Mute'}
                  active={state.muted}
                  onClick={() => voiceCallManager.toggleMute()}
                >
                  <CallIcon name="mute" />
                </CallControl>

                {(state.speakerSupported || isMobile) && (
                  <CallControl
                    label={state.speakerOn ? 'Speaker on' : 'Speaker off'}
                    active={state.speakerOn}
                    onClick={() => void voiceCallManager.toggleSpeaker()}
                  >
                    <CallIcon name="speaker" />
                  </CallControl>
                )}

                {state.audioOutputPickerSupported && (
                  <CallControl
                    label="Audio"
                    onClick={() => void voiceCallManager.chooseAudioOutput()}
                  >
                    <CallIcon name="audio" />
                  </CallControl>
                )}
              </div>
            )}

            <CallControl label="End call" danger onClick={() => void voiceCallManager.endCall()}>
              <CallIcon name="end" />
            </CallControl>
          </div>
        )}
      </div>
    </div>
  );
}
