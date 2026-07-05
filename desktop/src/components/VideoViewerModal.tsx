import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { downloadMedia } from '../utils/downloadMedia';

interface Props {
  open: boolean;
  src: string;
  fileName?: string;
  onClose: () => void;
}

export function VideoViewerModal({ open, src, fileName, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);

    const video = videoRef.current;
    void video?.play().catch(() => {});

    return () => {
      video?.pause();
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose, src]);

  if (!open) return null;

  const downloadName = fileName?.trim() || 'video';

  return createPortal(
    <div className="media-viewer-overlay" onClick={onClose} role="presentation">
      <div className="media-viewer-toolbar" onClick={(e) => e.stopPropagation()}>
        <span className="media-viewer-title">{downloadName}</span>
        <div className="media-viewer-actions">
          <button
            type="button"
            className="media-viewer-btn"
            onClick={() => {
              void downloadMedia(src, downloadName).catch(() => {
                window.open(src, '_blank', 'noopener,noreferrer');
              });
            }}
          >
            Download
          </button>
          <button type="button" className="media-viewer-btn" onClick={onClose} aria-label="Close">
            Close
          </button>
        </div>
      </div>
      <div className="media-viewer-stage" onClick={(e) => e.stopPropagation()}>
        <video
          ref={videoRef}
          src={src}
          controls
          autoPlay
          playsInline
          className="media-viewer-video"
          preload="auto"
        />
      </div>
    </div>,
    document.body,
  );
}
