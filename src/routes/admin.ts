// src/routes/admin.ts
import { Router } from "express";
import {
  createComicHandler,
  deleteComicHandler,
  getAdminComicsHandler,
  getComicPricingHandler,
  getLoraUploadUrlHandler,
  getThumbnailUploadUrlHandler,
  updateComicHandler,
  updateComicPricingHandler,
  updateComicStatusHandler,
} from "../controllers/comic.controller.js";
import {
  createCountryHandler,
  getAllCountriesHandler,
  getFlagUploadUrlHandler,
  updateCountryHandler,
} from "../controllers/country.controller.js";
import { validateBody } from "../middlewares/validateBody.js";
import {
  createComicSchema,
  getLoraUploadUrlSchema,
  updateComicPricingSchema,
  updateComicSchema,
  updateComicStatusSchema,
} from "../validators/comic.schema.js";
import {
  createPageSchema,
  getPageArtworkUploadUrlSchema,
} from "../validators/page.schema.js";
import {
  createPageHandler,
  getPageArtworkUploadUrlHandler,
} from "../controllers/page.controller.js";
import { createBubbleSchema } from "../validators/bubble.schema.js";
import { createBubbleHandler } from "../controllers/bubble.controller.js";
import {
  getFontUploadUrlHandler,
  createFontHandler,
} from "../controllers/font.controller.js";
import {
  getFontUploadUrlSchema,
  createFontSchema,
} from "../validators/font.schema.js";
import { createThemeSchema, updateThemeSchema } from "../validators/theme.schema.js";
import { createThemeHandler, deleteThemeHandler, updateThemeHandler } from "../controllers/theme.controller.js";
import { createAnnouncementSchema, reorderAnnouncementsSchema, updateAnnouncementSchema } from "../validators/announcement.schema.js";
import { createAnnouncementHandler, deleteAnnouncementHandler, listAnnouncementsHandler, reorderAnnouncementsHandler, toggleAnnouncementStatusHandler, updateAnnouncementHandler } from "../controllers/announcement.controller.js";

const router = Router();

// Placeholder endpoint to verify the guard is working
router.get("/status", (req, res) => {
  res.json({
    success: true,
    message: "Admin router is active and guarded.",
    adminEmail: req.user?.email,
  });
});

// comic routes
router.get("/comics", getAdminComicsHandler); // get the comic rotues 
router.post("/comics/thumbnail/upload-url", getThumbnailUploadUrlHandler);// For uploading the thumbnail of the Comic
router.post("/comics", validateBody(createComicSchema), createComicHandler);// create comic 
router.delete("/comics/:comicId", deleteComicHandler);// delete comic
router.patch( "/comics/:comicId", validateBody(updateComicSchema), updateComicHandler );// update comic
router.get("/comics/:comicId/pricing", getComicPricingHandler); // Get comic pricing
router.put( "/comics/:comicId/pricing", validateBody(updateComicPricingSchema), updateComicPricingHandler );// update comic pricing
router.patch( "/comics/:comicId/status", validateBody(updateComicStatusSchema), updateComicStatusHandler ); // Publishing the status of comic

// PAGES 
router.post( "/comics/:comicId/pages/upload-url", validateBody(getPageArtworkUploadUrlSchema), getPageArtworkUploadUrlHandler);// This will give the uplodation URL for the comic
router.post( "/comics/lora/upload-url", validateBody(getLoraUploadUrlSchema), getLoraUploadUrlHandler)// This will give the Upload URL for the LORA file
router.post( "/pages/:pageId/bubbles", validateBody(createBubbleSchema), createBubbleHandler); // This will map the bubble
router.post( "/comics/:comicId/fonts/upload-url", validateBody(getFontUploadUrlSchema), getFontUploadUrlHandler);// this will give the upload URL for the Font
router.post( "/comics/:comicId/fonts", validateBody(createFontSchema), createFontHandler); // this will upload the fonts to the comic


// country routes
router.post("/countries/upload-url", getFlagUploadUrlHandler); // to upload the country flog image to the cloudflare
router.get("/countries", getAllCountriesHandler);
router.post("/countries", createCountryHandler); // to post the new country
router.put("/countries/:countryId", updateCountryHandler); // to update the existing country




// theme routes : 
router.post("/themes", validateBody(createThemeSchema), createThemeHandler);// create 
router.patch("/themes/:themeId", validateBody(updateThemeSchema), updateThemeHandler); // update
router.delete("/themes/:themeId", deleteThemeHandler); // delete
// get route is in public folder



// announcement routes
router.post('/announcements', validateBody(createAnnouncementSchema), createAnnouncementHandler);
router.patch('/announcements/reorder', validateBody(reorderAnnouncementsSchema), reorderAnnouncementsHandler);
router.patch('/announcements/:id', validateBody(updateAnnouncementSchema), updateAnnouncementHandler);
router.get('/announcements', listAnnouncementsHandler);
router.patch('/announcements/:id/status', toggleAnnouncementStatusHandler);
router.delete('/announcements/:id', deleteAnnouncementHandler);



export default router;