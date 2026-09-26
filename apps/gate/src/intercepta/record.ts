import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RawIntercepta } from '@risksir/core';

/**
 * Stores a raw response as JSON: timestamp, endpoint, address, HTTP status, body. Never headers (INV-021, guardrails
 * section 5). Recorded files are written only for `real_live` responses from the live client. Hand-made fixtures go
 * under fixtures/intercepta/synthetic/ and carry provenance "synthetic".
 */
export interface RecordedFile {
  timestamp: string;
  endpoint: string;
  address: string;
  httpStatus: number | null;
  latencyMs: number;
  error: RawIntercepta['error'];
  provenance: RawIntercepta['provenance'];
  body: unknown;
}

export function toRecordedFile(raw: RawIntercepta): RecordedFile {
  return {
    timestamp: raw.receivedAt,
    endpoint: raw.endpoint,
    address: raw.address,
    httpStatus: raw.httpStatus,
    latencyMs: raw.latencyMs,
    error: raw.error,
    provenance: raw.provenance,
    body: raw.body,
  };
}

export function writeRecordedResponse(recordedDir: string, raw: RawIntercepta): string {
  if (raw.provenance !== 'real_live') {
    throw new Error(
      `only real_live responses may be stored as recorded (got ${raw.provenance}); use the synthetic fixtures directory`,
    );
  }
  mkdirSync(recordedDir, { recursive: true });
  const stamp = raw.receivedAt.replace(/[:.]/g, '-');
  const file = join(recordedDir, `${stamp}_${raw.address}.json`);
  writeFileSync(file, `${JSON.stringify(toRecordedFile(raw), null, 2)}\n`, { flag: 'wx' });
  return file;
}
