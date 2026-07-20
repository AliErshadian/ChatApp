import { StorageCategory } from '../utils/mime.util';

/**
 * Extension points for future background processing pipelines.
 * Hooks are invoked by StorageService; default implementation is a no-op.
 */
export interface StorageUploadContext {
  userId: string;
  category: StorageCategory;
  bucket: string;
  objectKey: string;
  mimeType: string;
  size: number;
  buffer: Buffer;
  conversationId?: string;
  messageId?: string;
}

export interface StorageHook {
  /** Runs before upload (FileScanHook, compression, etc.). */
  onBeforeUpload?(context: StorageUploadContext): Promise<void>;
  /** Runs after metadata is persisted (thumbnail generation, audit enrichment, etc.). */
  onAfterUpload?(context: StorageUploadContext, attachmentId: string): Promise<void>;
  /** Runs before delete (cleanup of derived assets). */
  onBeforeDelete?(attachmentId: string): Promise<void>;
}

export const STORAGE_HOOKS = Symbol('STORAGE_HOOKS');
