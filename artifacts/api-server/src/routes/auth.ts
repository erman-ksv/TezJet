import { Router, type IRouter } from "express";
import { authenticate } from "../middleware/auth";
import {
  getCurrentUser,
  logout,
  requestOtp,
  updateProfile,
  verifyOtp,
} from "../controllers/authController";

const router: IRouter = Router();

router.post("/auth/request-otp", requestOtp);
router.post("/auth/verify-otp", verifyOtp);
router.post("/auth/login", verifyOtp);
router.get("/auth/me", authenticate, getCurrentUser);
router.patch("/auth/profile", authenticate, updateProfile);
router.post("/auth/logout", authenticate, logout);

export default router;