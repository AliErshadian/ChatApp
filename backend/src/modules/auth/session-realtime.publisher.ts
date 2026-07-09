import { Injectable } from '@nestjs/common';

export interface SessionCreatedPayload {
  sessionId: string;
  deviceLabel: string;
  appName: string;
  platform: string | null;
  ipAddress: string | null;
}

@Injectable()
export class SessionRealtimePublisher {
  private emitTerminated?: (sessionId: string) => Promise<void>;
  private emitCreated?: (
    userId: string,
    payload: SessionCreatedPayload,
    exceptSessionId: string,
  ) => Promise<void>;

  setTerminatedEmitter(emit: (sessionId: string) => Promise<void>) {
    this.emitTerminated = emit;
  }

  setCreatedEmitter(
    emit: (userId: string, payload: SessionCreatedPayload, exceptSessionId: string) => Promise<void>,
  ) {
    this.emitCreated = emit;
  }

  async publishTerminated(sessionId: string) {
    if (this.emitTerminated) {
      await this.emitTerminated(sessionId);
    }
  }

  async publishCreated(
    userId: string,
    payload: SessionCreatedPayload,
    exceptSessionId: string,
  ) {
    if (this.emitCreated) {
      await this.emitCreated(userId, payload, exceptSessionId);
    }
  }
}
