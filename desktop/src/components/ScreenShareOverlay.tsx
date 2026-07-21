import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import {
  faCompress,
  faDesktop,
  faExpand,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';
import { screenShareManager, type ScreenShareSessionState } from '../services/screenShare';
import { formatShareDuration } from '../utils/screenCapture';

export function ScreenShareOverlay() {
  const [state, setState] = useState<ScreenShareSessionState>(screenShareManager.getState());
  const [now, setNow] = useState(Date.now());
  const [fullscreen, setFullscreen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [fit, setFit] = useState<'contain' | 'cover'>('contain');
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => screenShareManager.subscribe(setState) as () => void, []);

  useEffect(() => {
    if (state.phase === 'idle' || state.phase === 'ended') return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [state.phase]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const stream = state.isLocalPresenter
      ? screenShareManager.getLocalScreenStream()
      : state.remoteStream;
    if (video.srcObject !== stream) {
      video.srcObject = stream ?? null;
    }
    if (stream) {
      // Always mute for autoplay; screen share is video-only.
      video.muted = true;
      void video.play().catch(() => undefined);
    }
  }, [state.remoteStream, state.isLocalPresenter, state.presenting]);

  if (state.phase === 'idle' || state.phase === 'ended' || !state.sessionId) {
    return null;
  }

  if (!state.presenting && !state.isLocalPresenter && !state.remoteStream) {
    return null;
  }

  const timer = state.startedAt ? formatShareDuration(state.startedAt, now) : '00:00';
  const presenterName = state.presenter?.displayName ?? 'Presenter';

  const toggleFullscreen = async () => {
    const el = stageRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      await el.requestFullscreen().catch(() => undefined);
      setFullscreen(true);
    } else {
      await document.exitFullscreen().catch(() => undefined);
      setFullscreen(false);
    }
  };

  return createPortal(
    <div className="screen-share-overlay" role="dialog" aria-label="Screen share">
      <div className="screen-share-card" ref={stageRef}>
        <header className="screen-share-header">
          <div>
            <strong>
              <Icon icon={faDesktop} /> {presenterName}
            </strong>
            <span className="screen-share-meta">
              {timer} · {state.viewerCount} viewer{state.viewerCount === 1 ? '' : 's'} ·{' '}
              {state.connectionQuality}
            </span>
          </div>
          <div className="screen-share-header-actions">
            <button type="button" className="icon-btn" onClick={() => setFit((f) => (f === 'contain' ? 'cover' : 'contain'))} title="Fit">
              Fit
            </button>
            <button
              type="button"
              className="icon-btn"
              onClick={() => setZoom((z) => Math.min(2, z + 0.25))}
              title="Zoom in"
            >
              +
            </button>
            <button
              type="button"
              className="icon-btn"
              onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
              title="Zoom out"
            >
              −
            </button>
            <button type="button" className="icon-btn" onClick={() => void toggleFullscreen()} title="Fullscreen">
              <Icon icon={fullscreen ? faCompress : faExpand} />
            </button>
            <button
              type="button"
              className="icon-btn"
              onClick={() => void (state.isLocalPresenter ? screenShareManager.stopSharing() : screenShareManager.leave())}
              title={state.isLocalPresenter ? 'Stop sharing' : 'Leave'}
            >
              <Icon icon={faXmark} />
            </button>
          </div>
        </header>
        <div className={`screen-share-stage screen-share-stage--${fit}`}>
          <video
            ref={videoRef}
            className="screen-share-video"
            style={{ transform: `scale(${zoom})` }}
            autoPlay
            playsInline
            muted
          />
        </div>
        {state.isLocalPresenter && (
          <div className="screen-share-presenter-bar">You are sharing your screen · {timer}</div>
        )}
      </div>
    </div>,
    document.body,
  );
}
