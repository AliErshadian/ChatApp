import { Readable } from 'node:stream';

export interface StorageUploadInput {
  bucket: string;
  objectKey: string;
  body: Buffer;
  mimeType: string;
  size: number;
  checksum: string;
}

export interface StorageUploadResult {
  bucket: string;
  objectKey: string;
  etag?: string;
}

export interface StorageCopyInput {
  sourceBucket: string;
  sourceKey: string;
  destinationBucket: string;
  destinationKey: string;
}

export interface PresignedUrlOptions {
  expiresInSeconds: number;
}

export interface StorageBucketStats {
  bucket: string;
  bytes: number;
  objectCount: number;
}

export interface IStorageProvider {
  ensureBuckets(bucketNames: string[]): Promise<void>;
  upload(input: StorageUploadInput): Promise<StorageUploadResult>;
  copy(input: StorageCopyInput): Promise<void>;
  deleteObject(bucket: string, objectKey: string): Promise<void>;
  getPresignedDownloadUrl(
    bucket: string,
    objectKey: string,
    options: PresignedUrlOptions,
  ): Promise<string>;
  getObjectStream(bucket: string, objectKey: string): Promise<Readable>;
  getBucketStats(bucket: string): Promise<StorageBucketStats>;
}

export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER');
