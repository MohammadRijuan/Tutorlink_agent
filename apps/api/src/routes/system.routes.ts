import { Router } from "express";
import { getDiagnostics, getHealth, getSystemStatus } from "../controllers/system.controller.js";

export const systemRouter = Router();
const asyncRoute = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => Promise.resolve(fn(req, res)).catch(next);
systemRouter.get("/health", getHealth);
systemRouter.get("/status", asyncRoute(getSystemStatus));
systemRouter.get("/diagnostics", asyncRoute(getDiagnostics));
