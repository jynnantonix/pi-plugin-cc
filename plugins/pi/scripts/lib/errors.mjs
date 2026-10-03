// Refused before spawn: the caller fixed something wrong with the request.
export class UsageError extends Error {
  exitCode = 2;
}
