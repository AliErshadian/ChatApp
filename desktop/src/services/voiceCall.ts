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

type StateListener = (state: VoiceCallState) => void;

function isWebSocketTransport(): boolean {
  return realtime.getTransport() === 'websocket';
}

export class VoiceCallManager {
  private state: VoiceCallState = { ...INITIAL_VOICE_CALL_STATE };
  private listeners = new Set<StateListener>();
  private pc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteAudio: HTMLAudioElement | null = null;
  private iceServers: RTCIceServer[] | null = null;
  private unsubscribers: Array<() => void> = [];
  private makingOffer = false;
  private ignoreOffer = false;
  private isSettingRemoteAnswerPending = false;

  constructor() {
    this.bindRealtime();
  }

  subscribe(listener: StateListener) {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
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
  }

  toggleMute() {
    if (!this.localStream) return;
    const enabled = this.localStream.getAudioTracks()[0]?.enabled ?? true;
    this.localStream.getAudioTracks().forEach((track) => {
      track.enabled = !enabled;
    });
    this.setState({ muted: enabled });
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
      if (this.state.role === 'callee') {
        const answer = await this.pc.createAnswer();
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
      this.setState({ phase: 'active' });
    } catch (error) {
      this.failCall(error);
    } finally {
      this.isSettingRemoteAnswerPending = false;
    }
  }

  private async handleIceCandidate(candidate: RTCIceCandidateInit) {
    if (!this.pc || !candidate) return;
    try {
      await this.pc.addIceCandidate(candidate);
    } catch {
      // Trickle ICE can race with remote description; safe to ignore occasional failures.
    }
  }

  private async sendOffer() {
    if (!this.pc || !this.state.callId) return;

    try {
      this.makingOffer = true;
      const offer = await this.pc.createOffer();
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
      const [stream] = event.streams;
      if (!stream) return;
      if (!this.remoteAudio) {
        this.remoteAudio = new Audio();
        this.remoteAudio.autoplay = true;
      }
      this.remoteAudio.srcObject = stream;
      void this.remoteAudio.play().catch(() => undefined);
      this.setState({ phase: 'active' });
    };

    pc.onconnectionstatechange = () => {
      if (!this.pc) return;
      if (this.pc.connectionState === 'failed' || this.pc.connectionState === 'disconnected') {
        void this.endCall();
      }
    };

    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        pc.addTrack(track, this.localStream!);
      });
    }

    this.pc = pc;
  }

  private async ensureLocalAudio() {
    if (this.localStream) return;
    const stream = await getUserAudioStream();
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

    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }

    if (this.remoteAudio) {
      this.remoteAudio.pause();
      this.remoteAudio.srcObject = null;
      this.remoteAudio = null;
    }
  }
}

export const voiceCallManager = new VoiceCallManager();
