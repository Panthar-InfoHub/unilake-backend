import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { config } from "../config/env.js";
import { logger } from "./logger.js";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import fs from "fs/promises";

// This single S3 instace will bee able to deal with both the public and private bucketconfiguration
export const r2Client = new S3Client({
  region: "auto", // this will automatically find the best region for the connections
  endpoint: config.r2.endpoint,
  credentials: {
    accessKeyId: config.r2.accessKeyId,
    secretAccessKey: config.r2.secretAccessKey,
  },
  requestChecksumCalculation: "WHEN_REQUIRED", // this command right here is for the checking necessary configuration addotion for modern versions of the aws sdk to ensure that checksum headers map perfectly to he R@'s features set
});

/**
 * Uploads a raw file buffer directly to the specified Cloudflare R2 bucket.
 * * @param bucket - Targets either the 'public' or 'private' bucket defined in the environment config
 * @param key - The unique file path/name inside the destination bucket
 * @param buffer - The raw binary data of the file
 * @param contentType - The standard MIME type of the file (e.g., 'image/png', 'application/pdf')
 */

export const uploadFile = async (
  bucket: "public" | "private",
  key: string,
  buffer: Buffer,
  contentType: string
): Promise<void> => {
  const targetBucketName = bucket === "public" ? config.r2.publicBucket : config.r2.privateBucket;
    logger.debug(`Public bucket name : ${config.r2.publicBucket}`)
    logger.debug(`private bucket name : ${config.r2.privateBucket}`)

  logger.info(
    { bucket: targetBucketName, key, contentType },
    "Initiating file upload to Cloudflare R2"
  );

  const command = new PutObjectCommand({
    Bucket: targetBucketName,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  });

  await r2Client.send(command);

  logger.info(
    { bucket: targetBucketName, key },
    "File successfully uploaded to Cloudflare R2"
  );
};

/**
 * Generates the permanent public URL string for an asset inside the public bucket.
 * This method runs strictly in memory with no asynchronous R2 API overhead.
 * * @param key - The unique file path/name inside the public bucket
 * @returns The fully qualified public URL string
 */
export const getPublicUrl = (key: string): string => {
  const cleanBase = config.r2.publicUrlBase.replace(/\/$/, "");
  const cleanKey = key.replace(/^\//, "");

  return `${cleanBase}/${cleanKey}`;
};

/**
 * Generates a temporary, cryptographically signed URL for reading or downloading
 * an asset from the private bucket.
 * * @param key - The unique file path/name inside the private bucket
 * @param expirySeconds - Time window in seconds before the link automatically expires
 * @returns A promise that resolves to the signed URL string
 */

export const getSignedDownloadUrl = async (
  key: string,
  expirySeconds: number
): Promise<string> => {
  logger.info(
    { bucket: config.r2.privateBucket, key, expirySeconds },
    "Generating secure signed download URL for private asset"
  );

  const command = new GetObjectCommand({
    Bucket: config.r2.privateBucket,
    Key: key,
  });

  const signedUrl = await getSignedUrl(r2Client, command, {
    expiresIn: expirySeconds,
  });

  return signedUrl;
};

/**
 * Generates a temporary, cryptographically signed PUT URL that allows the frontend
 * to upload a file directly to either the public or private Cloudflare R2 bucket.
 * * @param bucket - Targets either the 'public' or 'private' bucket name from the environment config
 * @param key - The destination path and unique file name inside the bucket
 * @param contentType - The explicit MIME type expected during upload (e.g., 'image/jpeg', 'font/woff2')
 * @param expirySeconds - Time window in seconds before the link automatically expires
 * @returns A promise that resolves to the signed PUT upload URL string
 */

export const getSignedUploadUrl = async (
  bucket: "public" | "private",
  key: string,
  contentType: string,
  expirySeconds: number
): Promise<string> => {
  const targetBucketName = bucket === "public" ? config.r2.publicBucket : config.r2.privateBucket;

  logger.info(
    { bucket: targetBucketName, key, contentType, expirySeconds },
    "Generating secure presigned PUT upload URL"
  );

  const command = new PutObjectCommand({
    Bucket: targetBucketName,
    Key: key,
    ContentType: contentType, // Enforces that the client sends the exact content type specified
  });

  const signedUrl = await getSignedUrl(r2Client, command, {
    expiresIn: expirySeconds,
  });
  return signedUrl;
};

/**
 * Permanently deletes a file from the specified Cloudflare R2 bucket.
 * * @param bucket - Targets either the 'public' or 'private' bucket name from the environment config
 * @param key - The exact file path/name inside the target bucket to be deleted
 * @returns A promise that resolves when the deletion operation finishes
 */

export const deleteFile = async (
  bucket: "public" | "private",
  key: string
): Promise<void> => {
  const targetBucketName =
    bucket === "public" ? config.r2.publicBucket : config.r2.privateBucket;

  logger.info(
    { bucket: targetBucketName, key },
    "Initiating file deletion from Cloudflare R2"
  );

  const command = new DeleteObjectCommand({
    Bucket: targetBucketName,
    Key: key,
  });

  await r2Client.send(command);

  logger.info(
    { bucket: targetBucketName, key },
    "File successfully deleted from Cloudflare R2"
  );
};



export async function downloadFileToLocalPath(
  bucket: string,
  key: string,
  localPath: string
): Promise<void> {
  const response = await r2Client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key })
  );

  const bodyBytes = await response.Body!.transformToByteArray();
  await fs.writeFile(localPath, bodyBytes);
}