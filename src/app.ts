import express from "express";
import helmet from "helmet";
import cors from "cors";
import { pinoHttp } from "pino-http";
import { logger } from "./lib/logger.js";
import { errorHandler } from "./middlewares/errorHandler.js";
import { NotFoundError } from "./utils/errors.js";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./lib/auth.js";
import { uploadFile, getPublicUrl, getSignedDownloadUrl } from "./lib/r2.js";
import { asyncHandler } from "./utils/asyncHandler.js";

const app = express();

app.use(
  pinoHttp({
    logger: logger,
  })
);
app.use(
  cors({
    origin: "http://localhost:3000",
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
  })
);
app.use(helmet());
app.all("/api/auth/*splat", toNodeHandler(auth));
app.use(express.json());

app.get("/health", (req, res) => {
  res.send("Logger is working!");
});

app.get("/test-404-envelope", (req, res, next) => {
  next(new NotFoundError("test"));
});

app.use(errorHandler);

export default app;

// This is the route that chekcs if the clodflare is working correctly or not : just start the server and in the browser go on the route: http://localhost:8080/test-r2-buckets

// app.get("/test-r2-buckets", asyncHandler(async (req, res) => {
//   // 1. Create a simple text file in memory
//   const fileBuffer = Buffer.from("Hello world! This is a test file from the server.");
//   const contentType = "text/plain";

//   // 2. Define unique keys
//   const publicKey = `test/public-${Date.now()}.txt`;
//   const privateKey = `test/private-${Date.now()}.txt`;

//   // 3. Upload to both buckets
//   await uploadFile("public", publicKey, fileBuffer, contentType);
//   await uploadFile("private", privateKey, fileBuffer, contentType);

//   // 4. Generate the URLs to test
//   const publicUrl = getPublicUrl(publicKey);

//   // Generate a private signed URL that expires in exactly 15 seconds
//   const privateSignedUrl = await getSignedDownloadUrl(privateKey, 15);

//   // Construct what the "plain" private URL would look like if someone tried to guess it
//   // (Assuming your public base URL structure is similar)
//   const privatePlainUrlGuess = publicUrl.replace("pub-", "priv-").replace(publicKey, privateKey);

//   // 5. Send back the links
//   res.status(200).json({
//     success: true,
//     data: {
//       instructions: "Click these links in your browser to verify security.",
//       tests: {
//         publicPlain: publicUrl,
//         privatePlainGuess: privatePlainUrlGuess,
//         privateSigned: privateSignedUrl,
//       }
//     }
//   });
// }));
