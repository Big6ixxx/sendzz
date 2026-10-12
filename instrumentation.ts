/**
 * Runs once when the server starts.
 *
 * In production every console line starts with when it happened and how serious it is
 * (`2026-10-12T14:18:40.845Z ERROR …`), and errors are printed as one line (message, cause,
 * status and the file they came from) instead of a minified stack. See lib/log-format.ts.
 * Development keeps the console as it is, with full stacks that point at real source.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV !== "production") return;

  const { compactErrorArgs, logPrefix } = await import("./lib/log-format");
  for (const level of ["error", "warn", "log", "info"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      const line = compactErrorArgs(args);
      // Joined onto a leading string rather than added in front, so `%s`-style formatting in
      // that string still applies to the arguments after it.
      if (typeof line[0] === "string") line[0] = `${logPrefix(level)} ${line[0]}`;
      else line.unshift(logPrefix(level));
      original(...line);
    };
  }
}
