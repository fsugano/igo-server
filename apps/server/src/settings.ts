import { AppSettings, DEFAULT_SETTINGS, LIVE_DELAY_MAX, LIVE_DELAY_MIN, RECORDING_METHODS } from '@igo/shared';
import { z } from 'zod';
import type { Db } from './db.js';

const implemented = RECORDING_METHODS.filter((m) => m.implemented).map((m) => m.id);

/** Each setting with its rule. Methods that are not built yet cannot be selected. */
const fields = {
  liveDelayMoves: z.number().int().min(LIVE_DELAY_MIN).max(LIVE_DELAY_MAX),
  recordingMethod: z.enum(['tab', 'canvas', 'webcodecs']).refine((m) => implemented.includes(m), 'not implemented'),
} satisfies { [K in keyof AppSettings]: z.ZodType<AppSettings[K]> };

export const settingsPatchSchema = z.object(fields).partial().strict();

/** Operator settings, kept in memory and saved in app_settings. */
export class Settings {
  private current: AppSettings = { ...DEFAULT_SETTINGS };

  constructor(private db: Db) {}

  get(): AppSettings {
    return { ...this.current };
  }

  /** Reads saved values. A value that no longer passes its rule falls back to the default. */
  async load(): Promise<AppSettings> {
    const r = await this.db.query<{ key: string; value: unknown }>('SELECT key, value FROM app_settings');
    const saved: Record<string, unknown> = {};
    for (const row of r.rows) {
      if (!(row.key in fields)) continue;
      const p = fields[row.key as keyof AppSettings].safeParse(row.value);
      if (p.success) saved[row.key] = p.data;
    }
    this.current = { ...DEFAULT_SETTINGS, ...(saved as Partial<AppSettings>) };
    return this.get();
  }

  /** Validates and saves a partial change. Returns the new settings, or null if the change is invalid. */
  async update(input: unknown, userId: string): Promise<AppSettings | null> {
    const p = settingsPatchSchema.safeParse(input);
    if (!p.success) return null;
    const entries = Object.entries(p.data);
    if (!entries.length) return this.get();
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      for (const [key, value] of entries) {
        await client.query(
          `INSERT INTO app_settings (key, value, updated_by, updated_at) VALUES ($1, $2, $3, now())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
          [key, JSON.stringify(value), userId],
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    this.current = { ...this.current, ...p.data };
    return this.get();
  }
}
