// Vercel serverless entry. The TypeScript source is compiled to dist/ by `npm run build` (see vercel.json),
// so Vercel deploys plain, already type-checked JavaScript. Local development uses src/server.ts.
import { createApp } from "../dist/app.js";

export default createApp();
