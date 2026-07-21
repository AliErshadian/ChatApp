import { api } from './api';
import { realtime } from './realtime';
import type {
  CallAcceptedEvent,
  CallEndedEvent,
  CallIncomingEvent,
  CallMediaType,
  CallSignalEvent,
  StartCallOptions,
  VoiceCallPeer,
  VoiceCallState,
} from '../types/voiceCall';
import { INITIAL_VOICE_CALL_STATE } from '../types/voiceCall';
import { getUserCallMediaStream } from '../utils/mediaDevices';
import {
  applySpeakerRoute,
  defaultSpeakerOn,
  isAudioOutputPickerSupported,
  isSpeakerRoutingSupported,
  pickAudioOutputDevice,
} from '../utils/audioOutput';
import {
  getScreenShareStream,
  measureConnectionQuality,
  type ScreenShareSourceKind,
} from '../utils/screenCapture';

type StateListener = (state: VoiceCallState) => void;

function isWebSocketTransport(): boolean {
  return realtime.getTransport() === 'websocket';
}

function stripMediaPurpose(payload: unknown): RTCSessionDescriptionInit {
  if (!payload || typeof payload !== 'object') return payload as RTCSessionDescriptionInit;
  const { mediaPurpose: _mp, ...rest } = payload as RTCSessionDescriptionInit & {
    mediaPurpose?: string;
  };
  return rest;
}

export class VoiceCallManager {
  private state: VoiceCallState = { ...INITIAL_VOICE_CALL_STATE };
  private listeners = new Set<StateListener>();
  private historyRefreshListeners = new Set<() => void>();
  private streamListeners = new Set<() => void>();
  private pc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteAudio: HTMLAudioElement | null = null;
  private remoteStream: MediaStream | null = null;
  private pendingIceCandidates: RTCIceCandidateInit[] = [];
  private remoteDescriptionSet = false;
  private iceServers: RTCIceServer[] | null = null;
  private unsubscribers: Array<() => void> = [];
  private makingOffer = false;
  private ignoreOffer = false;
  private isSettingRemoteAnswerPending = false;
  private screenStream: MediaStream | null = null;
  private screenSender: RTCRtpSender | null = null;
  private qualityTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.bindRealtime();
    this.setState({
      speakerOn: defaultSpeakerOn(),
      speakerSupported: isSpeakerRoutingSupported(),
      audioOutputPickerSupported: isAudioOutputPickerSupported(),
    });
  }

  subscribe(listener: StateListener) {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  onHistoryRefresh(listener: () => void) {
    this.historyRefreshListeners.add(listener);
    return () => {
      this.historyRefreshListeners.delete(listener);
    };
  }

  onStreamsUpdated(listener: () => void) {
    this.streamListeners.add(listener);
    return () => {
      this.streamListeners.delete(listener);
    };
  }

  getLocalStream() {
    return this.localStream;
  }

  getRemoteStream() {
    return this.remoteStream;
  }

  getScreenStream() {
    return this.screenStream;
  }

  async startScreenShare(options: { sourceId?: string; kind?: ScreenShareSourceKind }) {
    if (this.state.phase !== 'active' || !this.pc || !this.state.callId) {
      throw new Error('Screen share requires an active call');
    }
    if (this.state.isSharingScreen) return;

    const stream = await getScreenShareStream({ sourceId: options.sourceId });
    const [track] = stream.getVideoTracks();
    if (!track) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error('No screen track available');
    }

    track.onended = () => {
      void this.stopScreenShare();
    };

    this.screenStream = stream;
    const existingVideoSender = this.pc
      .getSenders()
      .find((s) => s.track?.kind === 'video' && s !== this.screenSender);

    if (existingVideoSender && !this.wantsVideo()) {
      await existingVideoSender.replaceTrack(track);
      this.screenSender = existingVideoSender;
    } else {
      this.screenSender = this.pc.addTrack(track, stream);
    }

    this.setState({
      isSharingScreen: true,
      screenShareStartedAt: Date.now(),
    });
    this.notifyStreamsUpdated();
    await this.sendScreenOffer();
    this.startQualityMonitor();
  }

  async stopScreenShare() {
    if (!this.state.isSharingScreen && !this.screenStream) return;

    if (this.screenSender) {
      try {
        await this.screenSender.replaceTrack(null);
        if (this.pc && this.screenSender.track == null) {
          this.pc.removeTrack(this.screenSender);
        }
      } catch {
        // ignore
      }
      this.screenSender = null;
    }

    if (this.screenStream) {
      this.screenStream.getTracks().forEach((t) => t.stop());
      this.screenStream = null;
    }

    this.setState({
      isSharingScreen: false,
      screenShareStartedAt: null,
    });
    this.notifyStreamsUpdated();

    if (this.state.phase === 'active' && this.pc && this.state.callId) {
      try {
        await this.sendScreenOffer();
      } catch {
        // ignore renegotiation errors while stopping
      }
    }
  }

  private async sendScreenOffer() {
    if (!this.pc || !this.state.callId) return;
    this.makingOffer = true;
    try {
      const offer = await this.pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
      });
      await this.pc.setLocalDescription(offer);
      await realtime.sendCallSignal(this.state.callId, 'offer', {
        ...offer,
        mediaPurpose: 'screen',
      });
    } finally {
      this.makingOffer = false;
    }
  }

  private startQualityMonitor() {
    if (this.qualityTimer) return;
    this.qualityTimer = setInterval(() => {
      if (!this.pc) return;
      void measureConnectionQuality(this.pc).then((q) => {
        this.setState({ connectionQuality: q.level });
      });
    }, 3000);
  }

  private stopQualityMonitor() {
    if (this.qualityTimer) {
      clearInterval(this.qualityTimer);
      this.qualityTimer = null;
    }
  }

  private notifyHistoryRefresh() {
    this.historyRefreshListeners.forEach((listener) => listener());
  }

  private notifyStreamsUpdated() {
    this.streamListeners.forEach((listener) => listener());
  }

  private wantsVideo(): boolean {
    return this.state.mediaType === 'video';
  }

  private updateMediaTrackFlags() {
    this.setState({
      hasLocalVideo: Boolean(this.localStream?.getVideoTracks().some((track) => track.readyState === 'live')),
      hasRemoteVideo: Boolean(this.remoteStream?.getVideoTracks().some((track) => track.readyState === 'live')),
    });
    this.notifyStreamsUpdated();
  }

  getState() {
    return this.state;
  }

  private setState(patch: Partial<VoiceCallState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener(this.state));
  }

  private bindRealtime() {
    this.unsubscribers.push(
      realtime.onCallIncoming((data) => void this.handleIncoming(data)),
      realtime.onCallAccepted((data) => void this.handleAccepted(data)),
      realtime.onCallEnded((data) => void this.handleEnded(data)),
      realtime.onCallSignal((data) => void this.handleSignal(data)),
    );
  }

  dispose() {
    this.unsubscribers.forEach((unsub) => unsub());
    this.unsubscribers = [];
    this.cleanupPeerConnection();
  }

  async startCall(conversationId: string, peer: VoiceCallPeer, options: StartCallOptions = {}) {
    if (this.state.phase !== 'idle') {
      throw new Error('Already in a call');
    }
    if (!isWebSocketTransport()) {
      throw new Error('Calls require a live WebSocket connection');
    }

    const mediaType: CallMediaType = options.video ? 'video' : 'audio';

    this.setState({
      phase: 'outgoing',
      conversationId,
      peer,
      role: 'caller',
      mediaType,
      error: null,
      endReason: null,
      muted: false,
      cameraOff: false,
      speakerOn: defaultSpeakerOn(),
      hasLocalVideo: false,
      hasRemoteVideo: false,
    });

    try {
      await this.ensureLocalMedia(mediaType === 'video');
      const result = await realtime.inviteCall(conversationId, { video: mediaType === 'video' });
      this.setState({ callId: result.callId, phase: 'connecting' });
    } catch (error) {
      this.cleanupPeerConnection();
      this.setState({
        ...INITIAL_VOICE_CALL_STATE,
        error: error instanceof Error ? error.message : 'Failed to start call',
        endReason: 'error',
      });
      throw error;
    }
  }

  async acceptCall() {
    if (this.state.phase !== 'incoming' || !this.state.callId) {
      return;
    }

    if (!isWebSocketTransport()) {
      this.setState({ error: 'Calls require a live WebSocket connection' });
      return;
    }

    this.setState({ phase: 'connecting', error: null });

    try {
      await this.ensureLocalMedia(this.wantsVideo());
      await realtime.acceptCall(this.state.callId);
    } catch (error) {
      this.cleanupPeerConnection();
      this.setState({
        ...INITIAL_VOICE_CALL_STATE,
        error: error instanceof Error ? error.message : 'Failed to accept call',
        endReason: 'error',
      });
    }
  }

  async rejectCall() {
    if (!this.state.callId || this.state.phase !== 'incoming') return;
    try {
      await realtime.rejectCall(this.state.callId);
    } catch {
      // Server may already have ended the call.
    }
    this.cleanupPeerConnection();
    this.setState({ ...INITIAL_VOICE_CALL_STATE, endReason: 'rejected' });
    this.notifyHistoryRefresh();
  }

  async endCall() {
    if (!this.state.callId) {
      this.cleanupPeerConnection();
      this.setState({ ...INITIAL_VOICE_CALL_STATE });
      return;
    }

    const callId = this.state.callId;
    try {
      await realtime.endCall(callId);
    } catch {
      // Local cleanup still runs on call:ended or below.
    }
    this.cleanupPeerConnection();
    this.setState({ ...INITIAL_VOICE_CALL_STATE, endReason: 'ended' });
    this.notifyHistoryRefresh();
  }

  toggleMute() {
    if (!this.localStream) return;
    const enabled = this.localStream.getAudioTracks()[0]?.enabled ?? true;
    this.localStream.getAudioTracks().forEach((track) => {
      track.enabled = !enabled;
    });
    this.setState({ muted: enabled });
  }

  toggleCamera() {
    if (!this.localStream || !this.wantsVideo()) return;
    const enabled = this.localStream.getVideoTracks()[0]?.enabled ?? true;
    this.localStream.getVideoTracks().forEach((track) => {
      track.enabled = !enabled;
    });
    this.setState({ cameraOff: enabled });
    this.updateMediaTrackFlags();
  }

  async toggleSpeaker() {
    const speakerOn = !this.state.speakerOn;
    this.setState({ speakerOn });
    if (this.remoteAudio) {
      await applySpeakerRoute(this.remoteAudio, speakerOn);
    }
  }

  async chooseAudioOutput() {
    if (!this.remoteAudio) return;
    const selected = await pickAudioOutputDevice(this.remoteAudio);
    if (selected) {
      this.setState({ speakerOn: true });
    }
  }

  private async handleIncoming(data: CallIncomingEvent) {
    if (this.state.phase !== 'idle') {
      try {
        await realtime.rejectCall(data.callId);
      } catch {
        // ignore
      }
      return;
    }

    this.setState({
      phase: 'incoming',
      callId: data.callId,
      conversationId: data.conversationId,
      peer: data.caller,
      role: 'callee',
      mediaType: data.mediaType === 'video' ? 'video' : 'audio',
      error: null,
      endReason: null,
      muted: false,
      cameraOff: false,
      speakerOn: defaultSpeakerOn(),
      hasLocalVideo: false,
      hasRemoteVideo: false,
    });
  }

  private async handleAccepted(data: CallAcceptedEvent) {
    if (this.state.callId !== data.callId || this.state.role !== 'caller') return;
    await this.createPeerConnection();
    await this.sendOffer();
  }

  private async handleEnded(data: CallEndedEvent) {
    if (this.state.callId && this.state.callId !== data.callId) return;
    this.cleanupPeerConnection();
    this.setState({
      ...INITIAL_VOICE_CALL_STATE,
      endReason: data.reason,
    });
    this.notifyHistoryRefresh();
  }

  private async handleSignal(data: CallSignalEvent) {
    if (!this.state.callId || data.callId !== this.state.callId) return;

    if (data.type === 'offer') {
      await this.handleOffer(stripMediaPurpose(data.payload), data.payload);
      return;
    }

    if (data.type === 'answer') {
      await this.handleAnswer(stripMediaPurpose(data.payload));
      return;
    }

    if (data.type === 'ice') {
      await this.handleIceCandidate(data.payload as RTCIceCandidateInit);
    }
  }

  private async handleOffer(offer: RTCSessionDescriptionInit, rawPayload?: unknown) {
    if (!offer) return;

    const isScreen =
      rawPayload &&
      typeof rawPayload === 'object' &&
      (rawPayload as { mediaPurpose?: string }).mediaPurpose === 'screen';

    if (this.state.role === 'caller' && !isScreen) {
      if (this.makingOffer || this.pc?.signalingState !== 'stable') {
        this.ignoreOffer = true;
        return;
      }
    }

    await this.createPeerConnection();

    if (!this.pc) return;

    try {
      await this.pc.setRemoteDescription(offer);
      this.remoteDescriptionSet = true;
      await this.flushPendingIceCandidates();
      const answer = await this.pc.createAnswer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
      });
      await this.pc.setLocalDescription(answer);
      if (this.state.callId && answer) {
        await realtime.sendCallSignal(
          this.state.callId,
          'answer',
          isScreen ? { ...answer, mediaPurpose: 'screen' } : answer,
        );
      }
      if (isScreen) {
        this.setState({ remoteScreenActive: true });
        this.startQualityMonitor();
      }
    } catch (error) {
      this.failCall(error);
    }
  }

  private async handleAnswer(answer: RTCSessionDescriptionInit) {
    if (!this.pc || !answer) return;
    if (this.isSettingRemoteAnswerPending) return;

    try {
      this.isSettingRemoteAnswerPending = true;
      await this.pc.setRemoteDescription(answer);
      this.remoteDescriptionSet = true;
      await this.flushPendingIceCandidates();
      this.setState({ phase: 'active' });
    } catch (error) {
      this.failCall(error);
    } finally {
      this.isSettingRemoteAnswerPending = false;
    }
  }

  private async handleIceCandidate(candidate: RTCIceCandidateInit) {
    if (!candidate) return;

    if (!this.pc || !this.remoteDescriptionSet || !this.pc.remoteDescription) {
      this.pendingIceCandidates.push(candidate);
      return;
    }

    try {
      await this.pc.addIceCandidate(candidate);
    } catch {
      // Trickle ICE can race with remote description; safe to ignore occasional failures.
    }
  }

  private async flushPendingIceCandidates() {
    if (!this.pc || !this.remoteDescriptionSet) return;

    const pending = this.pendingIceCandidates;
    this.pendingIceCandidates = [];

    for (const candidate of pending) {
      try {
        await this.pc.addIceCandidate(candidate);
      } catch {
        // Ignore stale or duplicate candidates.
      }
    }
  }

  private async sendOffer() {
    if (!this.pc || !this.state.callId) return;

    try {
      this.makingOffer = true;
      const offer = await this.pc.createOffer(this.getSdpOptions());
      await this.pc.setLocalDescription(offer);
      await realtime.sendCallSignal(this.state.callId, 'offer', offer);
    } catch (error) {
      this.failCall(error);
    } finally {
      this.makingOffer = false;
    }
  }

  private async createPeerConnection() {
    if (this.pc) return;

    const iceServers = await this.getIceServers();
    const pc = new RTCPeerConnection({ iceServers });

    pc.onicecandidate = (event) => {
      if (!event.candidate || !this.state.callId) return;
      void realtime.sendCallSignal(this.state.callId, 'ice', event.candidate.toJSON());
    };

    pc.ontrack = (event) => {
      this.attachRemoteTrack(event);
    };

    pc.oniceconnectionstatechange = () => {
      if (!this.pc) return;
      if (this.pc.iceConnectionState === 'connected' || this.pc.iceConnectionState === 'completed') {
        this.setState({ phase: 'active' });
      }
      if (this.pc.iceConnectionState === 'failed') {
        void this.endCall();
      }
    };

    pc.onconnectionstatechange = () => {
      if (!this.pc) return;
      if (this.pc.connectionState === 'failed' || this.pc.connectionState === 'disconnected') {
        void this.endCall();
      }
    };

    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        if (track.readyState === 'live') {
          pc.addTrack(track, this.localStream!);
        }
      });
    } else {
      pc.addTransceiver('audio', { direction: 'recvonly' });
    }

    if (this.wantsVideo() && !this.localStream?.getVideoTracks().length) {
      pc.addTransceiver('video', { direction: 'recvonly' });
    }

    this.pc = pc;
  }

  private getSdpOptions(): RTCOfferOptions {
    return {
      offerToReceiveAudio: true,
      offerToReceiveVideo: this.wantsVideo() || this.state.isSharingScreen || this.state.remoteScreenActive,
    };
  }

  private attachRemoteTrack(event: RTCTrackEvent) {
    if (!this.remoteStream) {
      this.remoteStream = new MediaStream();
    }

    const hasTrack = this.remoteStream
      .getTracks()
      .some((track) => track.id === event.track.id);
    if (!hasTrack) {
      this.remoteStream.addTrack(event.track);
      event.track.onunmute = () => {
        void this.playRemoteAudio(this.remoteStream!);
      };
    }

    void this.playRemoteAudio(this.remoteStream);
    this.updateMediaTrackFlags();
    this.setState({ phase: 'active' });
  }

  private async playRemoteAudio(stream: MediaStream) {
    if (!this.remoteAudio) {
      this.remoteAudio = document.createElement('audio');
      this.remoteAudio.autoplay = true;
      this.remoteAudio.setAttribute('playsinline', 'true');
      this.remoteAudio.volume = 1;
      this.remoteAudio.muted = false;
      this.remoteAudio.style.display = 'none';
      document.body.appendChild(this.remoteAudio);
    }

    this.remoteAudio.srcObject = stream;

    try {
      await this.remoteAudio.play();
      await applySpeakerRoute(this.remoteAudio, this.state.speakerOn);
    } catch {
      window.setTimeout(() => {
        void this.remoteAudio?.play().catch(() => undefined);
      }, 300);
    }
  }

  private async ensureLocalMedia(withVideo: boolean) {
    if (this.localStream) {
      const hasVideo = this.localStream.getVideoTracks().length > 0;
      if (withVideo === hasVideo) {
        this.updateMediaTrackFlags();
        return;
      }
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }

    const stream = await getUserCallMediaStream({ video: withVideo });
    const [audioTrack] = stream.getAudioTracks();
    if (!audioTrack || audioTrack.readyState !== 'live') {
      stream.getTracks().forEach((activeTrack) => activeTrack.stop());
      throw new Error(withVideo ? 'Camera and microphone are not available' : 'Microphone is not available');
    }
    audioTrack.enabled = true;
    stream.getVideoTracks().forEach((track) => {
      track.enabled = true;
    });
    this.localStream = stream;
    this.setState({ muted: false, cameraOff: false });
    this.updateMediaTrackFlags();
  }

  private async getIceServers(): Promise<RTCIceServer[]> {
    if (this.iceServers) return this.iceServers;
    const result = await api.getCallIceServers();
    this.iceServers = result.iceServers;
    return this.iceServers;
  }

  private failCall(error: unknown) {
    const message = error instanceof Error ? error.message : 'Call failed';
    void this.endCall();
    this.setState({
      ...INITIAL_VOICE_CALL_STATE,
      error: message,
      endReason: 'error',
    });
  }

  private cleanupPeerConnection() {
    this.stopQualityMonitor();
    if (this.screenStream) {
      this.screenStream.getTracks().forEach((track) => track.stop());
      this.screenStream = null;
    }
    this.screenSender = null;

    this.pc?.close();
    this.pc = null;
    this.makingOffer = false;
    this.ignoreOffer = false;
    this.isSettingRemoteAnswerPending = false;
    this.remoteDescriptionSet = false;
    this.pendingIceCandidates = [];

    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }

    if (this.remoteStream) {
      this.remoteStream.getTracks().forEach((track) => track.stop());
      this.remoteStream = null;
    }

    if (this.remoteAudio) {
      this.remoteAudio.pause();
      this.remoteAudio.srcObject = null;
      this.remoteAudio.remove();
      this.remoteAudio = null;
    }

    this.setState({
      hasLocalVideo: false,
      hasRemoteVideo: false,
      isSharingScreen: false,
      remoteScreenActive: false,
      screenShareStartedAt: null,
      connectionQuality: 'unknown',
    });
    this.notifyStreamsUpdated();
  }
}

export const voiceCallManager = new VoiceCallManager();
