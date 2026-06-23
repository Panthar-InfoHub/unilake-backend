import express from "express";
import helmet from "helmet";
import cors from "cors";
import { pinoHttp } from "pino-http";
import { logger } from "./lib/logger.js";
import { errorHandler } from "./middlewares/errorHandler.js";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./lib/auth.js";
import { requireAdmin } from "./middlewares/requireAdmin.js";
import adminRoutes from "./routes/admin.js";
import publicRouter from "./routes/public.js";


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
app.use("/api/admin", requireAdmin, adminRoutes);
app.use("/api/public", publicRouter);

app.use(errorHandler);

export default app;
