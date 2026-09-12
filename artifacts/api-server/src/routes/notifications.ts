import { Router, type IRouter } from "express";
import { authenticate } from "../middleware/auth";
import {
  getNotificationConfig,
  listDevices,
  registerDevice,
  testHighPriorityAlert,
} from "../controllers/notificationController";

const router: IRouter = Router();

router.get("/notifications/config", getNotificationConfig);
router.post("/notifications/devices", authenticate, registerDevice);
router.get("/notifications/devices", authenticate, listDevices);
router.post("/notifications/test-alert", authenticate, testHighPriorityAlert);

export default router;