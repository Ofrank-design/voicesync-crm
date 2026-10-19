import { z } from "zod";

export const PRIORITIES = ["low", "medium", "high"] as const;
export const STATUSES = ["todo", "in_progress", "completed"] as const;

const dateOrEmpty = z
  .string()
  .refine((v) => v === "" || isValidIsoDate(v), "follow_up_date must be YYYY-MM-DD or empty");

export function isValidIsoDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Exact five-field business object Claude must return. Unknown keys rejected. */
export const TaskDraftSchema = z
  .object({
    client_name: z.string().max(200),
    location: z.string().max(300),
    action_item: z.string().max(1000),
    follow_up_date: dateOrEmpty,
    priority: z.enum(PRIORITIES),
  })
  .strict();
export type TaskDraft = z.infer<typeof TaskDraftSchema>;

/** What the user confirms. Requires a client and action. */
export const TaskCreateSchema = TaskDraftSchema.extend({
  client_name: z.string().trim().min(1, "Client name is required").max(200),
  action_item: z.string().trim().min(1, "Action item is required").max(1000),
  transcript: z.string().max(20000).optional(),
}).strict();
export type TaskCreate = z.infer<typeof TaskCreateSchema>;

export const TaskPatchSchema = z
  .object({
    client_name: z.string().trim().min(1).max(200),
    location: z.string().max(300),
    action_item: z.string().trim().min(1).max(1000),
    follow_up_date: dateOrEmpty,
    priority: z.enum(PRIORITIES),
    status: z.enum(STATUSES),
  })
  .partial()
  .strict()
  .refine((o) => Object.keys(o).length > 0, "At least one field is required");
export type TaskPatch = z.infer<typeof TaskPatchSchema>;

export const ListQuerySchema = z.object({
  search: z.string().max(200).optional(),
  status: z.enum(STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  sort: z.enum(["created_at", "follow_up_date", "priority"]).default("created_at"),
  order: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListQuery = z.infer<typeof ListQuerySchema>;

export interface TaskRecord {
  id: string;
  user_id: string | null;
  client_name: string;
  location: string;
  action_item: string;
  follow_up_date: string | null;
  priority: (typeof PRIORITIES)[number];
  status: (typeof STATUSES)[number];
  transcript: string | null;
  created_at: string;
  updated_at: string;
}
