// src/routes/admin.ts
import { Router } from "express";
import {
  createComicHandler,
  getComicPricingHandler,
  getThumbnailUploadUrlHandler,
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
  updateComicPricingSchema,
  updateComicStatusSchema,
} from "../validators/comic.schema.js";

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
router.post("/comics/thumbnail/upload-url", getThumbnailUploadUrlHandler);
router.post("/comics", validateBody(createComicSchema), createComicHandler);
router.get("/comics/:comicId/pricing", getComicPricingHandler);
router.put("/comics/:comicId/pricing", validateBody(updateComicPricingSchema), updateComicPricingHandler); 
router.patch("/comics/:comicId/status", validateBody(updateComicStatusSchema), updateComicStatusHandler);

// country routes
router.post("/countries/upload-url", getFlagUploadUrlHandler); // to upload the country flog image to the cloudflare
router.get("/countries", getAllCountriesHandler);
router.post("/countries", createCountryHandler); // to post the new country
router.put("/countries/:countryId", updateCountryHandler); // to update the existing country

export default router;
