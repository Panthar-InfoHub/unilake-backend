// src/routes/admin.ts
import { Router } from "express";
import {
  createComicHandler,
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


// this one will give the upload url of the thumbnail
router.post("/comics/thumbnail/upload-url", getThumbnailUploadUrlHandler);

// this will update the details of the comic
router.patch( "/comics/:comicId", validateBody(updateComicSchema), updateComicHandler );

// this will create the comic
router.post("/comics", validateBody(createComicSchema), createComicHandler);

// this will get the pricing of the comic
router.get("/comics/:comicId/pricing", getComicPricingHandler);

// this will update the pricing of the coimc 
router.put(
  "/comics/:comicId/pricing",
  validateBody(updateComicPricingSchema),
  updateComicPricingHandler
);

// This is for updating the status of the coimc to publish or to anything
router.patch(
  "/comics/:comicId/status",
  validateBody(updateComicStatusSchema),
  updateComicStatusHandler
);

// This will give he URL to upload the pages of the comic
router.post(
  "/comics/:comicId/pages/upload-url",
  validateBody(getPageArtworkUploadUrlSchema),
  getPageArtworkUploadUrlHandler
);


// This route is for the uploading the lora file on to the private file each comic 
router.post(
  "/comics/lora/upload-url",
  validateBody(getLoraUploadUrlSchema),
  getLoraUploadUrlHandler
)


// this will map the bubble 
router.post(
  "/pages/:pageId/bubbles",
  validateBody(createBubbleSchema),
  createBubbleHandler
);

// this will give the upload url for the font
router.post(
  "/comics/:comicId/fonts/upload-url",
  validateBody(getFontUploadUrlSchema),
  getFontUploadUrlHandler
);


// this will uplload the fonts to the comic
router.post(
  "/comics/:comicId/fonts",
  validateBody(createFontSchema),
  createFontHandler
);


// country routes
router.post("/countries/upload-url", getFlagUploadUrlHandler); // to upload the country flog image to the cloudflare
router.get("/countries", getAllCountriesHandler);
router.post("/countries", createCountryHandler); // to post the new country
router.put("/countries/:countryId", updateCountryHandler); // to update the existing country

export default router;