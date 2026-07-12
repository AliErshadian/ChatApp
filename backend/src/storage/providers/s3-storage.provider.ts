import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CopyObjectCommand,
  CreateBucketCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import {
  IStorageProvider,
  StorageBucketStats,
  StorageCopyInput,
  StorageUploadInput,
  StorageUploadResult,
} from '../interfaces/storage-provider.interface';
import { buildS3EndpointUrl, buildStorageConfig } from '../config/storage.config';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

@Injectable()
export class S3StorageProvider implements IStorageProvider, OnModuleInit {
  private readonly logger = new Logger(S3StorageProvider.name);
  private readonly client: S3Client;
  private readonly bucketNames: string[];
  private readonly endpointUrl: string;
  private readonly readyBuckets = new Set<string>();
  private initPromise: Promise<void> | null = null;

  constructor(private readonly configService: ConfigService) {
    const storageConfig = buildStorageConfig(configService);
    this.bucketNames = [...new Set(Object.values(storageConfig.buckets))] as string[];
    this.endpointUrl = buildS3EndpointUrl(storageConfig);

    this.client = new S3Client({
      region: storageConfig.region,
      endpoint: this.endpointUrl,
      credentials: {
        accessKeyId: storageConfig.accessKey,
        secretAccessKey: storageConfig.secretKey,
      },
      forcePathStyle: true,
    });
  }

  onModuleInit() {
    this.initPromise = this.initializeBuckets();
    if (this.configService.get<string>('NODE_ENV') === 'production') {
      return this.initPromise;
    }
    void this.initPromise.catch(() => {
      // Development: allow API startup while MinIO is still coming up.
    });
  }

  private async initializeBuckets(): Promise<void> {
    const isProduction = this.configService.get<string>('NODE_ENV') === 'production';
    const maxAttempts = isProduction ? 5 : 15;
    const baseDelayMs = 2_000;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.ensureBuckets(this.bucketNames);
        this.logger.log(`Object storage ready at ${this.endpointUrl}`);
        return;
      } catch (error) {
        const retrying = attempt < maxAttempts;
        const message = `Object storage not reachable at ${this.endpointUrl} (attempt ${attempt}/${maxAttempts})`;

        if (!retrying) {
          if (isProduction) {
            this.logger.error(message, error as Error);
            throw error;
          }

          this.logger.warn(
            `${message}. API will start, but uploads will fail until MinIO is running. Start infra with: npm run dev:infra`,
          );
          return;
        }

        this.logger.warn(`${message}. Retrying...`);
        await sleep(baseDelayMs * attempt);
      }
    }
  }

  private async waitUntilReady(bucket: string) {
    if (this.readyBuckets.has(bucket)) return;

    if (!this.initPromise) {
      this.initPromise = this.initializeBuckets();
    }

    await this.initPromise.catch(() => undefined);

    if (!this.readyBuckets.has(bucket)) {
      await this.ensureBuckets([bucket]);
    }
  }

  async ensureBuckets(bucketNames: string[]): Promise<void> {
    for (const bucket of bucketNames) {
      if (this.readyBuckets.has(bucket)) continue;

      try {
        await this.client.send(new HeadBucketCommand({ Bucket: bucket }));
        this.readyBuckets.add(bucket);
        this.logger.log(`Bucket "${bucket}" is ready`);
      } catch {
        await this.client.send(new CreateBucketCommand({ Bucket: bucket }));
        this.readyBuckets.add(bucket);
        this.logger.log(`Created bucket "${bucket}"`);
      }
    }
  }

  async upload(input: StorageUploadInput): Promise<StorageUploadResult> {
    await this.waitUntilReady(input.bucket);

    const result = await this.client.send(
      new PutObjectCommand({
        Bucket: input.bucket,
        Key: input.objectKey,
        Body: input.body,
        ContentType: input.mimeType,
        ContentLength: input.size,
        Metadata: {
          checksum: input.checksum,
        },
      }),
    );

    return {
      bucket: input.bucket,
      objectKey: input.objectKey,
      etag: result.ETag,
    };
  }

  async copy(input: StorageCopyInput): Promise<void> {
    await this.waitUntilReady(input.destinationBucket);

    await this.client.send(
      new CopyObjectCommand({
        Bucket: input.destinationBucket,
        Key: input.destinationKey,
        CopySource: `${input.sourceBucket}/${input.sourceKey}`,
      }),
    );
  }

  async deleteObject(bucket: string, objectKey: string): Promise<void> {
    await this.waitUntilReady(bucket);

    await this.client.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: objectKey,
      }),
    );
  }

  async getPresignedDownloadUrl(
    bucket: string,
    objectKey: string,
    options: { expiresInSeconds: number },
  ): Promise<string> {
    await this.waitUntilReady(bucket);

    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: objectKey,
    });
    return getSignedUrl(this.client, command, { expiresIn: options.expiresInSeconds });
  }

  async getBucketStats(bucket: string): Promise<StorageBucketStats> {
    await this.waitUntilReady(bucket);

    let bytes = 0;
    let objectCount = 0;
    let continuationToken: string | undefined;

    do {
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          ContinuationToken: continuationToken,
        }),
      );

      for (const object of response.Contents ?? []) {
        objectCount += 1;
        bytes += object.Size ?? 0;
      }

      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);

    return { bucket, bytes, objectCount };
  }
}
