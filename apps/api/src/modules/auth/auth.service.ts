import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../../lib/prisma.js";
import { env } from "../../config/env.js";

export type SessionUser = { id: string; email: string; role: string };

export async function authenticateAdmin(emailInput: string, password: string) {
  const email = emailInput.trim().toLowerCase();
  const user = await prisma.adminUser.findUnique({ where: { email } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) return null;
  const sessionUser: SessionUser = { id: user.id, email: user.email, role: user.role };
  const token = jwt.sign({ email: user.email, role: user.role }, env.JWT_SECRET, { subject: user.id, expiresIn: "8h", issuer: "tutorlink-ai-marketing-manager", audience: "tutorlink-admin" });
  await prisma.auditEvent.create({ data: { actor: user.id, action: "AUTH_LOGIN_SUCCESS", entityType: "AdminUser", entityId: user.id, details: { email: user.email } } });
  return { token, user: sessionUser };
}

export function verifySession(token: string): SessionUser | null {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET, { issuer: "tutorlink-ai-marketing-manager", audience: "tutorlink-admin" });
    if (typeof payload === "string" || !payload.sub || !payload.email || !payload.role) return null;
    return { id: String(payload.sub), email: String(payload.email), role: String(payload.role) };
  } catch { return null; }
}
