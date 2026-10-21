import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import {
  ObjectCannedACL,
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketAclCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly endpoint: string;
  private readonly objectAcl?: ObjectCannedACL;
  private readonly signedUrlTtlSeconds: number;
  private bucketChecked = false;

  constructor() {
    this.endpoint = (
      process.env.IDRIVE_ENDPOINT || 'https://s3.ap-southeast-1.idrivee2.com'
    ).trim();
    const region = (process.env.IDRIVE_REGION || 'ap-southeast-1').trim();
    const accessKeyId = (process.env.IDRIVE_ACCESS_KEY_ID || '').trim();
    const secretAccessKey = (process.env.IDRIVE_SECRET_ACCESS_KEY || '').trim();
    this.bucket = (process.env.IDRIVE_BUCKET || 'cgm-patient-uploads').trim();
    const configuredAcl = process.env.IDRIVE_OBJECT_ACL?.trim();
    this.objectAcl = configuredAcl ? configuredAcl as ObjectCannedACL : undefined;
    const configuredTtl = Number(process.env.IDRIVE_SIGNED_URL_TTL_SECONDS || 3600);
    this.signedUrlTtlSeconds = Number.isFinite(configuredTtl)
      ? Math.min(Math.max(Math.floor(configuredTtl), 60), 86_400)
      : 3600;

    this.s3 = new S3Client({
      endpoint: this.endpoint,
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
      forcePathStyle: true, // Necessary for iDrive e2 S3 compatible storage
    });
  }

  private async ensureBucketExists(): Promise<void> {
    if (this.bucketChecked) return;
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
      this.bucketChecked = true;
    } catch {
      try {
        await this.s3.send(new CreateBucketCommand({ Bucket: this.bucket }));
        this.logger.log(`Created iDrive e2 bucket: ${this.bucket}`);
        this.bucketChecked = true;
      } catch (err: unknown) {
        this.logger.warn(
          `Bucket check/create note for ${this.bucket}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  /**
   * Uploads a buffer directly to iDrive e2 S3 and returns its object key.
   */
  async uploadFile(
    key: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<string> {
    await this.ensureBucketExists();

    try {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: buffer,
          ContentType: contentType,
          ...(this.objectAcl ? { ACL: this.objectAcl } : {}),
        }),
      );
    } catch (error: unknown) {
      const code = error && typeof error === 'object' && 'name' in error
        ? String(error.name)
        : 'UnknownStorageError';
      this.logger.error(`Profile upload failed for bucket ${this.bucket}: ${code}`);
      throw new ServiceUnavailableException('Profile image storage is temporarily unavailable.');
    }

    return key;
  }

  async getDisplayUrl(storedValue: string | null): Promise<string | null> {
    if (!storedValue) return null;

    const objectKey = this.getManagedObjectKey(storedValue);
    if (!objectKey) return storedValue;

    try {
      return await getSignedUrl(
        this.s3,
        new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }),
        { expiresIn: this.signedUrlTtlSeconds },
      );
    } catch (error: unknown) {
      const code = error && typeof error === 'object' && 'name' in error
        ? String(error.name)
        : 'UnknownStorageError';
      this.logger.error(`Profile image URL signing failed for bucket ${this.bucket}: ${code}`);
      throw new ServiceUnavailableException('Profile image storage is temporarily unavailable.');
    }
  }

  private getManagedObjectKey(value: string): string | null {
    if (value.startsWith('avatars/')) return value;

    const endpoint = this.endpoint.endsWith('/') ? this.endpoint.slice(0, -1) : this.endpoint;
    const bucketPrefix = `${endpoint}/${this.bucket}/`;
    return value.startsWith(bucketPrefix) ? value.slice(bucketPrefix.length) : null;
  }
}
