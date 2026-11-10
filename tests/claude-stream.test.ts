import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { createStreamParser, type ClaudeRun } from '../src/core/claude-stream.js';

// Scrubbed from a real `claude -p ping --output-format stream-json --verbose` run (Claude Code 2.1.319).
const REAL_SUCCESS_STREAM = fs.readFileSync(path.join(__dirname, 'fixtures', 'claude-stream-success.jsonl'), 'utf-8');

// Scrubbed from a real run made while the five-hour window was exhausted (exit code 1, HTTP 429).
const REAL_LIMIT_STREAM = fs.readFileSync(path.join(__dirname, 'fixtures', 'claude-stream-limit.jsonl'), 'utf-8');

function parse(text: string, chunkSize = text.length || 1): ClaudeRun {
  const parser = createStreamParser();
  for (let i = 0; i < text.length; i += chunkSize) parser.push(text.slice(i, i + chunkSize));
  return parser.finish();
}

const json = (o: unknown): string => JSON.stringify(o);

describe('createStreamParser', () => {
  it('reads the reply, result status and five-hour window from a real capture', () => {
    const run = parse(REAL_SUCCESS_STREAM);
    expect(run.resultText).toBe('pong');
    expect(run.isError).toBe(false);
    expect(run.subtype).toBe('success');
    expect(run.promptTokens).toBeGreaterThan(0);
    expect(run.sawResponse).toBe(true);
    expect(run.window).toEqual({
      type: 'five_hour',
      status: 'allowed',
      resetsAt: new Date(1794257400 * 1000),
      utilization: 0.73,
    });
  });

  it('reads a rejected five-hour window from a real limit capture', () => {
    const run = parse(REAL_LIMIT_STREAM);
    expect(run.isError).toBe(true);
    expect(run.apiErrorStatus).toBe(429);
    expect(run.resultText).toContain('hit your 5-hour limit');
    expect(run.window).toMatchObject({ type: 'five_hour', status: 'rejected', resetsAt: new Date(1794257400 * 1000) });
    expect(run.window?.utilization).toBeGreaterThanOrEqual(1);
  });

  it('gives the same answer however the output is chunked (even mid-line)', () => {
    const whole = parse(REAL_SUCCESS_STREAM);
    for (const size of [1, 3, 7, 64]) expect(parse(REAL_SUCCESS_STREAM, size)).toEqual(whole);
  });

  it('ignores blank lines, CRLF endings, junk and event types it does not know', () => {
    const text = [
      '',
      'not json at all',
      json({ type: 'some_future_event', payload: 1 }),
      json({ type: 'result', subtype: 'success', is_error: false, result: 'pong' }) + '\r',
      '{"truncated":',
    ].join('\n');
    const run = parse(text);
    expect(run.resultText).toBe('pong');
    expect(run.isError).toBe(false);
  });

  it('parses a final line that has no trailing newline', () => {
    const run = parse(json({ type: 'result', subtype: 'success', is_error: false, result: 'pong' }));
    expect(run.resultText).toBe('pong');
  });

  it('reports an error result', () => {
    const run = parse(json({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'Boom', api_error_status: 529 }));
    expect(run).toMatchObject({ isError: true, subtype: 'error_during_execution', resultText: 'Boom', apiErrorStatus: 529 });
  });

  it('treats an assistant message alone as a response even without a result event', () => {
    const run = parse(json({ type: 'assistant', message: { content: [] } }));
    expect(run.sawResponse).toBe(true);
    expect(run.resultText).toBeUndefined();
  });

  it('sees no response in empty output or in startup events only', () => {
    expect(parse('').sawResponse).toBe(false);
    expect(parse(json({ type: 'system', subtype: 'init' })).sawResponse).toBe(false);
  });

  it('keeps the last window when several rate-limit events arrive', () => {
    const run = parse([
      json({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', rateLimitType: 'five_hour', resetsAt: 1000 } }),
      json({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', rateLimitType: 'seven_day', resetsAt: 2000 } }),
    ].join('\n'));
    expect(run.window).toMatchObject({ type: 'seven_day', status: 'rejected', resetsAt: new Date(2000 * 1000) });
  });

  it('sums fresh and cached input tokens, ignoring output tokens', () => {
    const run = parse(json({ type: 'result', is_error: false, usage: { input_tokens: 2, cache_creation_input_tokens: 100, cache_read_input_tokens: 30, output_tokens: 999 } }));
    expect(run.promptTokens).toBe(132);
  });

  it('leaves tokens unknown when usage is missing or malformed', () => {
    expect(parse(json({ type: 'result', is_error: false })).promptTokens).toBeUndefined();
    expect(parse(json({ type: 'result', is_error: false, usage: 'lots' })).promptTokens).toBeUndefined();
    expect(parse(json({ type: 'result', is_error: false, usage: { input_tokens: 'x' } })).promptTokens).toBeUndefined();
  });

  it('tolerates a window with missing or malformed fields', () => {
    const run = parse(json({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', resetsAt: 'soon', unifiedWindows: 5 } }));
    expect(run.window).toEqual({ type: 'unknown', status: 'allowed', resetsAt: undefined, utilization: undefined });
    expect(parse(json({ type: 'rate_limit_event' })).window).toBeUndefined();
  });
});
