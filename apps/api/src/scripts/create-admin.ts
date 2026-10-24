import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma.js";
import { env } from "../config/env.js";

async function main() {
  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) {
    throw new Error("Set ADMIN_EMAIL and ADMIN_PASSWORD in apps/api/.env before running npm run admin:create -w @tutorlink/api");
  }
  const email = env.ADMIN_EMAIL.trim().toLowerCase();
  const passwordHash = await bcrypt.hash(env.ADMIN_PASSWORD, 12);
  await prisma.adminUser.upsert({
    where: { email },
    create: { email, passwordHash, role: "ADMIN" },
    update: { passwordHash, role: "ADMIN" },
  });
  console.log(`Administrator account ready: ${email}`);
}
main().catch((error) => { console.error(error instanceof Error ? error.message : "Admin setup failed"); process.exitCode = 1; }).finally(async () => prisma.$disconnect());
