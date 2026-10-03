// Refused before spawn: the caller must fix something in the request.
export class UsageError extends Error {
  exitCode = 2;
}
