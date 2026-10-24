import { env } from "./config/env.js";
import { createApp } from "./app.js";
import { processDueContentJobs } from "./modules/jobs/jobs.service.js";
import { classifyFailure } from "./lib/retry.js";

const app = createApp();
app.listen(env.PORT, () => {
  console.log(`TutorLink AI Marketing Manager API listening on port ${env.PORT}`);
});

if (env.NODE_ENV === "development") {
  let workerRunning = false;
  const worker = setInterval(() => {
    if (workerRunning) return;
    workerRunning = true;
    void processDueContentJobs()
      .catch((error: unknown) => {
        const failure = classifyFailure(error);
        console.error(JSON.stringify({ event: "local_job_worker_failed", category: failure.category, message: failure.message }));
      })
      .finally(() => { workerRunning = false; });
  }, 15_000);
  worker.unref();
}
