import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';

@Injectable()
export class WsJwtGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const client = context.switchToWs().getClient<Socket & { data: { userId?: string } }>();
    if (!client.data?.userId) {
      throw new WsException('Unauthorized');
    }
    return true;
  }
}
