import { Router, type IRouter } from "express";
import { authenticate, requireRole } from "../middleware/auth";
import { antiFakeGPS } from "../middleware/antiFakeGPS";
import {
  getQueueStatus,
  joinQueue,
  leaveQueue,
  updateQueueLocation,
  updateQueueStatus,
} from "../controllers/queueController";

const router: IRouter = Router();

router.get("/queue", authenticate, getQueueStatus);
router.post(
  "/queue/join",
  authenticate,
  requireRole("driver"),
  antiFakeGPS,
  joinQueue,
);
router.delete("/queue/leave", authenticate, requireRole("driver"), leaveQueue);
router.patch(
  "/queue/location",
  authenticate,
  requireRole("driver"),
  antiFakeGPS,
  updateQueueLocation,
);
router.patch(
  "/queue/status",
  authenticate,
  requireRole("driver"),
  updateQueueStatus,
);

export default router;