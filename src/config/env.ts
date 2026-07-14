import dotenv from "dotenv";
import { string } from "zod";

dotenv.config();

const requriedVariables = [
  "PORT",
  "DATABASE_URL",
  "DIRECT_URL",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_PRIVATE_BUCKET_NAME",
  "R2_PUBLIC_BUCKET_NAME",
  "R2_ENDPOINT",
  "REDIS_URL",
  "FACEBOOK_CLIENT_ID",
  "FACEBOOK_CLIENT_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "BETTER_AUTH_URL",
] as const;

for (const envVar of requriedVariables) {
  if (!process.env[envVar]) {
    console.error(
      `🚨 FATAL ERROR: Missing required environment variable: ${envVar}`
    );
    process.exit(1);
  }
}

export const config = {
  port: parseInt(process.env.PORT as string, 10),
  nodeEnv: process.env.NODE_ENV || "development",
  DATABASE_URL: process.env.DATABASE_URL,
  DIRECT_URL: process.env.DIRECT_URL,
  googleId : process.env.GOOGLE_CLIENT_ID as string,
  googleSecret: process.env.GOOGLE_CLIENT_SECRET as string,
  betterAuthUrl: process.env.BETTER_AUTH_URL as string,
  facebookId: process.env.FACEBOOK_CLIENT_ID as string,
  facebookSecret: process.env.FACEBOOK_CLIENT_SECRET as string,
  r2: {
    accountId: process.env.R2_ACCOUNT_ID as string,
    accessKeyId: process.env.R2_ACCESS_KEY_ID as string,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY as string,
    privateBucket: process.env.R2_PRIVATE_BUCKET_NAME as string,
    publicBucket: process.env.R2_PUBLIC_BUCKET_NAME as string,
    endpoint: process.env.R2_ENDPOINT as string,
    publicUrlBase: process.env.R2_PUBLIC_URL_BASE as string,
  },
  redis: {
    url: process.env.REDIS_URL as string,
  },
};
