// =============================================================================
// Manual Zalo Login Script
// Run from repo root: npx tsx packages/backend/scripts/zalo-login.ts
// QR path: packages/backend/zalo-session/qr-current.png
// NEVER prints cookie/token/session VALUES — only booleans.
// =============================================================================

import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Zalo } from "zca-js";

const PROJECT_ROOT = process.cwd();
const SESSION_DIR = path.resolve(PROJECT_ROOT, "packages", "backend", "zalo-session");
const QR_TARGET = path.join(SESSION_DIR, "qr-current.png");
const SESSION_PATH = path.join(SESSION_DIR, "zalo-session.json");

async function findAndCopyQrToTarget(): Promise<boolean> {
  // zca-js v2 writes qr.png to CWD or the directory where node is invoked.
  // We scan common paths and copy the freshest one to SESSION_DIR.
  const candidates = [
    path.resolve(PROJECT_ROOT, "qr.png"),
    path.resolve(process.cwd(), "qr.png"),
    "/home/anhakvip777/.hermes/zalo/qr.png",
  ];
  for (const c of candidates) {
    try {
      if (existsSync(c)) {
        const st = statSync(c);
        const age = Date.now() - st.mtimeMs;
        if (age < 90_000 && st.size > 1000) {
          if (c !== QR_TARGET) {
            copyFileSync(c, QR_TARGET);
            console.log("  QR found at: " + c);
            console.log("  Copied to:   " + QR_TARGET);
          }
          return true;
        }
      }
    } catch { /* skip */ }
  }
  // Scan root for any qr*.png created in last 90 seconds
  try {
    for (const f of readdirSync(PROJECT_ROOT)) {
      if (f.startsWith("qr") && f.endsWith(".png")) {
        const fp = path.resolve(PROJECT_ROOT, f);
        if (statSync(fp).size > 1000) {
          copyFileSync(fp, QR_TARGET);
          console.log("  QR found: " + fp);
          console.log("  Copied to: " + QR_TARGET);
          return true;
        }
      }
    }
  } catch { /* skip */ }
  return false;
}

async function main() {
  console.log("Hermes Zalo Control — Manual QR Login");
  console.log("");

  mkdirSync(SESSION_DIR, { recursive: true });

  const zalo = new Zalo();
  console.log("QR will be saved to: " + QR_TARGET);
  console.log("Scan the QR code with Zalo app now.");
  console.log("");

  let capturedCredentials: Record<string, unknown> | null = null;
  let selfId: string | null = null;
  let selfName: string | null = null;

  try {
    const api = await zalo.loginQR(
      {
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
        language: "vi",
        qrPath: QR_TARGET,
      },
      (event: { type: string; data: { cookie: unknown; imei: string; userAgent: string } }) => {
        if (event.type === "GotLoginInfo" && event.data) {
          capturedCredentials = {
            imei: event.data.imei ?? null,
            cookie: event.data.cookie ?? null,
            userAgent: event.data.userAgent ?? null,
            language: "vi",
          };
        }
      },
    );

    selfId = api.getOwnId?.() ?? null;
    selfName = api.getOwnName?.() ?? null;

    console.log("LOGIN SUCCESS");

    // Copy QR to target if zca-js wrote elsewhere
    const qrCopied = await findAndCopyQrToTarget();
    if (!qrCopied) {
      console.log("  QR file not found at target, but login succeeded.");
    }

    const sessionData: Record<string, unknown> = {
      selfUserId: selfId,
      selfDisplayName: selfName ?? null,
      credentials: capturedCredentials,
      savedAt: new Date().toISOString(),
    };

    writeFileSync(SESSION_PATH, JSON.stringify(sessionData, null, 2), "utf-8");

    console.log("");
    console.log("Session saved: " + SESSION_PATH);
    console.log("  sessionSaved:         true");
    console.log("  credentialsNotNull:   " + (capturedCredentials !== null));
    console.log("  hasImei:              " + !!capturedCredentials?.imei);
    console.log("  hasCookie:            " + !!capturedCredentials?.cookie);
    console.log("  hasUserAgent:         " + !!capturedCredentials?.userAgent);
    console.log("  hasLanguage:          " + !!capturedCredentials?.language);
    console.log("  selfUserId:           " + (selfId !== null));
    console.log("");
    console.log("Next steps:");
    console.log("  pm2 restart hermes-api --update-env");
    console.log("  curl -u admin:<pw> http://127.0.0.1:3002/api/zalo/status");
    console.log("  Expected: connected=true, dryRun=false");

    process.exit(0);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("LOGIN FAILED: " + msg);
    console.error("Re-run the script to try again.");
    process.exit(1);
  }
}

main();
