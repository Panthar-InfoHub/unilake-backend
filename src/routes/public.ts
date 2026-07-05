import { Router } from "express";
import { 
  getPublicComicsHandler, 
  getPublicComicDetailsHandler 
} from "../controllers/comic.controller.js";
import { validateBody } from "../middlewares/validateBody.js";
import { createSessionSchema, photoUploadUrlSchema, photoValidateSchema, updateSessionSchema   } from "../validators/session.schema.js";
import { createPhotoUploadUrlHandler, createSessionHandler,getSessionHandler, updateSessionHandler, validateSessionPhotoHandler, generateSessionHandler, regeneratePageHandler  } from "../controllers/session.controller.js";
import { getAllThemesHandler } from "../controllers/theme.controller.js";
const router = Router();

router.get("/comics", getPublicComicsHandler);

router.get("/comics/:comicId", getPublicComicDetailsHandler);

router.post( "/sessions", validateBody(createSessionSchema), createSessionHandler);
router.patch('/sessions/:sessionId', validateBody(updateSessionSchema), updateSessionHandler);

router.get("/sessions/:sessionId", getSessionHandler);

router.post('/sessions/:sessionId/photo/upload-url', validateBody(photoUploadUrlSchema), createPhotoUploadUrlHandler );


router.post( '/sessions/:sessionId/photo/validate', validateBody(photoValidateSchema), validateSessionPhotoHandler );

router.post("/sessions/:sessionId/generate", generateSessionHandler);

router.post("/sessions/:sessionId/pages/:pageNumber/regenerate", regeneratePageHandler);



// theme endpoint : 

router.get("/themes", getAllThemesHandler);

export default router;