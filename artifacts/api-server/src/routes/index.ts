import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import queueRouter from "./queue";
import orderRouter from "./order";
import notificationRouter from "./notifications";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(queueRouter);
router.use(orderRouter);
router.use(notificationRouter);

export default router;
