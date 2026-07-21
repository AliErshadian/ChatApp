import { api } from './api';
import { realtime } from './realtime';
import {
  getScreenShareStream,
  measureConnectionQuality,
  type ConnectionQualityLevel,
  type ScreenShareSourceKind,
} from '../utils/screenCapture';

export interface ScreenShareParticipant {
  id: string;
  displayName: string;
  username: string;
}

export interface ScreenShareSessionState {
  phase: 'idle' | 'hosting' | 'viewing' | 'ended';
  sessionId: string | null;
  conversationId: string | null;
  presenting: boolean;
  isLocalPresenter: boolean;
  presenter: ScreenShareParticipant | null;
  participants: ScreenShareParticipant[];
  viewerCount: number;
  screenSource: ScreenShareSourceKind | null;
  startedAt: number | null;
  connectionQuality: ConnectionQualityLevel;
  error: string | null;
  remoteStream: MediaStream | null;
}

const INITIAL: ScreenShareSessionState = {
  phase: 'idle',
  sessionId: null,
  conversationId: null,
  presenting: false,
  isLocalPresenter: false,
  presenter: null,
  participants: [],
  viewerCount: 0,
  screenSource: null,
  startedAt: null,
  connectionQuality: 'unknown',
  error: null,
  remoteStream: null,
};

type Listener = (state: ScreenShareSessionState) => void;

export class ScreenShareManager {
  private state: ScreenShareSessionState = { ...INITIAL };
  private listeners = new Set<Listener>();
  private peers = new Map<string, RTCPeerConnection>();
  private pendingIce = new Map<string, RTCIceCandidateInit[]>();
  private localUserId: string | null = null;
  private screenStream: MediaStream | null = null;
  private iceServers: RTCIceServer[] | null = null;
  private unsubscribers: Array<() => void> = [];
  private qualityTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.unsubscribers.push(
      realtime.onScreenSessionEvent((raw) => void this.handleSessionEvent(raw)),
      realtime.onWebrtcSignal((raw) => void this.handleWebrtc(raw)),
    );
  }

  setLocalUserId(userId: string | null) {
    this.localUserId = userId;
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  getState() {
    return this.state;
  }

  getLocalScreenStream() {
    return this.screenStream;
  }

  private setState(patch: Partial<ScreenShareSessionState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l(this.state));
  }

  private applySessionPayload(payload: Record<string, unknown>, phase?: ScreenShareSessionState['phase']) {
    const presenter = payload.presenter as ScreenShareParticipant | null;
    const participants = (payload.participants as ScreenShareParticipant[]) ?? [];
    this.setState({
      sessionId: (payload.sessionId as string) ?? this.state.sessionId,
      conversationId: (payload.conversationId as string) ?? this.state.conversationId,
      presenting: Boolean(payload.presenting),
      presenter,
      participants,
      viewerCount: Number(payload.viewerCount ?? 0),
      screenSource: (payload.screenSource as ScreenShareSourceKind | null) ?? null,
      isLocalPresenter: Boolean(presenter && presenter.id === this.localUserId),
      phase:
        phase ??
        (presenter && presenter.id === this.localUserId
          ? 'hosting'
          : this.state.phase === 'idle'
            ? 'viewing'
            : this.state.phase),
      startedAt: this.state.startedAt ?? Date.now(),
    });
  }

  async startAsHost(
    conversationId: string,
    options: { sourceId?: string; kind?: ScreenShareSourceKind },
  ) {
    if (realtime.getTransport() !== 'websocket') {
      throw new Error('Screen sharing requires a WebSocket connection');
    }

    const created = await realtime.createScreenShare(conversationId);
    this.applySessionPayload(created, 'hosting');

    const stream = await getScreenShareStream({ sourceId: options.sourceId });
    const [track] = stream.getVideoTracks();
    if (!track) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error('No screen track');
    }
    track.onended = () => {
      void this.stopSharing();
    };
    this.screenStream = stream;

    await realtime.startScreenShareSession(
      this.state.sessionId!,
      options.kind ?? 'screen',
    );
    this.setState({
      presenting: true,
      isLocalPresenter: true,
      screenSource: options.kind ?? 'screen',
      startedAt: Date.now(),
      phase: 'hosting',
    });
    this.startQualityMonitor();

    // Offer to existing participants once they join; mesh offers created on participant:joined
  }

  async joinSession(sessionId: string) {
    const joined = await realtime.joinScreenShare(sessionId);
    this.applySessionPayload(joined, 'viewing');
    const presenterId = this.state.presenter?.id;
    if (presenterId && presenterId !== this.localUserId) {
      // Viewers only receive — the presenter creates the offer with the screen track.
      // Offering from here produces an empty SDP and yields a black screen.
      await this.ensurePeer(presenterId, false);
    }
    this.startQualityMonitor();
  }

  async stopSharing() {
    if (this.state.sessionId && this.state.isLocalPresenter) {
      try {
        await realtime.stopScreenShareSession(this.state.sessionId);
      } catch {
        // continue cleanup
      }
    }
    await this.leave();
  }

  async leave() {
    const sessionId = this.state.sessionId;
    this.cleanupPeers();
    if (this.screenStream) {
      this.screenStream.getTracks().forEach((t) => t.stop());
      this.screenStream = null;
    }
    if (sessionId) {
      try {
        await realtime.leaveScreenShare(sessionId);
      } catch {
        // ignore
      }
    }
    this.stopQualityMonitor();
    this.setState({ ...INITIAL });
  }

  private async handleSessionEvent(raw: unknown) {
    const { event, data } = raw as { event: string; data: Record<string, unknown> };
    if (!data) return;

    if (event === 'screen:created' || event === 'screen:start' || event === 'screen:stop') {
      if (
        this.state.conversationId &&
        data.conversationId &&
        data.conversationId !== this.state.conversationId &&
        this.state.sessionId &&
        data.sessionId !== this.state.sessionId
      ) {
        // Another conversation's session — ignore unless idle prompt handled by UI
      }
      if (event === 'screen:start' && !this.state.sessionId && data.sessionId) {
        // Do not bind idle clients to the session. Setting sessionId here made
        // MessageScreenShare / header Join think the user had already joined.
        return;
      }
      if (this.state.sessionId && data.sessionId === this.state.sessionId) {
        this.applySessionPayload(data);
      }
      return;
    }

    if (event === 'participant:joined') {
      const session = data.session as Record<string, unknown> | undefined;
      if (session) this.applySessionPayload(session);
      const participant = data.participant as ScreenShareParticipant | undefined;
      if (
        this.state.isLocalPresenter &&
        participant &&
        participant.id !== this.localUserId &&
        this.state.sessionId === data.sessionId
      ) {
        await this.ensurePeer(participant.id, true);
      }
      return;
    }

    if (event === 'participant:left') {
      const session = data.session as Record<string, unknown> | undefined;
      if (session) this.applySessionPayload(session);
      const participant = data.participant as ScreenShareParticipant | undefined;
      if (participant) this.closePeer(participant.id);
      return;
    }

    if (event === 'screen:ended') {
      if (data.sessionId === this.state.sessionId) {
        await this.leave();
        this.setState({ phase: 'ended' });
      }
    }

    if (event === 'screen:quality' && data.sessionId === this.state.sessionId) {
      const quality = data.quality as { level?: ConnectionQualityLevel } | undefined;
      if (quality?.level) this.setState({ connectionQuality: quality.level });
    }
  }

  private async handleWebrtc(raw: unknown) {
    const { event, data } = raw as {
      event: string;
      data: { sessionId: string; fromUserId: string; payload: unknown };
    };
    if (!data || data.sessionId !== this.state.sessionId) return;

    const pc = await this.ensurePeer(data.fromUserId, false);
    if (event === 'webrtc:offer') {
      const offer = data.payload as RTCSessionDescriptionInit;
      if (pc.signalingState !== 'stable' && pc.signalingState !== 'have-remote-offer') {
        // Glare: presenter offer wins; roll back any local offer from a prior race.
        await pc.setLocalDescription({ type: 'rollback' }).catch(() => undefined);
      }
      await pc.setRemoteDescription(offer);
      await this.flushPendingIce(data.fromUserId, pc);
      this.attachLocalScreenTracks(pc);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await realtime.sendWebrtcSignal('webrtc:answer', {
        sessionId: data.sessionId,
        targetUserId: data.fromUserId,
        payload: answer,
      });
    } else if (event === 'webrtc:answer') {
      if (pc.signalingState === 'have-local-offer') {
        await pc.setRemoteDescription(data.payload as RTCSessionDescriptionInit);
        await this.flushPendingIce(data.fromUserId, pc);
      }
    } else if (event === 'webrtc:ice') {
      const candidate = data.payload as RTCIceCandidateInit;
      if (!pc.remoteDescription) {
        const queue = this.pendingIce.get(data.fromUserId) ?? [];
        queue.push(candidate);
        this.pendingIce.set(data.fromUserId, queue);
        return;
      }
      try {
        await pc.addIceCandidate(candidate);
      } catch {
        // ignore
      }
    }
  }

  private async flushPendingIce(peerId: string, pc: RTCPeerConnection) {
    const queue = this.pendingIce.get(peerId);
    if (!queue?.length) return;
    this.pendingIce.delete(peerId);
    for (const candidate of queue) {
      try {
        await pc.addIceCandidate(candidate);
      } catch {
        // ignore
      }
    }
  }

  private attachLocalScreenTracks(pc: RTCPeerConnection) {
    if (!this.screenStream || !this.state.isLocalPresenter) return;
    const senders = pc.getSenders();
    for (const track of this.screenStream.getTracks()) {
      const already = senders.some((s) => s.track?.id === track.id);
      if (!already) {
        pc.addTrack(track, this.screenStream);
      }
    }
  }

  private async ensurePeer(peerId: string, createOffer: boolean) {
    let pc = this.peers.get(peerId);
    const created = !pc;

    if (!pc) {
      const iceServers = await this.getIceServers();
      pc = new RTCPeerConnection({ iceServers });
      this.peers.set(peerId, pc);

      pc.onicecandidate = (event) => {
        if (!event.candidate || !this.state.sessionId) return;
        void realtime.sendWebrtcSignal('webrtc:ice', {
          sessionId: this.state.sessionId,
          targetUserId: peerId,
          payload: event.candidate.toJSON(),
        });
      };

      pc.ontrack = (event) => {
        let stream = event.streams[0];
        if (!stream) {
          stream = this.state.remoteStream ?? new MediaStream();
          const has = stream.getTracks().some((t) => t.id === event.track.id);
          if (!has) stream.addTrack(event.track);
        }
        event.track.onunmute = () => {
          this.setState({ remoteStream: stream, phase: 'viewing' });
        };
        this.setState({ remoteStream: stream, phase: 'viewing' });
      };

      pc.oniceconnectionstatechange = () => {
        if (pc!.iceConnectionState === 'failed') {
          void pc!.restartIce();
        }
      };
    }

    this.attachLocalScreenTracks(pc);

    if (createOffer && this.state.sessionId && this.state.isLocalPresenter) {
      // Presenter always drives negotiation so the SDP includes the screen track.
      if (!created && pc.signalingState !== 'stable') {
        return pc;
      }
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await realtime.sendWebrtcSignal('webrtc:offer', {
        sessionId: this.state.sessionId,
        targetUserId: peerId,
        payload: offer,
      });
    }

    return pc;
  }

  private closePeer(peerId: string) {
    const pc = this.peers.get(peerId);
    if (!pc) return;
    pc.close();
    this.peers.delete(peerId);
    this.pendingIce.delete(peerId);
  }

  private cleanupPeers() {
    for (const pc of this.peers.values()) pc.close();
    this.peers.clear();
    this.pendingIce.clear();
    this.setState({ remoteStream: null });
  }

  private async getIceServers() {
    if (this.iceServers) return this.iceServers;
    const result = await api.getCallIceServers();
    this.iceServers = result.iceServers;
    return this.iceServers;
  }

  private startQualityMonitor() {
    if (this.qualityTimer) return;
    this.qualityTimer = setInterval(() => {
      const pc = [...this.peers.values()][0];
      if (!pc || !this.state.sessionId) return;
      void measureConnectionQuality(pc).then((q) => {
        this.setState({ connectionQuality: q.level });
        realtime.sendScreenQuality(this.state.sessionId!, q);
      });
    }, 4000);
  }

  private stopQualityMonitor() {
    if (this.qualityTimer) {
      clearInterval(this.qualityTimer);
      this.qualityTimer = null;
    }
  }
}

export const screenShareManager = new ScreenShareManager();
