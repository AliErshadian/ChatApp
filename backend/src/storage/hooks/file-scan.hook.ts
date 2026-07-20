import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StorageHook, StorageUploadContext } from '../interfaces/storage-hooks.interface';
import { sniffFileContent } from '../utils/file-scan.util';

/**
 * Second-line content scan at hook time (defense in depth).
 * Primary checks run in validateMediaFile via file-scan.util.
 *
 * Optional ClamAV: set FILE_SCAN_CLAMAV_ENABLED=true and FILE_SCAN_CLAMAV_HOST/PORT
 * when a clamav daemon is available (not required for baseline protection).
 */
@Injectable()
export class FileScanHook implements StorageHook {
  private readonly logger = new Logger(FileScanHook.name);
  private readonly clamavEnabled: boolean;

  constructor(private readonly config: ConfigService) {
    this.clamavEnabled = config.get<string>('FILE_SCAN_CLAMAV_ENABLED') === 'true';
  }

  async onBeforeUpload(context: StorageUploadContext): Promise<void> {
    const sniffed = sniffFileContent(context.buffer);
    if (!sniffed || sniffed.kind === 'unknown') {
      throw new BadRequestException('File failed content scan');
    }

    // Polyglot / executable disguised as media
    if (
      sniffed.mimeType === 'application/x-msdownload' ||
      sniffed.mimeType === 'application/x-elf' ||
      sniffed.mimeType === 'application/x-sh'
    ) {
      throw new BadRequestException('Executable content is not allowed');
    }

    if (this.clamavEnabled) {
      await this.scanWithClamav(context);
    }
  }

  private async scanWithClamav(context: StorageUploadContext): Promise<void> {
    const host = this.config.get<string>('FILE_SCAN_CLAMAV_HOST') ?? '127.0.0.1';
    const port = Number(this.config.get<string>('FILE_SCAN_CLAMAV_PORT') ?? '3310');

    try {
      // Lazy require so environments without net usage stay simple; dynamic import of node:net
      const net = await import('net');
      const result = await new Promise<string>((resolve, reject) => {
        const socket = net.createConnection({ host, port }, () => {
          // INSTREAM protocol
          const size = Buffer.alloc(4);
          size.writeUInt32BE(context.buffer.length, 0);
          socket.write('zINSTREAM\0');
          socket.write(size);
          socket.write(context.buffer);
          const zero = Buffer.alloc(4);
          socket.write(zero);
        });
        let data = '';
        socket.setTimeout(10_000);
        socket.on('data', (chunk) => {
          data += chunk.toString('utf8');
        });
        socket.on('end', () => resolve(data.trim()));
        socket.on('error', reject);
        socket.on('timeout', () => {
          socket.destroy();
          reject(new Error('ClamAV scan timed out'));
        });
      });

      if (/FOUND/i.test(result) && !/OK$/i.test(result)) {
        this.logger.warn(`ClamAV detected threat for user=${context.userId}: ${result}`);
        throw new BadRequestException('File failed virus scan');
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.error(
        `ClamAV scan unavailable (${host}:${port}): ${err instanceof Error ? err.message : err}`,
      );
      throw new BadRequestException('File scanning service unavailable');
    }
  }
}
