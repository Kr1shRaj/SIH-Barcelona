// structural = payload is malformed, becomes a 400
const STRUCTURAL = "structural";

// referential = payload is well formed but disagrees with what the server holds, becomes a 422
const REFERENTIAL = "referential";

// lead with the first real problem so a log line says what broke, not just that something did
function summarize(kind, issues) {
  const list = Array.isArray(issues) ? issues : [];
  if (list.length === 0) {
    return `${kind} validation failed`;
  }
  const first = list[0];
  const where = first.path ? `${first.path}: ` : "";
  const more = list.length > 1 ? ` (+${list.length - 1} more)` : "";
  return `${kind} validation failed — ${where}${first.message}${more}`;
}

// one error shape for both validation layers, kind picks the status code later
class ValidationError extends Error {
  constructor(kind, issues, message) {
    super(message || summarize(kind, issues));
    this.name = "ValidationError";
    this.kind = kind;
    this.issues = Array.isArray(issues) ? issues : [];
  }
}

// flatten a zod error into our own issue list, routes never see zod types
function issuesFromZod(zodError) {
  return zodError.issues.map((issue) => ({
    path: issue.path.join("."),
    code: issue.code,
    message: issue.message
  }));
}

// hand build one issue for checks zod cannot do on its own
function makeIssue(path, code, message) {
  return { path, code, message };
}

module.exports = {
  ValidationError,
  issuesFromZod,
  makeIssue,
  STRUCTURAL,
  REFERENTIAL
};
