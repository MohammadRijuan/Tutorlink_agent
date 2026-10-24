import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient() {
  return new PrismaClient({ log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"] });
}

function client(): PrismaClient {
  // Created on first use so importing modules (and running pure-function unit tests) never needs a database or a generated client.
  return (globalForPrisma.prisma ??= createClient());
}

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const value = Reflect.get(client() as object, property);
    return typeof value === "function" ? value.bind(client()) : value;
  },
});
