import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError } from "../lib/errors";
import { PROVIDER_IDS, type ProviderId } from "../providers/registry";

/** Provider choice saved from the settings screen. Never contains keys. */
export interface SavedSelection { transcription: ProviderId; transcriptionModel?: string; extraction: ProviderId; extractionModel?: string }
export interface SettingsRepo {
  get(): Promise<SavedSelection | null>;
  save(sel: SavedSelection, userId: string): Promise<void>;
  clear(): Promise<void>;
}

export class MemorySettingsRepo implements SettingsRepo {
  value: SavedSelection | null = null; failNext = false;
  async get() { return this.value; }
  async save(sel: SavedSelection) { if (this.failNext) { this.failNext = false; throw new AppError(503, "database_error", "The database is not responding right now. Please try again shortly."); } this.value = sel; }
  async clear() { this.value = null; }
}

/** One row in `app_settings` (key "providers"). */
export class SupabaseSettingsRepo implements SettingsRepo {
  constructor(private db: SupabaseClient) {}
  private fail(): never { throw new AppError(503, "database_error", "The database is not responding right now. Please try again shortly."); }
  async get() {
    const { data, error } = await this.db.from("app_settings").select("value").eq("key", "providers").maybeSingle();
    if (error) this.fail();
    const v = data?.value as Partial<SavedSelection> | undefined;
    if (!v || !PROVIDER_IDS.includes(v.transcription as ProviderId) || !PROVIDER_IDS.includes(v.extraction as ProviderId)) return null;
    return { transcription: v.transcription!, transcriptionModel: v.transcriptionModel, extraction: v.extraction!, extractionModel: v.extractionModel };
  }
  async save(sel: SavedSelection, userId: string) {
    const { error } = await this.db.from("app_settings").upsert({ key: "providers", value: sel, updated_by: userId, updated_at: new Date().toISOString() });
    if (error) this.fail();
  }
  async clear() {
    const { error } = await this.db.from("app_settings").delete().eq("key", "providers");
    if (error) this.fail();
  }
}
