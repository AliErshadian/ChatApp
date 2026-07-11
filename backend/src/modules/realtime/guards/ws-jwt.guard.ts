import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';
import { AuthService } from '../../auth/auth.service';
import { AUTH_SESSION_TERMINATED_MESSAGE } from '../../auth/auth-session.constants';

type AuthenticatedSocket = Socket & {
  data: { userId?: string; email?: string; sessionId?: string };
};

@Injectable()
export class WsJwtGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const client = context.switchToWs().getClient<AuthenticatedSocket>();
    const userId = client.data?.userId;
    const sessionId = client.data?.sessionId;
    const email = client.data?.email;

    if (!userId || !sessionId || !email) {
      throw new WsException('Unauthorized');
    }

    try {
      await this.authService.validateAccessToken({
        sub: userId,
        email,
        sid: sessionId,
      });
      return true;
    } catch {
      client.disconnect(true);
      throw new WsException(AUTH_SESSION_TERMINATED_MESSAGE);
    }
  }
}
