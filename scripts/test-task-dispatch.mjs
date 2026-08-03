import assert from "node:assert/strict";
import collectionHandler from "../api/tasks/index.js";
import taskHandler from "../api/tasks/[id].js";
import myTasksHandler from "../api/my-tasks.js";

const TASK_ID = "10000000-0000-4000-8000-000000000001";
const ENTRY_ID = "20000000-0000-4000-8000-000000000001";

const collectionRoutes = [
  ["GET", "/api/tasks"],
  ["POST", "/api/tasks"],
];

const catchAllRoutes = [
  ["GET", `/api/tasks/${TASK_ID}`],
  ["GET", `/api/tasks/${TASK_ID}/history`],
  ["GET", `/api/tasks/${TASK_ID}/time-entries`],
  ["PATCH", `/api/tasks/${TASK_ID}/draft`],
  ["POST", `/api/tasks/${TASK_ID}/assign`],
  ["POST", `/api/tasks/${TASK_ID}/approve-draft`],
  ["POST", `/api/tasks/${TASK_ID}/approve-and-assign`],
  ["POST", `/api/tasks/${TASK_ID}/start`],
  ["POST", `/api/tasks/${TASK_ID}/submit`],
  ["POST", `/api/tasks/${TASK_ID}/submit-without-time`],
  ["POST", `/api/tasks/${TASK_ID}/start-revision`],
  ["POST", `/api/tasks/${TASK_ID}/request-revision`],
  ["POST", `/api/tasks/${TASK_ID}/approve`],
  ["POST", `/api/tasks/${TASK_ID}/cancel`],
  ["POST", `/api/tasks/${TASK_ID}/reopen`],
  ["POST", `/api/tasks/${TASK_ID}/archive`],
  ["POST", `/api/tasks/${TASK_ID}/time-entries/${ENTRY_ID}/correct`],
];

for (const [method, url] of collectionRoutes) {
  const result = await invoke(collectionHandler, method, url);
  assert.equal(result.status, 401, `${method} ${url} should preserve auth gate`);
  assert.equal(result.body.error.code, "AUTH_REQUIRED", `${method} ${url} should reach collection handler`);
}

for (const [method, url] of catchAllRoutes) {
  const result = await invoke(taskHandler, method, url);
  assert.notEqual(result.status, 404, `${method} ${url} was not dispatched`);
  assert.notEqual(result.status, 405, `${method} ${url} rejected a supported method`);
  assert.equal(result.status, 401, `${method} ${url} should preserve auth gate`);
  assert.equal(result.body.error.code, "AUTH_REQUIRED", `${method} ${url} should reach authenticated task handler`);
}


const rewriteRoutes = [
  ["GET", `/api/tasks/${TASK_ID}?_taskAction=history`],
  ["POST", `/api/tasks/${TASK_ID}?_taskAction=start`],
  ["POST", `/api/tasks/${TASK_ID}?_taskAction=approve-and-assign`],
  ["POST", `/api/tasks/${TASK_ID}?_taskAction=time-entry-correct&entryId=${ENTRY_ID}`],
];

for (const [method, url] of rewriteRoutes) {
  const result = await invoke(taskHandler, method, url);
  assert.notEqual(result.status, 404, `${method} ${url} was not dispatched from rewrite parameters`);
  assert.equal(result.status, 401, `${method} ${url} should preserve auth gate`);
  assert.equal(result.body.error.code, "AUTH_REQUIRED", `${method} ${url} should reach authenticated task handler`);
}

const unknownRewriteAction = await invoke(taskHandler, "POST", `/api/tasks/${TASK_ID}?_taskAction=unsupported`);
assert.equal(unknownRewriteAction.status, 404);
assert.equal(unknownRewriteAction.body.error.code, "NOT_FOUND");
const myTasks = await invoke(myTasksHandler, "GET", "/api/my-tasks");
assert.equal(myTasks.status, 401);
assert.equal(myTasks.body.error.code, "AUTH_REQUIRED");

const collectionWrongMethod = await invoke(collectionHandler, "PATCH", "/api/tasks");
assert.equal(collectionWrongMethod.status, 405);
assert.equal(collectionWrongMethod.headers.allow, "GET, POST");
assert.equal(collectionWrongMethod.body.error.code, "VALIDATION_ERROR");

const actionWrongMethod = await invoke(taskHandler, "GET", `/api/tasks/${TASK_ID}/start`);
assert.equal(actionWrongMethod.status, 405);
assert.equal(actionWrongMethod.headers.allow, "POST");
assert.equal(actionWrongMethod.body.error.code, "VALIDATION_ERROR");

const draftWrongMethod = await invoke(taskHandler, "POST", `/api/tasks/${TASK_ID}/draft`);
assert.equal(draftWrongMethod.status, 405);
assert.equal(draftWrongMethod.headers.allow, "PATCH");
assert.equal(draftWrongMethod.body.error.code, "VALIDATION_ERROR");

for (const url of [
  `/api/tasks/${TASK_ID}/unsupported`,
  "/api/tasks//start",
  `/api/tasks/${TASK_ID}/time-entries//correct`,
  `/api/tasks/${TASK_ID}/time-entries/${ENTRY_ID}/correct/extra`,
]) {
  const result = await invoke(taskHandler, "POST", url);
  assert.equal(result.status, 404, `${url} should be rejected by dispatcher`);
  assert.equal(result.body.error.code, "NOT_FOUND");
}

process.stdout.write(`PASS task route dispatch preserved ${collectionRoutes.length + catchAllRoutes.length} task URLs with safe 404/405 responses\n`);

async function invoke(handler, method, url) {
  const request = { method, url, query: {} };
  Object.defineProperty(request, "headers", { value: {}, enumerable: false });
  const response = responseFixture();
  await handler(request, response);
  return { status: response.statusCode, body: response.body, headers: response.headers };
}

function responseFixture() {
  return {
    statusCode: 0,
    headers: {},
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(value) { this.body = JSON.parse(value); },
  };
}



