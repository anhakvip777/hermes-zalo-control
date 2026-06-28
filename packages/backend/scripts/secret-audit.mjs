#!/usr/bin/env node
/**
 * Secret Audit Scanner — quét toàn bộ repo phát hiện hardcoded secrets.
 * Pure Node.js ESM — no TypeScript.
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { resolve, relative, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");
const REPO_ROOT = resolve(PROJECT_ROOT, "..", "..");

const STRICT = process.argv.includes("--strict");
const JSON_OUTPUT = process.argv.includes("--json");

const SKIP_GLOBS = [
  /node_modules/, /\.git\//, /\.next\//, /dist\//,
  /\.cache\//, /coverage\//, /\.hermes\//, /\.turbo\//,
];

const ALLOWLIST_PATH = resolve(PROJECT_ROOT, ".secret-auditignore");
let allowlistPatterns = [];

function loadAllowlist() {
  if (!existsSync(ALLOWLIST_PATH)) return;
  try {
    const lines = readFileSync(ALLOWLIST_PATH, "utf-8").split("\n")
      .map(l => l.trim()).filter(l => l && !l.startsWith("#"));
    allowlistPatterns = lines.map(l => new RegExp(l));
  } catch {}
}

function isAllowed(filePath) {
  const rel = relative(PROJECT_ROOT, filePath);
  return allowlistPatterns.some(p => p.test(rel) || p.test(filePath));
}

const SECRET_PATTERNS = [
  { name: "OpenAI key", regex: /sk-[A-Za-z0-9_-]{20,}/g, confidence: "HIGH" },
  { name: "Google API key", regex: /AIza[0-9A-Za-z_-]{20,}/g, confidence: "HIGH" },
  { name: "GitHub token", regex: /ghp_[A-Za-z0-9_]{20,}/g, confidence: "HIGH" },
  { name: "GitHub fine-grained", regex: /github_pat_[A-Za-z0-9_]{20,}/g, confidence: "HIGH" },
  { name: "Slack token", regex: /xox[baprs]-[A-Za-z0-9-]{20,}/g, confidence: "HIGH" },
  { name: "Bearer token", regex: /Bearer\s+[A-Za-z0-9._-]{20,}/g, confidence: "MEDIUM" },
  { name: "API key assign", regex: /api[_-]?key\s*[:=]\s*["'][^"']{12,}["']/gi, confidence: "MEDIUM" },
  { name: "Token assign", regex: /token\s*[:=]\s*["'][^"']{12,}["']/gi, confidence: "MEDIUM" },
  { name: "Password assign", regex: /password\s*[:=]\s*["'][^"']{8,}["']/gi, confidence: "MEDIUM" },
  { name: "Cookie assign", regex: /cookie\s*[:=]\s*["'][^"']{20,}["']/gi, confidence: "LOW" },
  { name: "Session assign", regex: /session\s*[:=]\s*["'][^"']{20,}["']/gi, confidence: "LOW" },
  { name: "JWT token", regex: /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/g, confidence: "MEDIUM" },
  { name: "AWS key", regex: /AKIA[0-9A-Z]{16}/g, confidence: "HIGH" },
];

const FAKE_VALUES = [
  "changeme", "change-me", "xxx", "test", "dummy",
  "example", "placeholder", "fake", "sk-fake",
  "dev-admin-password", "not-secure", "your-key-here",
];

function isFakeValue(match) {
  const lower = match.toLowerCase();
  return FAKE_VALUES.some(f => lower.includes(f));
}

const SENSITIVE_FILES = [
  /\.env$/, /\.env\.local$/, /zalo-session\.json$/,
  /credentials\.json$/, /dev\.db$/, /\.sqlite$/,
  /backups\//, /cookies\//, /session\.json$/,
];

const findings = [];
const warnings = [];

function addFinding(file, line, pattern, match, confidence) {
  findings.push({ file: relative(PROJECT_ROOT, file), line, pattern, match, confidence });
}

function shouldSkip(filePath) {
  return SKIP_GLOBS.some(g => g.test(filePath));
}

function walkDir(dir, callback) {
  if (shouldSkip(dir)) return;
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (shouldSkip(fullPath)) continue;
      if (entry.isDirectory()) {
        callback(fullPath, true);
        walkDir(fullPath, callback);
      } else if (entry.isFile()) {
        callback(fullPath, false);
      }
    }
  } catch {}
}

function scanFileContent(filePath) {
  if (isAllowed(filePath)) return;
  let content;
  try { content = readFileSync(filePath, "utf-8"); } catch { return; }
  const lines = content.split("\n");
  for (const { name, regex, confidence } of SECRET_PATTERNS) {
    regex.lastIndex = 0;
    for (let i = 0; i < lines.length; i++) {
      const matches = lines[i].matchAll(new RegExp(regex.source, regex.flags));
      for (const m of matches) {
        if (isFakeValue(m[0])) continue;
        addFinding(filePath, i + 1, name, m[0], confidence);
      }
    }
  }
}

function checkSensitiveFilename(filePath) {
  const basename = relative(PROJECT_ROOT, filePath);
  for (const pattern of SENSITIVE_FILES) {
    if (!pattern.test(basename)) continue;
    if (isAllowed(filePath)) continue;
    if (basename.includes(".env.example")) continue;
    if (basename.includes("dev.db") || basename.endsWith(".sqlite") || basename.includes("backups/")) {
      if (!checkGitignore(basename)) warnings.push("Sensitive file NOT in .gitignore: " + basename);
      continue;
    }
    if (basename.includes(".env") && !basename.includes(".env.example")) {
      warnings.push("⚠️  .env file found (not .env.example): " + basename);
      continue;
    }
    warnings.push("⚠️  Sensitive file: " + basename);
  }
}

const REQUIRED_GITIGNORE = [
  ".env", ".env.*", "!.env.example",
  "packages/backend/prisma/dev.db", "*.db", "*.sqlite",
  "packages/backend/backups/", "packages/backend/zalo-session/",
  "zalo-session.json", "credentials.json", "*.log",
];

function checkGitignore(filePath) {
  const gitignorePath = resolve(REPO_ROOT, ".gitignore");
  if (!existsSync(gitignorePath)) return false;
  const gitignoreLines = readFileSync(gitignorePath, "utf-8").split("\n")
    .map(l => l.trim()).filter(l => l && !l.startsWith("#"));

  // Convert to repo-relative path for gitignore matching
  const repoRel = relative(REPO_ROOT, filePath);

  for (const pattern of gitignoreLines) {
    if (!pattern) continue;
    // Convert gitignore glob to regex-ish: * → .*
    let regexStr = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*');
    if (pattern.endsWith("/")) regexStr += ".*";
    try {
      if (new RegExp("^" + regexStr).test(repoRel + (repoRel.includes("/") ? "" : ""))) return true;
    } catch { continue; }
  }
  return false;
}

function auditGitignore() {
  const gitignorePath = resolve(REPO_ROOT, ".gitignore");
  if (!existsSync(gitignorePath)) { warnings.push("❌ .gitignore not found!"); return; }
  const content = readFileSync(gitignorePath, "utf-8");
  // Check if gitignore lines as globs cover required patterns
  const lines = content.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("#"));
  
  for (const required of REQUIRED_GITIGNORE) {
    if (required.startsWith("!")) continue; // negation patterns are checked differently
    // Convert required pattern to test against gitignore globs
    let covered = false;
    for (const line of lines) {
      if (line.startsWith("!")) continue;
      let regexStr = line.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
      if (line.endsWith("/")) regexStr += ".*";
      try {
        if (new RegExp("^" + regexStr + "$").test(required)) { covered = true; break; }
        // Also check if pattern covers required (e.g., "*.db" covers "dev.db")
        if (new RegExp(regexStr).test(required)) { covered = true; break; }
      } catch { continue; }
    }
    if (!covered) {
      warnings.push("⚠️  .gitignore missing: " + required);
    }
  }

  // Also warn if .gitignore lacks negation for .env.example
  if (!content.includes(".env.example")) {
    warnings.push("⚠️  .gitignore should include !.env.example to allow tracking the example file");
  }
}

function maskSecret(value) {
  if (!value || value.length <= 8) return "***";
  return value.slice(0, 4) + "***" + value.slice(-4);
}

function main() {
  loadAllowlist();
  console.log("🔍 Secret Audit Scanner");
  console.log("📁 Project: " + PROJECT_ROOT + "\n");

  let scannedFiles = 0;
  walkDir(PROJECT_ROOT, (filePath, isDir) => {
    if (!isDir) { scannedFiles++; scanFileContent(filePath); }
    checkSensitiveFilename(filePath);
  });
  auditGitignore();

  if (JSON_OUTPUT) {
    console.log(JSON.stringify({
      findings: findings.map(f => ({ ...f, match: maskSecret(f.match) })),
      warnings,
      summary: {
        totalFindings: findings.length,
        highConfidence: findings.filter(f => f.confidence === "HIGH").length,
        mediumConfidence: findings.filter(f => f.confidence === "MEDIUM").length,
        lowConfidence: findings.filter(f => f.confidence === "LOW").length,
        totalWarnings: warnings.length, scannedFiles,
      },
    }, null, 2));
    return;
  }

  console.log("📊 Scanned " + scannedFiles + " files");
  if (findings.length === 0 && warnings.length === 0) {
    console.log("✅ No secrets or issues found!");
    process.exit(0);
  }

  if (findings.length > 0) {
    const highCount = findings.filter(f => f.confidence === "HIGH").length;
    console.log("\n🔴 Findings: " + findings.length + " (HIGH: " + highCount + ")");
    for (const f of findings) {
      const icon = f.confidence === "HIGH" ? "🔴" : f.confidence === "MEDIUM" ? "🟡" : "⚪";
      console.log("  " + icon + " [" + f.confidence + "] " + f.pattern + ": " + maskSecret(f.match));
      console.log("      File: " + f.file + ":" + f.line);
    }
  }

  if (warnings.length > 0) {
    console.log("\n⚠️  Warnings: " + warnings.length);
    for (const w of warnings) console.log("  " + w);
  }

  if (STRICT && findings.some(f => f.confidence === "HIGH")) {
    console.log("\n❌ STRICT mode: HIGH confidence secrets found — exit 1");
    process.exit(1);
  }
  console.log("\n✅ Audit complete.");
}

main();
