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
  tools: ToolDefinition[];
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
