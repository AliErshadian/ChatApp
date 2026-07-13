import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Avatar } from './Avatar';
import { voiceCallManager } from '../services/voiceCall';
import type { VoiceCallState } from '../types/voiceCall';
import { useMediaQuery } from '../hooks/useMediaQuery';

function getStatusLabel(state: VoiceCallState): string {
  const callKind = state.mediaType === 'video' ? 'video call' : 'voice call';

  if (state.phase === 'active') {
    const parts: string[] = [];
    if (state.muted) parts.push('Muted');
    if (state.mediaType === 'video' && state.cameraOff) parts.push('Camera off');
    if (state.speakerOn) parts.push('Speaker');
    if (parts.length > 0) return parts.join(' · ');
    return state.mediaType === 'video' ? 'On video call' : 'On call';
  }

  switch (state.phase) {
    case 'outgoing':
      return state.mediaType === 'video' ? 'Starting video call...' : 'Calling...';
    case 'incoming':
      return `Incoming ${callKind}`;
    case 'connecting':
      return 'Connecting...';
    default:
      return '';
  }
}

function CallIcon({
  name,
}: {
  name: 'mute' | 'speaker' | 'audio' | 'camera' | 'end' | 'accept' | 'reject';
}) {
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
    case 'camera':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M23 7l-7 5 7 5V7z" />
          <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
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
  compact?: boolean;
  onClick: () => void;
  children: ReactNode;
}

function CallControl({
  label,
  active = false,
  disabled = false,
  danger = false,
  accept = false,
  compact = false,
  onClick,
  children,
}: CallControlProps) {
  return (
    <button
      type="button"
      className={`voice-call-control${compact ? ' voice-call-control--compact' : ''}${
        active ? ' voice-call-control--active' : ''
      }${danger ? ' voice-call-control--danger' : ''}${accept ? ' voice-call-control--accept' : ''}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
    >
      <span className="voice-call-control-icon">{children}</span>
      {!compact && <span className="voice-call-control-label">{label}</span>}
    </button>
  );
}

export function VoiceCallModal() {
  const [state, setState] = useState<VoiceCallState>(voiceCallManager.getState());
  const [, setStreamTick] = useState(0);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const isMobile = useMediaQuery('(max-width: 768px)');
  const isVideoCall = state.mediaType === 'video';

  useEffect(() => {
    const unsubscribeState = voiceCallManager.subscribe(setState);
    const unsubscribeStreams = voiceCallManager.onStreamsUpdated(() => {
      setStreamTick((tick) => tick + 1);
    });
    return () => {
      unsubscribeState();
      unsubscribeStreams();
    };
  }, []);

  const localStream = voiceCallManager.getLocalStream();
  const remoteStream = voiceCallManager.getRemoteStream();

  useEffect(() => {
    const localVideo = localVideoRef.current;
    if (localVideo) {
      localVideo.srcObject = localStream ?? null;
      if (localStream) {
        void localVideo.play().catch(() => undefined);
      }
    }

    const remoteVideo = remoteVideoRef.current;
    if (remoteVideo) {
      remoteVideo.srcObject = remoteStream ?? null;
      if (remoteStream) {
        void remoteVideo.play().catch(() => undefined);
      }
    }
  }, [localStream, remoteStream, state.phase, state.hasLocalVideo, state.hasRemoteVideo]);

  if (state.phase === 'idle' || state.phase === 'ended') {
    return null;
  }

  const peerName = state.peer?.displayName ?? 'Contact';
  const status = state.error ?? getStatusLabel(state);
  const showInCallControls =
    state.phase === 'active' || state.phase === 'connecting' || state.phase === 'outgoing';
  const showRemoteVideo = isVideoCall && (state.hasRemoteVideo || state.phase === 'connecting' || state.phase === 'active');
  const showLocalPreview = isVideoCall && state.hasLocalVideo && !state.cameraOff;
  const useVideoOverlayControls = isVideoCall && !isMobile && state.phase !== 'incoming';

  const inCallControls = showInCallControls ? (
    <>
      <CallControl
        label={state.muted ? 'Unmute' : 'Mute'}
        active={state.muted}
        compact={useVideoOverlayControls}
        onClick={() => voiceCallManager.toggleMute()}
      >
        <CallIcon name="mute" />
      </CallControl>

      {isVideoCall && (
        <CallControl
          label={state.cameraOff ? 'Camera on' : 'Camera off'}
          active={state.cameraOff}
          compact={useVideoOverlayControls}
          onClick={() => voiceCallManager.toggleCamera()}
        >
          <CallIcon name="camera" />
        </CallControl>
      )}

      {(state.speakerSupported || isMobile) && (
        <CallControl
          label={state.speakerOn ? 'Speaker on' : 'Speaker off'}
          active={state.speakerOn}
          compact={useVideoOverlayControls}
          onClick={() => void voiceCallManager.toggleSpeaker()}
        >
          <CallIcon name="speaker" />
        </CallControl>
      )}

      {state.audioOutputPickerSupported && (
        <CallControl
          label="Audio"
          compact={useVideoOverlayControls}
          onClick={() => void voiceCallManager.chooseAudioOutput()}
        >
          <CallIcon name="audio" />
        </CallControl>
      )}
    </>
  ) : null;

  return createPortal(
    <div
      className={`voice-call-overlay${isMobile ? ' voice-call-overlay--phone' : ''}${
        isVideoCall ? ' voice-call-overlay--video' : ''
      }`}
      role="dialog"
      aria-label={isVideoCall ? 'Video call' : 'Voice call'}
    >
      <div
        className={`voice-call-card${isMobile ? ' voice-call-card--phone' : ''}${
          isVideoCall ? ' voice-call-card--video' : ''
        }${useVideoOverlayControls ? ' voice-call-card--video-overlay' : ''}`}
      >
        {isVideoCall && (
          <div className="voice-call-video-stage">
            {showRemoteVideo ? (
              <video
                ref={remoteVideoRef}
                className="voice-call-remote-video"
                autoPlay
                playsInline
              />
            ) : (
              <div className="voice-call-video-placeholder">
                <Avatar name={peerName} size="lg" />
              </div>
            )}
            {showLocalPreview && (
              <video
                ref={localVideoRef}
                className="voice-call-local-video"
                autoPlay
                playsInline
                muted
              />
            )}
            {isVideoCall && state.cameraOff && (
              <div className="voice-call-camera-off-badge">Camera off</div>
            )}
            {useVideoOverlayControls && (
              <>
                <div className="voice-call-video-meta">
                  <h3 className="voice-call-name">{peerName}</h3>
                  <p className="voice-call-status">{status}</p>
                </div>
                <div className="voice-call-video-controls">
                  {inCallControls}
                  <CallControl
                    label="End call"
                    danger
                    compact
                    onClick={() => void voiceCallManager.endCall()}
                  >
                    <CallIcon name="end" />
                  </CallControl>
                </div>
              </>
            )}
          </div>
        )}

        {!useVideoOverlayControls && (
          <div className="voice-call-header">
            {!isVideoCall && (
              <div className="voice-call-avatar-wrap">
                <Avatar name={peerName} size="lg" />
              </div>
            )}
            <h3 className="voice-call-name">{peerName}</h3>
            <p className="voice-call-status">{status}</p>
          </div>
        )}

        {state.phase === 'incoming' ? (
          <div className="voice-call-actions voice-call-actions--incoming">
            <CallControl label="Decline" danger onClick={() => void voiceCallManager.rejectCall()}>
              <CallIcon name="reject" />
            </CallControl>
            <CallControl label="Accept" accept onClick={() => void voiceCallManager.acceptCall()}>
              <CallIcon name="accept" />
            </CallControl>
          </div>
        ) : !useVideoOverlayControls ? (
          <div className="voice-call-actions voice-call-actions--in-call">
            {showInCallControls && (
              <div className="voice-call-controls-row">{inCallControls}</div>
            )}

            <CallControl label="End call" danger onClick={() => void voiceCallManager.endCall()}>
              <CallIcon name="end" />
            </CallControl>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
