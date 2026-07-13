import { api } from './api';
import { realtime } from './realtime';
import type {
  CallAcceptedEvent,
  CallEndedEvent,
  CallIncomingEvent,
  CallSignalEvent,
  VoiceCallPeer,
  VoiceCallState,
} from '../types/voiceCall';
import { INITIAL_VOICE_CALL_STATE } from '../types/voiceCall';
import { getUserAudioStream } from '../utils/mediaDevices';
import {
  applySpeakerRoute,
  defaultSpeakerOn,
  isAudioOutputPickerSupported,
  isSpeakerRoutingSupported,
  pickAudioOutputDevice,
} from '../utils/audioOutput';

type StateListener = (state: VoiceCallState) => void;

function isWebSocketTransport(): boolean {
  return realtime.getTransport() === 'websocket';
}

export class VoiceCallManager {
  private state: VoiceCallState = { ...INITIAL_VOICE_CALL_STATE };
  private listeners = new Set<StateListener>();
  private historyRefreshListeners = new Set<() => void>();
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

  private notifyHistoryRefresh() {
    this.historyRefreshListeners.forEach((listener) => listener());
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

  async startCall(conversationId: string, peer: VoiceCallPeer) {
    if (this.state.phase !== 'idle') {
      throw new Error('Already in a call');
    }
    if (!isWebSocketTransport()) {
      throw new Error('Voice calls require a live WebSocket connection');
    }

    this.setState({
      phase: 'outgoing',
      conversationId,
      peer,
      role: 'caller',
      error: null,
      endReason: null,
      muted: false,
      speakerOn: defaultSpeakerOn(),
    });

    try {
      await this.ensureLocalAudio();
      const result = await realtime.inviteCall(conversationId);
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
      this.setState({ error: 'Voice calls require a live WebSocket connection' });
      return;
    }

    this.setState({ phase: 'connecting', error: null });

    try {
      await this.ensureLocalAudio();
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
      error: null,
      endReason: null,
      muted: false,
      speakerOn: defaultSpeakerOn(),
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
      await this.handleOffer(data.payload as RTCSessionDescriptionInit);
      return;
    }

    if (data.type === 'answer') {
      await this.handleAnswer(data.payload as RTCSessionDescriptionInit);
      return;
    }

    if (data.type === 'ice') {
      await this.handleIceCandidate(data.payload as RTCIceCandidateInit);
    }
  }

  private async handleOffer(offer: RTCSessionDescriptionInit) {
    if (!offer) return;

    if (this.state.role === 'caller') {
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
      if (this.state.role === 'callee') {
        const answer = await this.pc.createAnswer({ offerToReceiveAudio: true });
        await this.pc.setLocalDescription(answer);
        if (this.state.callId && answer) {
          await realtime.sendCallSignal(this.state.callId, 'answer', answer);
        }
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
      const offer = await this.pc.createOffer({ offerToReceiveAudio: true });
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

    this.pc = pc;
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

  private async ensureLocalAudio() {
    if (this.localStream) return;
    const stream = await getUserAudioStream();
    const [track] = stream.getAudioTracks();
    if (!track || track.readyState !== 'live') {
      stream.getTracks().forEach((activeTrack) => activeTrack.stop());
      throw new Error('Microphone is not available');
    }
    track.enabled = true;
    this.localStream = stream;
    this.setState({ muted: false });
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
  }
}

export const voiceCallManager = new VoiceCallManager();
