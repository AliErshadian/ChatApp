import { Injectable } from '@nestjs/common';
import { ActiveCall } from './call.types';

const RING_TIMEOUT_MS = 15_000;

@Injectable()
export class CallRegistryService {
  private readonly calls = new Map<string, ActiveCall>();
  private readonly userCallId = new Map<string, string>();

  get(callId: string): ActiveCall | undefined {
    return this.calls.get(callId);
  }

  getCallIdForUser(userId: string): string | undefined {
    return this.userCallId.get(userId);
  }

  isUserBusy(userId: string): boolean {
    const callId = this.userCallId.get(userId);
    if (!callId) return false;
    const call = this.calls.get(callId);
    return call?.state === 'ringing' || call?.state === 'active';
  }

  create(call: Omit<ActiveCall, 'createdAt' | 'state'> & { state?: ActiveCall['state'] }): ActiveCall {
    const active: ActiveCall = {
      ...call,
      state: call.state ?? 'ringing',
      createdAt: Date.now(),
    };
    this.calls.set(active.callId, active);
    this.userCallId.set(active.callerId, active.callId);
    this.userCallId.set(active.calleeId, active.callId);
    return active;
  }

  markActive(callId: string): ActiveCall | undefined {
    const call = this.calls.get(callId);
    if (!call) return undefined;
    call.state = 'active';
    call.answeredAt = Date.now();
    if (call.ringTimeout) {
      clearTimeout(call.ringTimeout);
      call.ringTimeout = undefined;
    }
    return call;
  }

  scheduleRingTimeout(callId: string, onTimeout: () => void) {
    const call = this.calls.get(callId);
    if (!call) return;
    if (call.ringTimeout) clearTimeout(call.ringTimeout);
    call.ringTimeout = setTimeout(() => {
      if (this.calls.get(callId)?.state === 'ringing') {
        onTimeout();
      }
    }, RING_TIMEOUT_MS);
  }

  remove(callId: string): ActiveCall | undefined {
    const call = this.calls.get(callId);
    if (!call) return undefined;
    if (call.ringTimeout) {
      clearTimeout(call.ringTimeout);
    }
    call.state = 'ended';
    this.calls.delete(callId);
    if (this.userCallId.get(call.callerId) === callId) {
      this.userCallId.delete(call.callerId);
    }
    if (this.userCallId.get(call.calleeId) === callId) {
      this.userCallId.delete(call.calleeId);
    }
    return call;
  }
}
