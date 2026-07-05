import { useEffect } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  open: boolean;
  src: string;
  alt?: string;
  fileName?: string;
  onClose: () => void;
}

async function downloadImage(url: string, fileName: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Download failed');

  const blob = await response.blob();
  const blobUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = blobUrl;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(blobUrl);
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
    <div className="image-viewer-overlay" onClick={onClose} role="presentation">
      <div className="image-viewer-toolbar" onClick={(e) => e.stopPropagation()}>
        <span className="image-viewer-title">{downloadName}</span>
        <div className="image-viewer-actions">
          <button
            type="button"
            className="image-viewer-btn"
            onClick={() => {
              void downloadImage(src, downloadName).catch(() => {
                window.open(src, '_blank', 'noopener,noreferrer');
              });
            }}
          >
            Download
          </button>
          <button type="button" className="image-viewer-btn" onClick={onClose} aria-label="Close">
            Close
          </button>
        </div>
      </div>
      <div className="image-viewer-stage" onClick={(e) => e.stopPropagation()}>
        <img src={src} alt={alt ?? downloadName} className="image-viewer-image" />
      </div>
    </div>,
    document.body,
  );
}
