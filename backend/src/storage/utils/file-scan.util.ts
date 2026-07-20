import { BadRequestException } from '@nestjs/common';

/**
 * Upload hardening: block dangerous extensions, double-extension tricks,
 * and MIME spoofing via magic-byte sniffing.
 */

const DANGEROUS_EXTENSIONS = new Set([
  '.exe',
  '.dll',
  '.bat',
  '.cmd',
  '.com',
  '.scr',
  '.msi',
  '.msp',
  '.mst',
  '.vbs',
  '.vbe',
  '.js',
  '.jse',
  '.wsf',
  '.wsh',
  '.ps1',
  '.psm1',
  '.psd1',
  '.sh',
  '.bash',
  '.zsh',
  '.csh',
  '.php',
  '.phtml',
  '.asp',
  '.aspx',
  '.jsp',
  '.cgi',
  '.htaccess',
  '.htpasswd',
  '.htm',
  '.html',
  '.shtml',
  '.svg',
  '.svgz',
  '.swf',
  '.jar',
  '.war',
  '.ear',
  '.apk',
  '.deb',
  '.rpm',
  '.app',
  '.dmg',
  '.pkg',
  '.iso',
  '.img',
  '.sys',
  '.drv',
  '.cpl',
  '.msc',
  '.reg',
  '.url',
  '.lnk',
  '.hta',
  '.pif',
  '.inf',
  '.ins',
  '.isp',
  '.job',
  '.cab',
  '.gadget',
  '.msp',
  '.cer',
  '.crt',
  '.der',
  '.py',
  '.rb',
  '.pl',
  '.wasm',
]);

/** All extensions ChatApp may accept (for double-extension detection). */
const KNOWN_SAFE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.mp4',
  '.mov',
  '.webm',
  '.mp3',
  '.wav',
  '.ogg',
  '.pdf',
  '.docx',
  '.xlsx',
  '.pptx',
  '.zip',
]);

export interface SniffedContent {
  mimeType: string;
  /** Extensions that are valid for the sniffed format */
  extensions: string[];
  kind: 'image' | 'video' | 'audio' | 'document' | 'archive' | 'unknown';
}

function basename(name: string): string {
  return name.replace(/\\/g, '/').split('/').pop() ?? name;
}

/** Split "report.final.pdf" → ['.final', '.pdf']; "a.tar.gz" → ['.tar', '.gz'] */
export function extractExtensions(originalName: string): string[] {
  const base = basename(originalName).toLowerCase();
  // Strip trailing dots / spaces (Windows alternate data stream tricks)
  const cleaned = base.replace(/[.\s]+$/g, '');
  const parts = cleaned.split('.').filter((p) => p.length > 0);
  if (parts.length < 2) return [];
  return parts.slice(1).map((p) => `.${p}`);
}

export function assertSafeFileName(originalName: string): void {
  if (!originalName?.trim()) {
    throw new BadRequestException('Filename is required');
  }
  if (originalName.includes('\0')) {
    throw new BadRequestException('Invalid filename');
  }

  const extensions = extractExtensions(originalName);
  if (extensions.length === 0) {
    throw new BadRequestException('File must have a valid extension');
  }

  for (const ext of extensions) {
    if (DANGEROUS_EXTENSIONS.has(ext)) {
      throw new BadRequestException('File type is not allowed');
    }
  }

  const finalExt = extensions[extensions.length - 1];
  if (!KNOWN_SAFE_EXTENSIONS.has(finalExt)) {
    throw new BadRequestException('Unsupported file extension');
  }

  // Double extension: more than one known media/doc OR dangerous already blocked.
  // e.g. photo.jpg.exe, invoice.pdf.js, image.png.jpg
  const knownCount = extensions.filter(
    (ext) => KNOWN_SAFE_EXTENSIONS.has(ext) || DANGEROUS_EXTENSIONS.has(ext),
  ).length;
  if (knownCount > 1) {
    throw new BadRequestException('Double extension filenames are not allowed');
  }
}

function startsWith(buf: Buffer, bytes: number[]): boolean {
  if (buf.length < bytes.length) return false;
  return bytes.every((b, i) => buf[i] === b);
}

function indexOfAscii(buf: Buffer, ascii: string, maxScan = 64): number {
  const needle = Buffer.from(ascii, 'ascii');
  const limit = Math.min(buf.length, maxScan);
  return buf.subarray(0, limit).indexOf(needle);
}

/**
 * Magic-byte sniffing for allowlisted formats only.
 * Returns null when content does not match any supported type.
 */
export function sniffFileContent(buffer: Buffer): SniffedContent | null {
  if (!buffer?.length) return null;

  // Images
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { mimeType: 'image/png', extensions: ['.png'], kind: 'image' };
  }
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) {
    return { mimeType: 'image/jpeg', extensions: ['.jpg', '.jpeg'], kind: 'image' };
  }
  if (
    startsWith(buffer, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
    startsWith(buffer, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
  ) {
    return { mimeType: 'image/gif', extensions: ['.gif'], kind: 'image' };
  }
  // WEBP: RIFF....WEBP
  if (
    startsWith(buffer, [0x52, 0x49, 0x46, 0x46]) &&
    buffer.length >= 12 &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return { mimeType: 'image/webp', extensions: ['.webp'], kind: 'image' };
  }

  // Reject SVG / HTML polyglots early (text signatures)
  const head = buffer.subarray(0, Math.min(256, buffer.length)).toString('utf8').toLowerCase();
  if (
    head.includes('<svg') ||
    head.includes('<!doctype html') ||
    head.includes('<html') ||
    head.includes('<?xml')
  ) {
    return null;
  }

  // PDF
  if (buffer.toString('ascii', 0, 5) === '%PDF-') {
    return { mimeType: 'application/pdf', extensions: ['.pdf'], kind: 'document' };
  }

  // ZIP container (zip / docx / xlsx / pptx)
  if (startsWith(buffer, [0x50, 0x4b, 0x03, 0x04]) || startsWith(buffer, [0x50, 0x4b, 0x05, 0x06])) {
    const sample = buffer.subarray(0, Math.min(buffer.length, 8192)).toString('binary');
    if (sample.includes('word/')) {
      return {
        mimeType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        extensions: ['.docx'],
        kind: 'document',
      };
    }
    if (sample.includes('xl/')) {
      return {
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        extensions: ['.xlsx'],
        kind: 'document',
      };
    }
    if (sample.includes('ppt/')) {
      return {
        mimeType:
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        extensions: ['.pptx'],
        kind: 'document',
      };
    }
    return {
      mimeType: 'application/zip',
      extensions: ['.zip'],
      kind: 'archive',
    };
  }

  // ISO BMFF (mp4 / mov / m4a): ....ftyp
  if (buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buffer.toString('ascii', 8, 12).toLowerCase();
    if (
      brand.startsWith('qt') ||
      brand.includes('qt') ||
      ['qt  ', 'mqt '].includes(buffer.toString('ascii', 8, 12))
    ) {
      return { mimeType: 'video/quicktime', extensions: ['.mov'], kind: 'video' };
    }
    // Most ftyp brands we allow as mp4/video; m4a is audio — treat as video/mp4 container still OK for .mp4
    return { mimeType: 'video/mp4', extensions: ['.mp4', '.mov'], kind: 'video' };
  }

  // WebM / Matroska: EBML header
  if (startsWith(buffer, [0x1a, 0x45, 0xdf, 0xa3])) {
    return {
      mimeType: 'video/webm',
      extensions: ['.webm'],
      kind: 'video',
    };
  }

  // OGG
  if (startsWith(buffer, [0x4f, 0x67, 0x67, 0x53])) {
    return { mimeType: 'audio/ogg', extensions: ['.ogg'], kind: 'audio' };
  }

  // WAV: RIFF....WAVE
  if (
    startsWith(buffer, [0x52, 0x49, 0x46, 0x46]) &&
    buffer.length >= 12 &&
    buffer.toString('ascii', 8, 12) === 'WAVE'
  ) {
    return { mimeType: 'audio/wav', extensions: ['.wav'], kind: 'audio' };
  }

  // MP3: ID3 or frame sync
  if (startsWith(buffer, [0x49, 0x44, 0x33])) {
    return { mimeType: 'audio/mpeg', extensions: ['.mp3'], kind: 'audio' };
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) {
    return { mimeType: 'audio/mpeg', extensions: ['.mp3'], kind: 'audio' };
  }

  // Executable / script signatures → treat as unknown (caller rejects)
  if (startsWith(buffer, [0x4d, 0x5a])) {
    // MZ — PE
    return { mimeType: 'application/x-msdownload', extensions: ['.exe'], kind: 'unknown' };
  }
  if (startsWith(buffer, [0x7f, 0x45, 0x4c, 0x46])) {
    return { mimeType: 'application/x-elf', extensions: [], kind: 'unknown' };
  }
  if (buffer.toString('utf8', 0, 2) === '#!') {
    return { mimeType: 'application/x-sh', extensions: [], kind: 'unknown' };
  }

  // Heuristic: "ftyp" elsewhere in first 64 bytes still unknown
  if (indexOfAscii(buffer, 'ftyp') >= 0 && buffer.length > 12) {
    return { mimeType: 'video/mp4', extensions: ['.mp4'], kind: 'video' };
  }

  return null;
}

export function assertContentMatchesExtension(
  sniffed: SniffedContent,
  finalExtension: string,
  declaredMime: string,
): void {
  const ext = finalExtension.toLowerCase();
  if (sniffed.kind === 'unknown') {
    throw new BadRequestException('File content is not allowed');
  }
  if (!sniffed.extensions.includes(ext)) {
    // webm can be audio or video container — allow .webm for either when sniff says webm/matroska
    if (!(ext === '.webm' && (sniffed.mimeType.includes('webm') || sniffed.kind === 'video'))) {
      throw new BadRequestException('File content does not match extension');
    }
  }

  const declared = (declaredMime || '').toLowerCase().split(';')[0]?.trim() ?? '';
  if (declared && declared !== 'application/octet-stream') {
    const compatible =
      declared === sniffed.mimeType ||
      (declared === 'image/jpg' && sniffed.mimeType === 'image/jpeg') ||
      (declared === 'audio/mp3' && sniffed.mimeType === 'audio/mpeg') ||
      (declared === 'audio/x-wav' && sniffed.mimeType === 'audio/wav') ||
      (declared === 'audio/webm' && ext === '.webm') ||
      (declared === 'video/webm' && ext === '.webm') ||
      (declared === 'application/x-zip-compressed' && sniffed.mimeType === 'application/zip') ||
      (declared.startsWith('audio/') && sniffed.kind === 'audio' && ext === '.webm');

    if (!compatible) {
      throw new BadRequestException('Declared file type does not match content');
    }
  }
}

/**
 * Full pre-upload scan: filename safety + magic bytes + consistency.
 */
export function scanUploadedFile(file: Express.Multer.File): {
  finalExtension: string;
  sniffed: SniffedContent;
} {
  assertSafeFileName(file.originalname);

  const extensions = extractExtensions(file.originalname);
  const finalExtension = extensions[extensions.length - 1];

  const sniffed = sniffFileContent(file.buffer);
  if (!sniffed) {
    throw new BadRequestException('Unrecognized or disallowed file content');
  }

  assertContentMatchesExtension(sniffed, finalExtension, file.mimetype);

  return { finalExtension, sniffed };
}

export function isDangerousExtension(ext: string): boolean {
  return DANGEROUS_EXTENSIONS.has(ext.toLowerCase());
}
