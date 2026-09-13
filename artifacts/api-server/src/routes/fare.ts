import { Router, type IRouter } from "express";
import { authenticate } from "../middleware/auth";
import { estimateFare, listFareStops } from "../controllers/fareController";

const router: IRouter = Router();

router.get("/fares/stops", authenticate, listFareStops);
router.post("/fares/estimate", authenticate, estimateFare);

export default router;