// Import this FIRST in any test that touches modules reading config/env.ts.
process.env.DATABASE_URL ||= "postgresql://test:test@127.0.0.1:5432/test";
process.env.DIRECT_URL ||= "postgresql://test:test@127.0.0.1:5432/test";
process.env.JWT_SECRET ||= "test-jwt-secret-012345678901234567890";
process.env.CRON_SECRET ||= "test-cron-secret-012345678901234567890";
process.env.GEMINI_API_KEY ||= "test-gemini-key";
process.env.GROQ_API_KEY ||= "test-groq-key";
process.env.META_PAGE_ID ||= "123456789";
process.env.META_MESSENGER_URL ||= "https://m.me/TutorLinkTest";
export {};
