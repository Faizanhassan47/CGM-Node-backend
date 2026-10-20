import { Injectable, Logger } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketAclCommand,
} from '@aws-sdk/client-s3';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly endpoint: string;
  private bucketChecked = false;

  constructor() {
    this.endpoint = (
      process.env.IDRIVE_ENDPOINT || 'https://s3.ap-southeast-1.idrivee2.com'
    ).trim();
    const region = (process.env.IDRIVE_REGION || 'ap-southeast-1').trim();
    const accessKeyId = (process.env.IDRIVE_ACCESS_KEY_ID || '').trim();
    const secretAccessKey = (process.env.IDRIVE_SECRET_ACCESS_KEY || '').trim();
    this.bucket = (process.env.IDRIVE_BUCKET || 'cgm-patient-uploads').trim();

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
   * Uploads a buffer directly to iDrive e2 S3 and returns the public or access URL.
   */
  async uploadFile(
    key: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<string> {
    await this.ensureBucketExists();

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        ACL: 'public-read',
      }),
    );

    // Formatted standard S3/iDrive e2 URL
    const cleanEndpoint = this.endpoint.endsWith('/')
      ? this.endpoint.slice(0, -1)
      : this.endpoint;
    return `${cleanEndpoint}/${this.bucket}/${key}`;
  }
}
