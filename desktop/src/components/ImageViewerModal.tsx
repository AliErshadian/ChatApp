import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { downloadMedia } from '../utils/downloadMedia';

interface Props {
  open: boolean;
  src: string;
  alt?: string;
  fileName?: string;
  onClose: () => void;
}

export function ImageViewerModal({ open, src, alt, fileName, onClose }: Props) {
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  const downloadName = fileName?.trim() || 'image';

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
        <img src={src} alt={alt ?? downloadName} className="media-viewer-image" />
      </div>
    </div>,
    document.body,
  );
}
