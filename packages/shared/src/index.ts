export type LeadStatus =
  | "NEW"
  | "QUALIFIED"
  | "UNQUALIFIED"
  | "CONTACTED"
  | "BOOKED"
  | "LOST";

export type ContentFormat = "POST" | "REEL" | "CAROUSEL" | "STORY";

export type AttributionConfidence = "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";

export interface AgentDecisionRecord {
  category: string;
  observation: Record<string, unknown>;
  hypothesis: string;
  confidence: number;
  action: Record<string, unknown>;
  outcome?: Record<string, unknown>;
}
