import { useRef, useState } from 'react';
import { api } from '../services/api';
import { Icon } from './Icon';
import { Button } from './ui/Button';
import { faXmark } from '@fortawesome/free-solid-svg-icons';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export function StoryComposerModal({ open, onClose, onCreated }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  const reset = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(null);
    setPreviewUrl(null);
    setCaption('');
    setError('');
    setBusy(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleFile = (next: File | null) => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(next);
    setPreviewUrl(next ? URL.createObjectURL(next) : null);
    setError('');
  };

  const handleSubmit = async () => {
    if (!file) {
      setError('Choose a photo or video');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.createStory(file, caption);
      reset();
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to post story');
      setBusy(false);
    }
  };

  const isVideo = file?.type.startsWith('video/');

  return (
    <div className="modal-overlay" onClick={handleClose} role="presentation">
      <div
        className="modal story-composer-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Add story"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="story-composer-header">
          <h3>Add story</h3>
          <button type="button" className="icon-btn" onClick={handleClose} aria-label="Close">
            <Icon icon={faXmark} />
          </button>
        </header>

        <div className="story-composer-body">
          {previewUrl ? (
            <div className="story-composer-preview">
              {isVideo ? (
                <video src={previewUrl} controls playsInline />
              ) : (
                <img src={previewUrl} alt="Story preview" />
              )}
            </div>
          ) : (
            <button
              type="button"
              className="story-composer-pick"
              onClick={() => inputRef.current?.click()}
            >
              Choose photo or video
            </button>
          )}

          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,video/mp4,video/webm"
            className="avatar-file-input"
            onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
          />

          <textarea
            className="story-composer-caption"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Add a caption (optional)"
            maxLength={500}
            rows={3}
          />

          {error && <p className="profile-error-inline">{error}</p>}
        </div>

        <footer className="story-composer-footer">
          {file && (
            <Button variant="secondary" onClick={() => inputRef.current?.click()} disabled={busy}>
              Change media
            </Button>
          )}
          <Button variant="primary" onClick={() => void handleSubmit()} disabled={busy || !file}>
            {busy ? 'Posting…' : 'Share story'}
          </Button>
        </footer>
      </div>
    </div>
  );
}
