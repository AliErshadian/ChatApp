import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class CallsIceService {
  constructor(private readonly config: ConfigService) {}

  getIceServers(): Array<{ urls: string | string[]; username?: string; credential?: string }> {
    const stunRaw = this.config.get<string>(
      'WEBRTC_STUN_URLS',
      'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302',
    );
    const servers: Array<{ urls: string | string[]; username?: string; credential?: string }> =
      stunRaw
      .split(',')
      .map((url) => url.trim())
      .filter(Boolean)
      .map((urls) => ({ urls }));

    const turnUrl = this.config.get<string>('TURN_URL');
    const turnUsername = this.config.get<string>('TURN_USERNAME');
    const turnPassword = this.config.get<string>('TURN_PASSWORD');
    if (turnUrl && turnUsername && turnPassword) {
      servers.push({
        urls: turnUrl,
        username: turnUsername,
        credential: turnPassword,
      });
    }

    return servers;
  }
}
