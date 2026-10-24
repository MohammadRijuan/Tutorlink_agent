import type { NextFunction, Request, Response } from "express";
import { verifySession } from "./auth.service.js";

declare global { namespace Express { interface Request { adminUser?: { id: string; email: string; role: string } } } }

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : "";
  const user = token ? verifySession(token) : null;
  if (!user) return res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Please sign in to continue." } });
  req.adminUser = user;
  return next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.adminUser || req.adminUser.role !== "ADMIN") return res.status(403).json({ error: { code: "FORBIDDEN", message: "Administrator permission required." } });
  return next();
}
