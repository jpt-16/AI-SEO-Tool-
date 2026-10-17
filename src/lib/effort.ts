// How much the model reasons per page before answering. Reasoning bills as output tokens and
// is most of a blueprint's cost. Shared by the server and the Analyze form.
export const EFFORTS = ["low", "medium", "high"] as const;
export type Effort = (typeof EFFORTS)[number];
export const DEFAULT_EFFORT: Effort = "medium";
export const EFFORT_LABELS: Record<Effort, string> = { low: "Quick", medium: "Standard", high: "Thorough" };

// Gemini thinking-token budget per depth (thinking bills as output; 0 = off).
export const THINKING_BUDGET: Record<Effort, number> = { low: 512, medium: 2048, high: 8192 };

export const isEffort = (value: unknown): value is Effort => EFFORTS.includes(value as Effort);
