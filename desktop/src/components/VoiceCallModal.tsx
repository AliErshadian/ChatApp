import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { voiceCallManager } from '../services/voiceCall';
import type { VoiceCallState } from '../types/voiceCall';
import { useMediaQuery } from '../hooks/useMediaQuery';
import {
  faMicrophoneSlash,
  faPhone,
  faPhoneSlash,
  faVideo,
  faVideoSlash,
  faVolumeHigh,
  faVolumeLow,
} from '@fortawesome/free-solid-svg-icons';

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
  name: 'mute' | 'speaker' | 'audio' | 'camera' | 'camera-off' | 'end' | 'accept' | 'reject';
}) {
  switch (name) {
    case 'mute':
      return <Icon icon={faMicrophoneSlash} />;
    case 'camera':
      return <Icon icon={faVideo} />;
    case 'camera-off':
      return <Icon icon={faVideoSlash} />;
    case 'speaker':
      return <Icon icon={faVolumeHigh} />;
    case 'audio':
      return <Icon icon={faVolumeLow} />;
    case 'end':
    case 'reject':
      return <Icon icon={faPhoneSlash} />;
    case 'accept':
      return <Icon icon={faPhone} />;
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
          <CallIcon name={state.cameraOff ? 'camera-off' : 'camera'} />
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
