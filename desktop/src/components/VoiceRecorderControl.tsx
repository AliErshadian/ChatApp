import { useCallback } from 'react';
import { useVoiceRecorder, VoiceRecordingResult } from '../hooks/useVoiceRecorder';
import { VoiceRecordingTimer, VoiceWaveform } from './VoiceWaveform';
import { Icon } from './Icon';
import { faMicrophone, faPaperPlane, faTrashCan } from '@fortawesome/free-solid-svg-icons';

interface Props {
  disabled?: boolean;
  onSend: (result: VoiceRecordingResult) => void | Promise<void>;
  onError?: (message: string) => void;
  onRecordingChange?: (recording: boolean) => void;
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
          <Icon icon={faTrashCan} />
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
          <Icon icon={faPaperPlane} />
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
      <Icon icon={faMicrophone} className="composer-mic-icon" />
    </button>
  );
}
