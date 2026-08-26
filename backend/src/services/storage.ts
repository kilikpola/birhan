import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "../config/index.js";

const s3 = new S3Client({
  endpoint: config.s3Endpoint,
  region: config.s3Region,
  credentials: {
    accessKeyId: config.s3AccessKeyId,
    secretAccessKey: config.s3SecretAccessKey,
  },
  forcePathStyle: true,
});

const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export function validateFileUpload(mimeType: string, sizeBytes: number) {
  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    return { valid: false, error: "File type not allowed" };
  }
  if (sizeBytes > MAX_FILE_SIZE) {
    return { valid: false, error: "File exceeds 10 MB limit" };
  }
  return { valid: true, error: null };
}

export async function getPresignedUploadUrl(bucket: string, key: string, mimeType: string, expiresIn = 300) {
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: mimeType,
  });
  return getSignedUrl(s3, command, { expiresIn });
}

export async function getPresignedDownloadUrl(bucket: string, key: string, expiresIn = 300) {
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });
  return getSignedUrl(s3, command, { expiresIn });
}

export function generateResourceKey(churchId: string, resourceId: string, filename: string) {
  return `${churchId}/${resourceId}/${filename}`;
}

export function generatePastorDocKey(userId: string, filename: string) {
  return `${userId}/${filename}`;
}
