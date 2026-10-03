/**
 * TML IR v0.1
 *
 * Stable intermediate representation shared by TML modules, profiles and runtime traces.
 * Surface syntax is intentionally not defined here.
 */

export type TmlId = string;

export interface TmlRef {
  ref: TmlId;
}

export type TmlValue =
  | { type: "string"; value: string }
  | { type: "number"; value: number }
  | { type: "boolean"; value: boolean }
  | { type: "null" }
  | { type: "time"; value: string }
  | { type: "ref"; value: TmlId }
  | { type: "list"; value: TmlValue[] }
  | { type: "object"; value: Record<string, TmlValue> };

export type TmlExpr =
  | {
      op: "eq" | "ne" | "gt" | "gte" | "lt" | "lte";
      subject: TmlId;
      predicate: string;
      value: TmlValue;
    }
  | {
      op: "exists";
      subject: TmlId;
      predicate: string;
    }
  | {
      op: "and" | "or";
      args: TmlExpr[];
    }
  | {
      op: "not";
      arg: TmlExpr;
    };

export interface TmlEventPattern {
  event: string;
  where?: Record<string, TmlValue>;
}

export interface TmlActionCall {
  id: TmlId;
  capability: string;
  args: Record<string, TmlValue>;
}

export interface TmlTransition {
  id: TmlId;
  subject?: TmlId;
  precondition?: TmlExpr;
  trigger?: TmlEventPattern;
  actions: TmlActionCall[];
  postcondition: TmlExpr;
  extensions?: Record<string, unknown>;
}

export interface TmlModule {
  schema: "tml.module";
  version: "0.1";
  id: TmlId;
  profile: string;
  transitions: TmlTransition[];
  extensions?: Record<string, unknown>;
}

export interface TmlEvent {
  kind: "event";
  id: TmlId;
  event: string;
  occurred_at: string;
  actor?: TmlId;
  target?: TmlId;
  data?: Record<string, TmlValue>;
  source: TmlId;
  extensions?: Record<string, unknown>;
}

export type TmlActionExecutionStatus =
  | "REQUESTED"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED";

export interface TmlActionExecution {
  kind: "action";
  id: TmlId;
  call: TmlId;
  capability: string;
  execution_key: string;
  requested_at: string;
  completed_at?: string;
  status: TmlActionExecutionStatus;
  output?: Record<string, TmlValue>;
  error?: {
    code: string;
    message?: string;
  };
  extensions?: Record<string, unknown>;
}

export interface TmlFact {
  kind: "fact";
  id: TmlId;
  subject: TmlId;
  predicate: string;
  value: TmlValue;
  source: TmlId;
  observed_at: string;
  confidence?: number;
  extensions?: Record<string, unknown>;
}

export interface TmlObservation {
  kind: "observation";
  id: TmlId;
  source: TmlId;
  observed_at: string;
  query: {
    subject: TmlId;
    predicate: string;
  };
  facts: TmlId[];
  extensions?: Record<string, unknown>;
}

export interface TmlEvidence {
  kind: "evidence";
  id: TmlId;
  claim: TmlExpr;
  observations: TmlId[];
  facts: TmlId[];
  extensions?: Record<string, unknown>;
}

export type TmlVerificationStatus =
  | "SATISFIED"
  | "UNSATISFIED"
  | "UNKNOWN"
  | "CONFLICT";

export interface TmlVerification {
  kind: "verification";
  id: TmlId;
  transition: TmlId;
  evidence: TmlId[];
  status: TmlVerificationStatus;
  checked_at: string;
  extensions?: Record<string, unknown>;
}

export type TmlParameter =
  | { type: "string" | "number" | "boolean" | "time" | "null" }
  | { type: "ref"; entity?: string }
  | { type: "list"; items: TmlParameter }
  | {
      type: "object";
      properties?: Record<string, TmlParameter>;
    };

export interface TmlCapability {
  id: string;
  mutates: boolean;
  parameters: Record<string, TmlParameter>;
  provider_binding?: string;
  verification?: {
    predicate: string;
    authority: TmlId;
  };
  extensions?: Record<string, unknown>;
}

export interface TmlAuthorityRule {
  predicate: string;
  authority: TmlId;
  fallback?: TmlId[];
}

export interface TmlProfile {
  schema: "tml.profile";
  version: "0.1";
  id: string;
  entity_types: string[];
  predicates: string[];
  events: string[];
  capabilities: TmlCapability[];
  authority: TmlAuthorityRule[];
  extensions?: Record<string, unknown>;
}

export type TmlTraceRecord =
  | TmlEvent
  | TmlActionExecution
  | TmlObservation
  | TmlFact
  | TmlEvidence
  | TmlVerification;

export interface TmlTrace {
  schema: "tml.trace";
  version: "0.1";
  id: TmlId;
  module: TmlId;
  profile: string;
  started_at: string;
  ended_at?: string;
  records: TmlTraceRecord[];
  extensions?: Record<string, unknown>;
}
