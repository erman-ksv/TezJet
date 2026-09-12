import { Router, type IRouter } from "express";
import { authenticate } from "../middleware/auth";
import { normalizeAddress } from "../controllers/addressController";

const router: IRouter = Router();

router.post("/addresses/normalize", authenticate, normalizeAddress);

export default router;