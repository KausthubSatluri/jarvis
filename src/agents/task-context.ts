/**
 * Task Context - Extract context from proposed actions for decision boundary evaluation
 */

import type { AutonomyPolicies } from "./autonomy-policies.js";

// Task scope information
export interface TaskScope {
  itemCount: number;
  estimatedTimeMinutes: number;
  affectedDomains: string[];
  affectedPaths?: string[];
  sizeBytes?: number;
}

// Risk assessment
export type RiskLevel = "low" | "medium" | "high";

// Directive clarity
export type DirectiveType = "explicit" | "implicit" | "inferred";

// Complete task context for decision evaluation
export interface TaskContext {
  taskType: string;
  operation: string;
  scope: TaskScope;
  reversibility: boolean;
  riskLevel: RiskLevel;
  userDirective: DirectiveType;
  toolCalls?: string[];
  rawInput?: string;
}

// Known task types and their typical characteristics
const TASK_TYPE_MAPPING: Record<string, { domain: string; defaultRisk: RiskLevel }> = {
  // Email operations
  send_email: { domain: "email", defaultRisk: "high" },
  read_email: { domain: "email", defaultRisk: "low" },
  draft_email: { domain: "email", defaultRisk: "low" },
  search_email: { domain: "email", defaultRisk: "low" },

  // File operations
  create_file: { domain: "file_operations", defaultRisk: "low" },
  read_file: { domain: "file_operations", defaultRisk: "low" },
  modify_file: { domain: "file_operations", defaultRisk: "medium" },
  delete_file: { domain: "file_operations", defaultRisk: "high" },
  move_file: { domain: "file_operations", defaultRisk: "medium" },
  organize_files: { domain: "file_operations", defaultRisk: "medium" },

  // Code operations
  generate_code: { domain: "code_generation", defaultRisk: "medium" },
  modify_code: { domain: "code_generation", defaultRisk: "medium" },
  refactor_code: { domain: "code_generation", defaultRisk: "high" },
  run_tests: { domain: "code_generation", defaultRisk: "low" },

  // Data analysis
  analyze_data: { domain: "data_analysis", defaultRisk: "low" },
  process_data: { domain: "data_analysis", defaultRisk: "low" },
  visualize_data: { domain: "data_analysis", defaultRisk: "low" },

  // Research
  search_web: { domain: "research", defaultRisk: "low" },
  gather_info: { domain: "research", defaultRisk: "low" },
  synthesize_research: { domain: "research", defaultRisk: "low" },

  // Problem generation (learning contexts)
  generate_problems: { domain: "problem_generation", defaultRisk: "low" },
  create_exercises: { domain: "problem_generation", defaultRisk: "low" },

  // Media organization
  organize_photos: { domain: "media_organization", defaultRisk: "medium" },
  tag_media: { domain: "media_organization", defaultRisk: "low" },
  rename_files: { domain: "media_organization", defaultRisk: "medium" },

  // Messaging
  send_message: { domain: "messaging", defaultRisk: "high" },
  read_message: { domain: "messaging", defaultRisk: "low" },
  draft_message: { domain: "messaging", defaultRisk: "low" },

  // Shell/bash operations
  exec: { domain: "shell", defaultRisk: "medium" },
  bash: { domain: "shell", defaultRisk: "medium" },
};

// Operations that are never reversible
const IRREVERSIBLE_OPERATIONS = new Set([
  "send_email",
  "send_message",
  "delete_file",
  "delete_batch",
  "publish",
  "post",
  "financial_transaction",
]);

// Keywords suggesting high item counts
const BULK_KEYWORDS = ["all", "every", "each", "batch", "bulk", "entire", "whole", "everything"];

// Keywords suggesting subjective judgment needed
const JUDGMENT_KEYWORDS = [
  "best",
  "good",
  "appropriate",
  "suitable",
  "relevant",
  "important",
  "categorize",
  "organize",
  "classify",
];

/**
 * Extract task type from tool call name
 */
export function inferTaskType(toolName: string): string {
  // Direct mapping
  if (TASK_TYPE_MAPPING[toolName]) {
    return toolName;
  }

  // Normalize tool name
  const normalized = toolName.toLowerCase().replace(/[-_]/g, "_");

  // Check for partial matches
  for (const [key, _] of Object.entries(TASK_TYPE_MAPPING)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return key;
    }
  }

  // Default based on common patterns
  if (normalized.includes("send")) return "send_message";
  if (normalized.includes("delete")) return "delete_file";
  if (normalized.includes("read")) return "read_file";
  if (normalized.includes("write") || normalized.includes("create")) return "create_file";
  if (normalized.includes("analyze")) return "analyze_data";
  if (normalized.includes("search")) return "search_web";
  if (normalized.includes("generate")) return "generate_code";

  return "unknown";
}

/**
 * Get domain for a task type
 */
export function getTaskDomain(taskType: string): string {
  return TASK_TYPE_MAPPING[taskType]?.domain || "default";
}

/**
 * Estimate item count from user input
 */
export function estimateItemCount(input: string): number {
  // Look for explicit numbers
  const numberMatch = input.match(/(\d+)\s*(files?|items?|photos?|emails?|messages?|images?)/i);
  if (numberMatch) {
    return parseInt(numberMatch[1], 10);
  }

  // Check for bulk keywords
  const hasBulkKeyword = BULK_KEYWORDS.some((kw) => input.toLowerCase().includes(kw));
  if (hasBulkKeyword) {
    return 100; // Assume large batch
  }

  // Default to small count
  return 1;
}

/**
 * Estimate time in minutes for a task
 */
export function estimateTime(taskType: string, itemCount: number): number {
  // Base estimates per item (in seconds)
  const timePerItem: Record<string, number> = {
    analyze_data: 2,
    process_data: 1,
    organize_photos: 3,
    tag_media: 2,
    generate_code: 30,
    generate_problems: 10,
    search_web: 5,
    synthesize_research: 60,
  };

  const baseTime = timePerItem[taskType] || 1;
  return Math.ceil((baseTime * itemCount) / 60);
}

/**
 * Check if operation is reversible
 */
export function isReversible(operation: string): boolean {
  return !IRREVERSIBLE_OPERATIONS.has(operation);
}

/**
 * Assess risk level for a task
 */
export function assessRiskLevel(
  taskType: string,
  scope: TaskScope,
  reversible: boolean,
): RiskLevel {
  // High risk for irreversible operations
  if (!reversible) {
    return "high";
  }

  // Check default risk for task type
  const defaultRisk = TASK_TYPE_MAPPING[taskType]?.defaultRisk || "medium";

  // Escalate risk for large scope
  if (scope.itemCount > 100 || scope.estimatedTimeMinutes > 10) {
    if (defaultRisk === "low") return "medium";
    if (defaultRisk === "medium") return "high";
  }

  return defaultRisk;
}

/**
 * Detect if user directive is clear or ambiguous
 */
export function assessDirectiveClarity(input: string): DirectiveType {
  // Check for judgment keywords (suggests ambiguity)
  const needsJudgment = JUDGMENT_KEYWORDS.some((kw) => input.toLowerCase().includes(kw));
  if (needsJudgment) {
    return "inferred";
  }

  // Check for specific, explicit instructions
  const hasSpecificInstructions =
    input.includes(":") || // Likely has structured instructions
    input.match(/\d+/) || // Has specific numbers
    input.includes('"') || // Has quoted strings
    input.includes("file://") || // Has specific paths
    input.length < 50; // Short and direct

  if (hasSpecificInstructions) {
    return "explicit";
  }

  return "implicit";
}

/**
 * Extract complete task context from user input and proposed tool calls
 */
export function extractTaskContext(
  input: string,
  toolCalls: string[],
  policies: AutonomyPolicies,
): TaskContext {
  // Infer primary task type from first tool call
  const primaryTool = toolCalls[0] || "unknown";
  const taskType = inferTaskType(primaryTool);
  const domain = getTaskDomain(taskType);

  // Estimate scope
  const itemCount = estimateItemCount(input);
  const estimatedTime = estimateTime(taskType, itemCount);

  const scope: TaskScope = {
    itemCount,
    estimatedTimeMinutes: estimatedTime,
    affectedDomains: [...new Set(toolCalls.map((t) => getTaskDomain(inferTaskType(t))))],
  };

  // Assess reversibility
  const reversible = toolCalls.every((t) => isReversible(inferTaskType(t)));

  // Assess risk
  const riskLevel = assessRiskLevel(taskType, scope, reversible);

  // Assess directive clarity
  const userDirective = assessDirectiveClarity(input);

  return {
    taskType,
    operation: primaryTool,
    scope,
    reversibility: reversible,
    riskLevel,
    userDirective,
    toolCalls,
    rawInput: input,
  };
}

/**
 * Check if task context suggests need for checkpoints
 */
export function needsCheckpoint(context: TaskContext, policies: AutonomyPolicies): boolean {
  const domain = getTaskDomain(context.taskType);
  const thresholds = policies.domains[domain]?.checkpoint_thresholds || {
    item_count: policies.global.max_autonomous_item_count,
    time_minutes: policies.global.max_autonomous_time_minutes,
  };

  // Check against thresholds
  if (context.scope.itemCount > (thresholds.item_count || 50)) {
    return true;
  }

  if (context.scope.estimatedTimeMinutes > (thresholds.time_minutes || 5)) {
    return true;
  }

  // Check for ambiguous directives
  if (context.userDirective === "inferred") {
    return true;
  }

  return false;
}
