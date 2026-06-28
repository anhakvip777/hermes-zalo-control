// =============================================================================
// Attendance Service — session CRUD, records, parse messages, export CSV
// =============================================================================

import { prisma } from "../db.js";
import type { MessageSender } from "./message-sender.js";

// ═══════════════════════════════════════════════════════════════════
// Session CRUD
// ═══════════════════════════════════════════════════════════════════

export interface CreateSessionInput {
  name: string;
  targetId: string;
  targetName?: string;
  scheduledAt?: string;
  expectedCount?: number;
}

export async function createSession(input: CreateSessionInput) {
  return prisma.attendanceSession.create({
    data: {
      name: input.name,
      targetId: input.targetId,
      targetName: input.targetName ?? null,
      status: input.scheduledAt ? "scheduled" : "draft",
      scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
      expectedCount: input.expectedCount ?? null,
    },
  });
}

export async function getSession(id: string) {
  return prisma.attendanceSession.findUnique({ where: { id } });
}

export async function listSessions(opts: {
  status?: string;
  page?: number;
  pageSize?: number;
}) {
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 50;
  const where: Record<string, unknown> = {};
  if (opts.status) where.status = opts.status;

  const [data, total] = await Promise.all([
    prisma.attendanceSession.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.attendanceSession.count({ where }),
  ]);
  return { data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
}

export async function updateSession(
  id: string,
  input: Partial<CreateSessionInput & { status: string }>,
) {
  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.targetId !== undefined) data.targetId = input.targetId;
  if (input.targetName !== undefined) data.targetName = input.targetName;
  if (input.expectedCount !== undefined) data.expectedCount = input.expectedCount;
  if (input.scheduledAt !== undefined) {
    data.scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : null;
  }
  if (input.status !== undefined) data.status = input.status;

  return prisma.attendanceSession.update({ where: { id }, data });
}

export async function startSession(id: string) {
  return prisma.attendanceSession.update({
    where: { id },
    data: { status: "active", startedAt: new Date() },
  });
}

export async function closeSession(id: string) {
  const records = await prisma.attendanceRecord.count({ where: { sessionId: id } });
  return prisma.attendanceSession.update({
    where: { id },
    data: { status: "closed", endedAt: new Date(), actualCount: records },
  });
}

export async function cancelSession(id: string) {
  return prisma.attendanceSession.update({
    where: { id },
    data: { status: "cancelled" },
  });
}

// ═══════════════════════════════════════════════════════════════════
// Send Reminder
// ═══════════════════════════════════════════════════════════════════

const DEFAULT_REMINDER = "Các huynh đệ điểm danh giúp anh nhé. Ai có mặt nhắn: Có mặt hoặc Con có mặt.";

export async function sendReminder(
  sessionId: string,
  sender: MessageSender,
  customMessage?: string,
) {
  const session = await prisma.attendanceSession.findUnique({ where: { id: sessionId } });
  if (!session) throw new Error("Session not found");

  const content = customMessage || DEFAULT_REMINDER;
  const result = await sender.sendMessage(content, session.targetId, "group");

  await prisma.attendanceSession.update({
    where: { id: sessionId },
    data: { reminderSent: true },
  });

  return { sessionId, ...result };
}

// ═══════════════════════════════════════════════════════════════════
// Parse Messages for Attendance
// ═══════════════════════════════════════════════════════════════════

const ATTENDANCE_PATTERNS = [
  /\bcó mặt\b/i,
  /\bcon có mặt\b/i,
  /\bem có mặt\b/i,
  /\bđã có mặt\b/i,
  /\bdạ có mặt\b/i,
  /\bcó con\b/i,
  /\bđiểm danh\b/i,
  /\bpresent\b/i,
];

function isAttendanceReply(content: string): boolean {
  return ATTENDANCE_PATTERNS.some((p) => p.test(content));
}

export async function parseMessagesForAttendance(
  sessionId: string,
): Promise<{ created: number; skippedDuplicates: number; skippedNonReply: number }> {
  const session = await prisma.attendanceSession.findUnique({ where: { id: sessionId } });
  if (!session) throw new Error("Session not found");

  // Time window: from session start (or scheduledAt) to end (or now)
  const fromDate = session.startedAt ?? session.scheduledAt;
  if (!fromDate) throw new Error("Session has no start time");

  const toDate = session.endedAt ?? new Date();

  const messages = await prisma.message.findMany({
    where: {
      threadId: session.targetId,
      isFromBot: false,
      receivedAt: { gte: fromDate },
    },
    orderBy: { receivedAt: "asc" },
  });
  // Also filter by toDate in-app (SQLite date comparison can differ from ISO string)
  const filteredMessages = messages.filter((m) => m.receivedAt <= toDate);

  let created = 0;
  let skippedDuplicates = 0;
  let skippedNonReply = 0;

  for (const msg of filteredMessages) {
    if (!isAttendanceReply(msg.content)) {
      skippedNonReply++;
      continue;
    }

    // Check duplicate
    const existing = await prisma.attendanceRecord.findUnique({
      where: { sessionId_userId: { sessionId, userId: msg.senderId ?? msg.id } },
    });

    if (existing) {
      skippedDuplicates++;
      continue;
    }

    await prisma.attendanceRecord.create({
      data: {
        sessionId,
        userId: msg.senderId ?? msg.id,
        userName: msg.senderName ?? null,
        response: msg.content,
        messageId: msg.id,
        checkedInAt: msg.receivedAt,
      },
    });
    created++;
  }

  // Update actualCount
  const total = await prisma.attendanceRecord.count({ where: { sessionId } });
  await prisma.attendanceSession.update({
    where: { id: sessionId },
    data: { actualCount: total },
  });

  return { created, skippedDuplicates, skippedNonReply };
}

// ═══════════════════════════════════════════════════════════════════
// Records
// ═══════════════════════════════════════════════════════════════════

export async function listRecords(sessionId: string) {
  return prisma.attendanceRecord.findMany({
    where: { sessionId },
    orderBy: { checkedInAt: "asc" },
  });
}

export async function upsertRecord(
  sessionId: string,
  userId: string,
  userName?: string | null,
  response?: string,
  messageId?: string,
) {
  return prisma.attendanceRecord.upsert({
    where: { sessionId_userId: { sessionId, userId } },
    update: {
      userName: userName ?? undefined,
      response: response ?? undefined,
      messageId: messageId ?? undefined,
      checkedInAt: new Date(),
    },
    create: {
      sessionId,
      userId,
      userName: userName ?? null,
      response: response ?? null,
      messageId: messageId ?? null,
    },
  });
}

// ═══════════════════════════════════════════════════════════════════
// Export CSV
// ═══════════════════════════════════════════════════════════════════

export async function exportCsv(sessionId: string): Promise<string> {
  const session = await prisma.attendanceSession.findUnique({ where: { id: sessionId } });
  if (!session) throw new Error("Session not found");

  const records = await prisma.attendanceRecord.findMany({
    where: { sessionId },
    orderBy: { checkedInAt: "asc" },
  });

  const header = "Tên,Phản hồi,Thời gian điểm danh";
  const rows = records.map((r) => {
    const name = csvEscape(r.userName ?? r.userId);
    const response = csvEscape(r.response ?? "");
    const time = r.checkedInAt.toISOString();
    return `${name},${response},${time}`;
  });

  return `Phiên: ${csvEscape(session.name)}\nNhóm: ${csvEscape(session.targetName ?? session.targetId)}\nSố người: ${records.length}\n\n${header}\n${rows.join("\n")}`;
}

function csvEscape(val: string): string {
  if (val.includes(",") || val.includes('"') || val.includes("\n")) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}
