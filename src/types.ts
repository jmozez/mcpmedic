export type Severity = "error" | "warning" | "info";

export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
  [key: string]: unknown;
}

export interface ToolDefinition {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: ToolAnnotations;
  [key: string]: unknown;
}

export interface ServerSnapshot {
  serverName?: string;
  serverVersion?: string;
  protocolVersion?: string;
  instructions?: string;
  tools: ToolDefinition[];
  /** Results of live calls, present only when the server was probed. */
  probes?: ProbeResult[];
}

export interface CallOutcome {
  ok: boolean;
  /** The tool returned a result with isError set. */
  isError?: boolean;
  /** The call failed at the protocol level, or timed out. */
  thrown?: string;
  timedOut?: boolean;
  ms: number;
  text: string;
  tokens: number;
  structured?: unknown;
}

export interface ProbeResult {
  tool: string;
  /** Why the tool was not called, if it was skipped. */
  skipped?: string;
  input?: Record<string, unknown>;
  valid?: CallOutcome;
  /** A call with the required arguments left out, to see how errors read. */
  invalid?: CallOutcome;
}

export interface Finding {
  rule: string;
  severity: Severity;
  tool?: string;
  path?: string;
  message: string;
  fix?: string;
}

export interface Rule {
  id: string;
  severity: Severity;
  summary: string;
  check(snapshot: ServerSnapshot): Finding[];
}
