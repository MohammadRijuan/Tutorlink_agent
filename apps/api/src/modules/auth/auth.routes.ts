import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { authenticateAdmin } from "./auth.service.js";
import { requireAuth } from "./auth.middleware.js";

export const authRouter = Router();
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: "draft-7", legacyHeaders: false, message: { error: { code: "LOGIN_RATE_LIMITED", message: "Too many sign-in attempts. Try again in 15 minutes." } } });
const loginSchema = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(200) });

authRouter.post("/login", loginLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: "INVALID_INPUT", message: "Enter a valid email and password." } });
  try {
    const result = await authenticateAdmin(parsed.data.email, parsed.data.password);
    if (!result) return res.status(401).json({ error: { code: "INVALID_CREDENTIALS", message: "Email or password is incorrect." } });
    return res.json({ token: result.token, user: result.user, expiresIn: 28800 });
  } catch {
    return res.status(500).json({ error: { code: "AUTH_UNAVAILABLE", message: "Sign-in is temporarily unavailable." } });
  }
});

authRouter.get("/me", requireAuth, (req, res) => res.json({ user: req.adminUser }));
