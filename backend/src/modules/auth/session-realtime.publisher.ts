import { Injectable } from '@nestjs/common';

@Injectable()
export class SessionRealtimePublisher {
  private emitTerminated?: (sessionId: string) => Promise<void>;

  setTerminatedEmitter(emit: (sessionId: string) => Promise<void>) {
    this.emitTerminated = emit;
  }

  async publishTerminated(sessionId: string) {
    if (this.emitTerminated) {
      await this.emitTerminated(sessionId);
    }
  }
}
