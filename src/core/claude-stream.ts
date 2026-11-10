// Reads the newline-delimited JSON that `claude -p --output-format stream-json --verbose` prints.
// Only the few facts a ping needs are kept; every other event type, and every field this code does
// not know, is ignored so a newer Claude cannot break pings by adding to the stream.

export interface RateLimitWindow {
  /** Window name from Claude, e.g. "five_hour" or "seven_day". */
  type: string;
  /** "allowed", "allowed_warning" or "rejected". */
  status: string;
  resetsAt?: Date;
  /** Fraction of the window used, 0..1. */
  utilization?: number;
}

export interface ClaudeRun {
  resultText?: string;
  isError: boolean;
  subtype?: string;
  apiErrorStatus?: string | number;
  /** Tokens Claude read for the request (fresh + cached input), from the result's usage. */
  promptTokens?: number;
  /** The last rate-limit window Claude reported. */
  window?: RateLimitWindow;
  /** Claude produced an assistant message, a result or a rate-limit report, so the request reached the API. */
  sawResponse: boolean;
}

export interface StreamParser {
  push(chunk: string): void;
  finish(): ClaudeRun;
}

const EVENT = { assistant: 'assistant', result: 'result', rateLimit: 'rate_limit_event' } as const;
const UNKNOWN_WINDOW = 'unknown';
const MS_PER_SECOND = 1000;

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

// Claude reports reset times as Unix seconds.
function epochSecondsToDate(value: unknown): Date | undefined {
  const seconds = asNumber(value);
  return seconds !== undefined && seconds > 0 ? new Date(seconds * MS_PER_SECOND) : undefined;
}

const PROMPT_TOKEN_FIELDS = ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'] as const;

function sumPromptTokens(usage: unknown): number | undefined {
  if (!isObject(usage)) return undefined;
  const counts = PROMPT_TOKEN_FIELDS.map((field) => asNumber(usage[field])).filter((n): n is number => n !== undefined);
  return counts.length > 0 ? counts.reduce((sum, n) => sum + n, 0) : undefined;
}

function readWindow(info: JsonObject): RateLimitWindow {
  const type = asString(info.rateLimitType) ?? UNKNOWN_WINDOW;
  const windows = isObject(info.unifiedWindows) ? info.unifiedWindows : {};
  const detail = isObject(windows[type]) ? (windows[type] as JsonObject) : {};
  return {
    type,
    status: asString(info.status) ?? UNKNOWN_WINDOW,
    resetsAt: epochSecondsToDate(info.resetsAt),
    utilization: asNumber(detail.utilization),
  };
}

export function createStreamParser(): StreamParser {
  const run: ClaudeRun = { isError: false, sawResponse: false };
  let pending = '';

  function handleEvent(event: JsonObject): void {
    switch (event.type) {
      case EVENT.assistant:
        run.sawResponse = true;
        break;
      case EVENT.rateLimit:
        if (isObject(event.rate_limit_info)) {
          run.sawResponse = true;
          run.window = readWindow(event.rate_limit_info);
        }
        break;
      case EVENT.result: {
        const status = event.api_error_status;
        run.sawResponse = true;
        run.resultText = asString(event.result);
        run.isError = event.is_error === true;
        run.subtype = asString(event.subtype);
        run.promptTokens = sumPromptTokens(event.usage);
        run.apiErrorStatus = typeof status === 'string' || typeof status === 'number' ? status : undefined;
        break;
      }
    }
  }

  function handleLine(raw: string): void {
    const line = raw.trim();
    if (!line) return;
    try {
      const event: unknown = JSON.parse(line);
      if (isObject(event)) handleEvent(event);
    } catch {
      // Not JSON (a stray log line, or a line cut short): nothing to learn from it.
    }
  }

  return {
    push(chunk: string): void {
      pending += chunk;
      let newline = pending.indexOf('\n');
      while (newline !== -1) {
        handleLine(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
        newline = pending.indexOf('\n');
      }
    },
    finish(): ClaudeRun {
      handleLine(pending);
      pending = '';
      return { ...run };
    },
  };
}
