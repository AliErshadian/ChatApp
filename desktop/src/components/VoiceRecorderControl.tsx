import { useCallback } from 'react';
import { useVoiceRecorder, VoiceRecordingResult } from '../hooks/useVoiceRecorder';
import { VoiceRecordingTimer, VoiceWaveform } from './VoiceWaveform';

interface Props {
  disabled?: boolean;
  onSend: (result: VoiceRecordingResult) => void | Promise<void>;
  onError?: (message: string) => void;
  onRecordingChange?: (recording: boolean) => void;
}

function MicIcon() {
  return (
    <svg className="composer-mic-icon" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V20H9v2h6v-2h-2v-2.08A7 7 0 0 0 19 11h-2Z"
      />
    </svg>
  );
}

export function VoiceRecorderControl({ disabled, onSend, onError, onRecordingChange }: Props) {
  const handleAutoSend = useCallback(
    (result: VoiceRecordingResult) => {
      void onSend(result);
    },
    [onSend],
  );

  const recorder = useVoiceRecorder({ onRecordingChange, onAutoSend: handleAutoSend });

  const handleStart = async () => {
    if (disabled || recorder.processing || recorder.phase !== 'idle') return;
    try {
      await recorder.startRecording();
    } catch (error) {
      onError?.(error instanceof Error ? error.message : 'Could not start recording');
    }
  };

  if (recorder.phase === 'recording') {
    return (
      <div className="voice-recorder-panel">
        <button
          type="button"
          className="voice-recorder-discard"
          onClick={() => void recorder.cancelRecording()}
          aria-label="Discard recording"
          title="Discard"
        >
          <svg viewBox="0 0 24 24" aria-hidden>
            <path
              fill="currentColor"
              d="M6 7h12l-1.2 13.2a2 2 0 0 1-2 1.8H9.2a2 2 0 0 1-2-1.8L6 7Zm3-3h6l1 2H8l1-2Z"
            />
          </svg>
        </button>

        <div className="voice-recorder-panel-main">
          <div className="voice-recorder-panel-status">
            <span className="voice-recorder-dot" aria-hidden />
            <VoiceRecordingTimer elapsedMs={recorder.elapsedMs} />
            <span className="voice-recorder-label">Recording</span>
          </div>
          <VoiceWaveform peaks={recorder.livePeaks} variant="live" active />
        </div>

        <button
          type="button"
          className="voice-recorder-finish"
          disabled={recorder.processing || recorder.elapsedMs < 500}
          onClick={() => {
            void recorder.stopAndSend().then((result) => {
              if (result) void onSend(result);
            });
          }}
          aria-label="Send voice message"
          title="Send"
        >
          <svg viewBox="0 0 24 24" aria-hidden>
            <path fill="currentColor" d="m3 11 16-7v4.5A6.5 6.5 0 0 1 12.5 15 6.5 6.5 0 0 1 6 8.5V11l-3-1.5Z" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      className="composer-mic-btn"
      disabled={disabled || recorder.processing}
      onClick={() => void handleStart()}
      aria-label="Record voice message"
      title="Record voice message"
    >
      <MicIcon />
    </button>
  );
}
