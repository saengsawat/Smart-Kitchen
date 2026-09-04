import { buildApp } from "./app.js";

const port = Number(process.env["PORT"] ?? 3000);
const host = "0.0.0.0";

const app = buildApp();

app.listen({ port, host }).catch((error: unknown) => {
  app.log.error(error);
  process.exitCode = 1;
});
