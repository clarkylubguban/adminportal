const MANILA_TIME_ZONE = "Asia/Manila";
const TERMINAL_STATUSES = new Set(["DONE", "CANCELLED"]);

const PROJECTION_TYPES = {
  scheduledStart: { label: "SCHEDULED START", priority: 10, field: "scheduledDate" },
  taskDeadline: { label: "TASK DEADLINE", priority: 20, field: "submissionDeadline" },
  reviewDeadline: { label: "REVIEW DEADLINE", priority: 30, field: "approvalDeadline" },
  completed: { label: "COMPLETED", priority: 40, field: "completedAt" },
};

export function buildTaskCalendar(tasks, filters = {}, now = new Date()) {
  const fromKey = toManilaDateKey(filters.from);
  const toKey = toManilaDateKey(filters.to);
  const events = [];

  for (const task of tasks || []) {
    for (const [type, config] of Object.entries(PROJECTION_TYPES)) {
      const dateTime = task?.[config.field];
      const dateKey = toManilaDateKey(dateTime);
      if (!dateKey) continue;
      if (fromKey && dateKey < fromKey) continue;
      if (toKey && dateKey > toKey) continue;
      if (filters.assignedUserId && task.assignedUserId !== filters.assignedUserId) continue;
      if (filters.sourceType && task.sourceType !== filters.sourceType) continue;
      if (filters.status && task.status !== filters.status) continue;
      events.push(projectCalendarEvent(task, type, config, dateTime, dateKey, now));
    }
  }

  events.sort(compareCalendarEvents);
  return {
    timeZone: MANILA_TIME_ZONE,
    from: fromKey,
    to: toKey,
    events,
    filters: buildFilterOptions(events),
  };
}

export function projectCalendarEvent(task, type, config, dateTime, dateKey, now = new Date()) {
  return {
    key: `${task.id}:${type}`,
    taskId: task.id,
    taskCode: task.taskCode,
    title: task.title,
    sourceType: task.sourceType,
    status: task.status,
    priority: task.priority,
    assignedUserId: task.assignedUserId || null,
    assignee: task.assignedUser || null,
    dateTime,
    dateKey,
    projectionType: config.label,
    projectionTypeKey: type,
    projectionPriority: config.priority,
    overdue: isCalendarEventOverdue(type, task.status, dateTime, now),
    taskPath: `/tasks/${encodeURIComponent(task.id)}`,
  };
}

export function toManilaDateKey(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: MANILA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

export function isCalendarEventOverdue(type, status, dateTime, now = new Date()) {
  if (type === "completed" || TERMINAL_STATUSES.has(status)) return false;
  const eventDate = Date.parse(dateTime || "");
  const current = now instanceof Date ? now.getTime() : Date.parse(now);
  return Number.isFinite(eventDate) && Number.isFinite(current) && eventDate < current;
}

function buildFilterOptions(events) {
  const assignees = new Map();
  const sourceTypes = new Set();
  const statuses = new Set();
  for (const event of events) {
    if (event.assignee?.displayName) assignees.set(event.assignee.displayName, event.assignee);
    if (event.sourceType) sourceTypes.add(event.sourceType);
    if (event.status) statuses.add(event.status);
  }
  return {
    assignees: [...assignees.values()].sort((a, b) => a.displayName.localeCompare(b.displayName)),
    sourceTypes: [...sourceTypes].sort(),
    statuses: [...statuses].sort(),
  };
}

function compareCalendarEvents(a, b) {
  return a.dateKey.localeCompare(b.dateKey)
    || Date.parse(a.dateTime || "") - Date.parse(b.dateTime || "")
    || Number(a.projectionPriority || 0) - Number(b.projectionPriority || 0)
    || String(a.taskCode || a.taskId).localeCompare(String(b.taskCode || b.taskId));
}
