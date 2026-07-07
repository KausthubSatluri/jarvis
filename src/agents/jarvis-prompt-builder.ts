/**
 * Jarvis Autonomy Prompt Builder
 * Generates autonomy-related sections for the system prompt
 */

import type { AutonomyPolicies } from "./autonomy-policies.js";

/**
 * Build autonomy section for system prompt
 * Integrates AUTONOMY.yaml policies into the prompt
 */
export function buildAutonomySection(policies: AutonomyPolicies): string[] {
  const lines: string[] = [
    "## Bounded Autonomy",
    "You operate with bounded autonomy. Execute tasks within your autonomous scope without asking for permission.",
    "",
    "### Autonomous Operations",
    "Execute these immediately without confirmation:",
  ];

  // Add global always_autonomous
  for (const op of policies.global.always_autonomous) {
    lines.push(`- ${formatOperation(op)}`);
  }

  // Add domain-specific autonomous operations
  for (const [domain, policy] of Object.entries(policies.domains)) {
    if (policy.autonomous_operations && policy.autonomous_operations.length > 0) {
      lines.push(`- ${domain}: ${policy.autonomous_operations.join(", ")}`);
    }
    if (policy.autonomous === true) {
      lines.push(`- ${domain}: all operations (unless listed below)`);
    }
  }

  lines.push("");
  lines.push("### Requires Approval");
  lines.push("Always ask before these:");

  // Add global always_require_approval
  for (const op of policies.global.always_require_approval) {
    lines.push(`- ${formatOperation(op)}`);
  }

  // Add domain-specific requires_approval
  for (const [domain, policy] of Object.entries(policies.domains)) {
    if (policy.requires_approval && policy.requires_approval.length > 0) {
      lines.push(`- ${domain}: ${policy.requires_approval.join(", ")}`);
    }
  }

  lines.push("");
  lines.push("### Checkpoint Triggers");
  lines.push("Propose checkpoints when:");
  lines.push(`- Item count > ${policies.global.max_autonomous_item_count}`);
  lines.push(`- Estimated time > ${policies.global.max_autonomous_time_minutes} minutes`);
  lines.push("- Scope is ambiguous or requires subjective judgment");

  // Add checkpoint strategies
  lines.push("");
  lines.push("### Checkpoint Strategies");

  if (policies.checkpoint_strategies.batch_sample) {
    const sample = policies.checkpoint_strategies.batch_sample;
    lines.push(
      `- **Sample First**: Process ${sample.min_sample_size || 10}-${sample.max_sample_size || 50} items, validate, then continue`,
    );
  }

  if (policies.checkpoint_strategies.progress_reporting) {
    lines.push("- **Progress Updates**: Report progress periodically during long tasks");
  }

  lines.push("");
  lines.push("### Strategy Proposals");
  lines.push("When facing ambiguous scope, propose concrete approaches:");
  lines.push('- "Want me to process 30 samples first for your approval?"');
  lines.push('- "Should I run analysis on the first batch, then refine?"');
  lines.push('- "I can approach this as: (a) X, (b) Y. Which direction?"');
  lines.push("");

  return lines;
}

/**
 * Build concise Jarvis personality reminder
 */
export function buildJarvisPersonalityReminder(): string[] {
  return [
    "## Communication Style",
    "Be concise. Execute without restating instructions. Present results directly.",
    '- Minimal acknowledgment: "Done.", "Yep.", "One sec."',
    "- No task restating, no bullet points unless listing data",
    "- Ask focused clarifying questions when needed",
    "",
  ];
}

/**
 * Format operation name for display
 */
function formatOperation(op: string): string {
  return op.replace(/_/g, " ");
}

/**
 * Build complete Jarvis system prompt additions
 */
export function buildJarvisPromptAdditions(policies: AutonomyPolicies): string {
  const sections = [...buildJarvisPersonalityReminder(), ...buildAutonomySection(policies)];

  return sections.join("\n");
}
