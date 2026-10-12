/**
 * One-line errors for the production server log.
 *
 * `console.error("…:", err)` prints the whole stack, and in a production build every frame
 * points into a minified chunk (`lib_ramp_index_ts_0k8fx0x._.js:1:11691`). Ten such lines per
 * failure said nothing a person could act on and buried the failures that mattered.
 *
 * What is kept is what someone debugging needs: the error's own message, its cause, and the
 * first frame that belongs to our code — named by function and source file. Turbopack names
 * each server chunk after the file it came from, so `lib_ramp_index_ts_0k8fx0x._.js` reads
 * back as `lib/ramp/index.ts` without needing source maps.
 */

// Stack frames come in two shapes: `at fn (file:line:col)` and a bare `at file:line:col`.
const NAMED_FRAME = /^at (?:async )?(?:new )?(\S+) \((.+?):\d+:\d+\)$/;
const BARE_FRAME = /^at (?:async )?(.+?):\d+:\d+$/;
const CHUNK_FILE = /([^/\\]+?)_[0-9a-z]{5,}\._\.js$/i;
const FRAMEWORK = /next_dist|node_modules|node:internal|\[turbopack\]|\[root-of-the-server\]|webpack-runtime|react-dom|react-server/i;

/** `lib_ramp_index_ts` → `lib/ramp/index.ts`. Best effort: underscores in a real file name are ambiguous. */
function fileFromChunk(chunk: string): string {
  return chunk
    .replace(/_(tsx?|jsx?|mjs|cjs)$/i, ".$1")
    .replace(/_/g, "/");
}

/**
 * The first frame from our own code, as `functionName, path/to/file.ts`. Prefers a frame whose
 * file is named (shared chunks read back as just `lib`). Null when nothing is legible.
 */
export function originOf(stack: string | undefined): string | null {
  let fallback: string | null = null;
  for (const line of (stack ?? "").split("\n").slice(1)) {
    const frame = line.trim();
    const named = frame.match(NAMED_FRAME);
    const bare = named ? null : frame.match(BARE_FRAME);
    const rawName = named?.[1];
    const location = named?.[2] ?? bare?.[1];
    if (!location || FRAMEWORK.test(location)) continue;

    const chunk = location.match(CHUNK_FILE)?.[1];
    const file = chunk ? fileFromChunk(chunk) : location.replace(/^.*?(?=(?:app|lib|components|hooks)\/)/, "");
    // Minified frames are named `l`, `G`, `k.getRates`; keep the readable part, drop the noise.
    const name = rawName?.split(".").pop();
    const readable = name && name.length > 2 && name !== "<anonymous>" ? name : null;
    const origin = readable ? `${readable}, ${file}` : file;
    if (/\.[a-z]+$/i.test(file)) return origin;
    fallback ??= origin;
  }
  return fallback;
}

/** An Error as a single line: `Error: message (cause: …) [at fn, file]`. */
export function formatError(err: Error): string {
  const parts = [`${err.name}: ${err.message}`];
  const cause = err.cause;
  if (cause instanceof Error) parts.push(`(cause: ${cause.message})`);
  else if (typeof cause === "string") parts.push(`(cause: ${cause})`);
  const status = (err as { status?: number }).status;
  if (typeof status === "number") parts.push(`(HTTP ${status})`);
  const origin = originOf(err.stack);
  if (origin) parts.push(`[at ${origin}]`);
  return parts.join(" ");
}

/** Console arguments with every Error collapsed to one line; everything else untouched. */
export function compactErrorArgs(args: unknown[]): unknown[] {
  return args.map((a) => (a instanceof Error ? formatError(a) : a));
}

type LogLevel = "error" | "warn" | "log" | "info";

const LEVEL_LABEL: Record<LogLevel, string> = { error: "ERROR", warn: "WARN ", log: "INFO ", info: "INFO " };

/**
 * `2026-10-12T14:18:40.845Z ERROR` — when it happened, in UTC, and how serious it is. UTC so a
 * line reads the same whatever timezone the server or the reader is in; Lagos is UTC+1.
 */
export function logPrefix(level: LogLevel, at: Date = new Date()): string {
  return `${at.toISOString()} ${LEVEL_LABEL[level]}`;
}
