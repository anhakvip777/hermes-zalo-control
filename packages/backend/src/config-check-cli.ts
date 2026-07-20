import { checkConfigOnStartup } from "./config-consistency.js";

if (process.argv.includes("--strict")) {
  process.env.STRICT_CONFIG_CHECK = "true";
}

try {
  await checkConfigOnStartup();
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[config-check] ${message}`);
  process.exitCode = 1;
}
