import { Zalo } from "zca-js";
import { mkdirSync, writeFileSync } from "fs";

const zalo = new Zalo();
console.log("Starting Zalo login...");
try {
  const api = await zalo.loginQR();
  const ownId = api.getOwnId?.() ?? "unknown";
  const ownName = api.getOwnName?.() ?? "unknown";
  console.log("LOGIN OK: " + ownId + " - " + ownName);
  mkdirSync("./zalo-session", { recursive: true });
  writeFileSync("./zalo-session/zalo-session.json", JSON.stringify({
    selfUserId: ownId, selfDisplayName: ownName, savedAt: new Date().toISOString()
  }));
  console.log("Session saved");
} catch (err) {
  console.error("FAIL:", err);
  process.exit(1);
}

