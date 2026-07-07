import { Router } from "express";
import { 
  getPublicComicsHandler, 
  getPublicComicDetailsHandler 
} from "../controllers/comic.controller.js";
import { validateBody } from "../middlewares/validateBody.js";
import { createSessionSchema, photoUploadUrlSchema, photoValidateSchema, updateSessionSchema   } from "../validators/session.schema.js";
import { createPhotoUploadUrlHandler, createSessionHandler,getSessionHandler, updateSessionHandler, validateSessionPhotoHandler, generateSessionHandler, regeneratePageHandler  } from "../controllers/session.controller.js";
import { getAllThemesHandler } from "../controllers/theme.controller.js";
import { getActiveHeroImagesHandler } from "../controllers/heroImage.controller.js";
import { getActiveCustomerReviewsHandler } from "../controllers/customerReview.controller.js";
import { getActiveAnnouncementsHandler } from "../controllers/announcement.controller.js";
const router = Router();

// This will give the public comic
router.get("/comics", getPublicComicsHandler);
router.get("/comics/:comicId", getPublicComicDetailsHandler);// this will give details of a single comic


router.post( "/sessions", validateBody(createSessionSchema), createSessionHandler);// this will initiate the session with just comic ID
router.patch('/sessions/:sessionId', validateBody(updateSessionSchema), updateSessionHandler);// this will add the child details to the 
router.get("/sessions/:sessionId", getSessionHandler);// This will give the live session for the user to comeback and look at the comic 
router.post('/sessions/:sessionId/photo/upload-url', validateBody(photoUploadUrlSchema), createPhotoUploadUrlHandler );// this will give the upload URL to add child's picture
router.post( '/sessions/:sessionId/photo/validate', validateBody(photoValidateSchema), validateSessionPhotoHandler );// This will validate the Photo
router.post("/sessions/:sessionId/generate", generateSessionHandler);// This will generate the session 
router.post("/sessions/:sessionId/pages/:pageNumber/regenerate", regeneratePageHandler);// This endpoint will let the user generate a single photo



// theme endpoint : 

router.get("/themes", getAllThemesHandler);

// announcement : 
router.get("/announcements", getActiveAnnouncementsHandler);

// hero-image
router.get("/hero-images", getActiveHeroImagesHandler);


// customer reviews get endpoint : 
router.get("/customer-reviews", getActiveCustomerReviewsHandler);

export default router;