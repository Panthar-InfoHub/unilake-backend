import { Router } from "express";
import { 
  getPublicComicsHandler, 
  getPublicComicDetailsHandler 
} from "../controllers/comic.controller.js";

const router = Router();


router.get("/comics", getPublicComicsHandler);

router.get("/comics/:comicId", getPublicComicDetailsHandler);

export default router;