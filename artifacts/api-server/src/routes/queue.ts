import { Router, type IRouter } from "express";
import { authenticate, requireRole, requireApprovedDriver } from "../middleware/auth";
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
  requireApprovedDriver,
  antiFakeGPS,
  joinQueue,
);
router.delete("/queue/leave", authenticate, requireRole("driver"),
  requireApprovedDriver, leaveQueue);
router.patch(
  "/queue/location",
  authenticate,
  requireRole("driver"),
  requireApprovedDriver,
  antiFakeGPS,
  updateQueueLocation,
);
router.patch(
  "/queue/status",
  authenticate,
  requireRole("driver"),
  requireApprovedDriver,
  updateQueueStatus,
);

export default router;