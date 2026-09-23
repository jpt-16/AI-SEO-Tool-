// How much Claude reasons per page before answering. Reasoning bills as output tokens and
// is most of a blueprint's cost. Shared by the server and the Analyze form.
export const EFFORTS = ["low", "medium", "high"] as const;
export type Effort = (typeof EFFORTS)[number];
export const DEFAULT_EFFORT: Effort = "medium";
export const EFFORT_LABELS: Record<Effort, string> = { low: "Quick", medium: "Standard", high: "Thorough" };

export const isEffort = (value: unknown): value is Effort => EFFORTS.includes(value as Effort);
