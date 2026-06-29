# Admin User Guide

## Overview

The Admin Center provides a web dashboard at `http://localhost:3001` for managing all aspects of the Zalo bot system.

## Key Pages

### /production-readiness
Production readiness gate. Shows all safety checks (dryRun, secrets, allowed threads, backup status, process lock) with PASS/WARN/FAIL status. Must show `READY_FOR_LIVE` before any real sends.

### /safety-mode
Global safety controls:
- **dryRun toggle** — enable/disable real Zalo sends
- **Emergency stop** — halt all operations
- **Live test** — start controlled real send (maxMessages + TTL)

### /zalo-ops
Zalo connection management:
- Connection status (connected/disconnected)
- QR login (if needed)
- Session restore
- Self user info

### /runtime-settings
Hot-reloadable config (no restart needed):
- `autoReply.cooldownSeconds` — cooldown between replies
- `autoReply.allowedThreads` — which threads can receive auto-replies
- `autoReply.enabled` — toggle auto-reply
- `messageBatching.windowMs` — debounce window
- `messageBatching.enabled` — toggle batching
- `messageBatching.maxMessages` — max per batch

### /rules
Rule engine management:
- Create keyword/regex triggers
- Map to `fixed_reply`, `route_to_hermes`, or `ignore` actions
- Per-rule cooldown
- Target specific threads

### /documents
Document ingestion:
- Upload PDF/TXT/MD/CSV files
- View processing status
- Chunks and text previews
- Ask questions about documents via Zalo

### /messages
Message history:
- Inbound/outbound messages
- Filter by thread, direction, type
- View AI responses and confidence scores

### /errors
Error dashboard:
- AgentTask failures
- Schedule execution failures
- Outbound blocks
- System heartbeat status

### /system-health
System monitoring:
- Heartbeats (backend, worker, listener, pipeline)
- Alert history
- Process health

### /thread-review
Thread management:
- Known threads list
- Per-thread auto-reply enable/disable
- Media and image understanding toggles

## Common Tasks

### Send a test message safely
1. Verify `/production-readiness` shows READY_FOR_LIVE
2. Go to `/safety-mode` → Live Test → Start
3. Set threadId, maxMessages=1, ttlSeconds=300
4. Send test DM — one real reply will be sent
5. After quota, system auto-reverts to dryRun

### Check why a message wasn't replied to
1. Go to `/messages` — find the inbound message
2. Go to `/errors` — check AgentTask status
3. Check `/system-health` — verify listener is active

### Add a new allowed thread
1. Go to `/runtime-settings`
2. Edit `autoReply.allowedThreads`
3. Add thread IDs (comma-separated)
4. Save — takes effect immediately
