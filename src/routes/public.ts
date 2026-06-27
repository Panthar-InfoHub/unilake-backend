import { Router } from "express";
import { 
  getPublicComicsHandler, 
  getPublicComicDetailsHandler 
} from "../controllers/comic.controller.js";
import { validateBody } from "../middlewares/validateBody.js";
import { createSessionSchema } from "../validators/session.schema.js";
import { createSessionHandler,getSessionHandler } from "../controllers/session.controller.js";
const router = Router();

router.get("/comics", getPublicComicsHandler);

router.get("/comics/:comicId", getPublicComicDetailsHandler);

router.post( "/sessions", validateBody(createSessionSchema), createSessionHandler);

router.get("/sessions/:sessionId", getSessionHandler);

export default router;