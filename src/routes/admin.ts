// src/routes/admin.ts
import { Router } from "express";
import {
  createComicHandler,
  deleteComicHandler,
  getAdminComicsHandler,
  getAdminComicDetailHandler,
  getComicPricingHandler,
  getLoraUploadUrlHandler,
  getThumbnailUploadUrlHandler,
  updateComicHandler,
  updateComicPricingHandler,
  updateComicStatusHandler,
} from "../controllers/comic.controller.js";
import {
  createCountryHandler,
  deleteCountryHandler,
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
import { createHeroImageSchema, getHeroImageUploadUrlSchema } from "../validators/heroImage.schema.js";
import { createHeroImageHandler, deleteHeroImageHandler, getAllHeroImagesHandler, getHeroImageUploadUrlHandler, toggleHeroImageStatusHandler } from "../controllers/heroImage.controller.js";
import { createCustomerReviewSchema, getCustomerReviewUploadUrlSchema } from "../validators/customerReview.schema.js";
import { createCustomerReviewHandler, deleteCustomerReviewHandler, getAllCustomerReviewsHandler, getCustomerReviewUploadUrlHandler, toggleCustomerReviewStatusHandler } from "../controllers/customerReview.controller.js";
import { createTeamMemberSchema, getTeamMemberUploadUrlSchema, updateTeamMemberSchema } from "../validators/teamMember.schema.js";
import { createTeamMemberHandler, deleteTeamMemberHandler, getActiveTeamMembersHandler, getAllTeamMembersHandler, getTeamMemberUploadUrlHandler, toggleTeamMemberStatusHandler, updateTeamMemberHandler } from "../controllers/teamMember.controller.js";
import { deleteFeedbackHandler, getAllFeedbacksHandler, updateFeedbackStatusHandler } from "../controllers/feedback.controller.js";
import { updateFeedbackStatusSchema } from "../validators/feedback.schema.js";


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
router.get("/comics/:comicId", getAdminComicDetailHandler); // single comic full detail 
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
router.delete("/countries/:countryId", deleteCountryHandler); // delete country (blocks if pricing rules reference it)




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



// hero images routes 
router.post("/hero-images/upload-url", validateBody(getHeroImageUploadUrlSchema), getHeroImageUploadUrlHandler)
router.post("/hero-images", validateBody(createHeroImageSchema), createHeroImageHandler);
router.patch("/hero-images/:id/status", toggleHeroImageStatusHandler);
router.get("/hero-images", getAllHeroImagesHandler);
router.delete("/hero-images/:id", deleteHeroImageHandler);


// customer Reviews
router.post("/customer-reviews/upload-url", validateBody(getCustomerReviewUploadUrlSchema), getCustomerReviewUploadUrlHandler);
router.post("/customer-reviews", validateBody(createCustomerReviewSchema), createCustomerReviewHandler);
router.patch("/customer-reviews/:id/status", toggleCustomerReviewStatusHandler);
router.delete("/customer-reviews/:id", deleteCustomerReviewHandler);
router.get("/customer-reviews", getAllCustomerReviewsHandler);



// team member's 
router.post("/team-members/upload-url", validateBody(getTeamMemberUploadUrlSchema), getTeamMemberUploadUrlHandler);
router.post("/team-members", validateBody(createTeamMemberSchema), createTeamMemberHandler);
router.patch("/team-members/:id", validateBody(updateTeamMemberSchema), updateTeamMemberHandler);
router.patch("/team-members/:id/status", toggleTeamMemberStatusHandler);
router.delete("/team-members/:id", deleteTeamMemberHandler);
router.get("/team-members", getAllTeamMembersHandler);
router.get("/team-members", getActiveTeamMembersHandler);



// feedback
router.get("/feedbacks", getAllFeedbacksHandler);
router.patch("/feedbacks/:id/status", validateBody(updateFeedbackStatusSchema), updateFeedbackStatusHandler);
router.delete("/feedbacks/:id", deleteFeedbackHandler);


export default router;