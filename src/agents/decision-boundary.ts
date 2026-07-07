/**
 * Decision Boundary Layer - Evaluates whether actions require approval, checkpoints, or autonomous execution
 */

import type { AutonomyPolicies, CheckpointStrategyConfig } from "./autonomy-policies.js";
import type { TaskContext } from "./task-context.js";
import {
  getDomainPolicy,
  getCheckpointThresholds,
  getPreferredCheckpointStyle,
  isAutonomous,
  requiresApproval,
} from "./autonomy-policies.js";
import { getTaskDomain, needsCheckpoint } from "./task-context.js";

// Checkpoint strategy definition
export interface CheckpointStrategy {
  type: "batch_sample" | "progress_reporting" | "time_based";
  initialBatchSize?: number;
  progressReportInterval?: number;
  timeIntervalMinutes?: number;
  validationRequired: boolean;
  config: CheckpointStrategyConfig;
}

// Strategy proposal for ambiguous tasks
export interface Strategy {
  id: string;
  name: string;
  description: string;
  approach: string;
  checkpoints: CheckpointStrategy | null;
  estimatedTime: number;
  pros: string[];
  cons: string[];
}

// Decision result types
export type DecisionResult =
  | { action: "execute"; checkpoints?: CheckpointStrategy }
  | { action: "approve_first"; reason: string; operation: string }
  | { action: "propose_strategy"; strategies: Strategy[]; prompt: string };

// Decision log entry for policy learning
export interface DecisionLogEntry {
  timestamp: Date;
  taskType: string;
  domain: string;
  decision: DecisionResult["action"];
  reason: string;
  context: TaskContext;
  userApproved?: boolean;
}

/**
 * Decision Boundary Evaluator
 * Core component that determines action disposition based on context and policies
 */
export class DecisionBoundaryEvaluator {
  private decisionLog: DecisionLogEntry[] = [];

  /**
   * Main evaluation method - determines how to handle a proposed action
   */
  evaluate(context: TaskContext, policies: AutonomyPolicies): DecisionResult {
    const domain = getTaskDomain(context.taskType);

    // 1. Check hard constraints (always require approval)
    const approvalResult = this.checkApprovalRequired(context, policies, domain);
    if (approvalResult) {
      this.logDecision(context, domain, "approve_first", approvalResult.reason);
      return approvalResult;
    }

    // 2. Check if task is fully autonomous
    if (this.isFullyAutonomous(context, policies, domain)) {
      // Check if checkpoints are still needed due to scope
      if (needsCheckpoint(context, policies)) {
        const strategy = this.suggestCheckpointStrategy(context, policies, domain);
        this.logDecision(context, domain, "execute", "Autonomous with checkpoints");
        return { action: "execute", checkpoints: strategy };
      }

      this.logDecision(context, domain, "execute", "Fully autonomous");
      return { action: "execute" };
    }

    // 3. Check if scope is ambiguous and needs strategy proposal
    if (this.isAmbiguous(context, policies)) {
      const strategies = this.generateStrategies(context, policies, domain);
      const prompt = this.formatStrategyPrompt(strategies, context);
      this.logDecision(context, domain, "propose_strategy", "Ambiguous scope");
      return { action: "propose_strategy", strategies, prompt };
    }

    // 4. Default to autonomous execution with checkpoints if scope is large
    if (needsCheckpoint(context, policies)) {
      const strategy = this.suggestCheckpointStrategy(context, policies, domain);
      this.logDecision(context, domain, "execute", "Autonomous with checkpoints");
      return { action: "execute", checkpoints: strategy };
    }

    // 5. Execute autonomously
    this.logDecision(context, domain, "execute", "Default autonomous");
    return { action: "execute" };
  }

  /**
   * Check if task requires explicit approval
   */
  private checkApprovalRequired(
    context: TaskContext,
    policies: AutonomyPolicies,
    domain: string,
  ): DecisionResult | null {
    // Check reversibility
    if (!context.reversibility) {
      return {
        action: "approve_first",
        reason: "This action cannot be undone",
        operation: context.operation,
      };
    }

    // Check risk level
    if (context.riskLevel === "high") {
      return {
        action: "approve_first",
        reason: "High-risk operation requires confirmation",
        operation: context.operation,
      };
    }

    // Check domain-specific requires_approval
    if (requiresApproval(policies, domain, context.operation)) {
      return {
        action: "approve_first",
        reason: `${context.operation} requires approval in ${domain}`,
        operation: context.operation,
      };
    }

    // Check global always_require_approval
    for (const tool of context.toolCalls || []) {
      if (policies.global.always_require_approval.includes(tool)) {
        return {
          action: "approve_first",
          reason: `${tool} always requires approval`,
          operation: tool,
        };
      }
    }

    return null;
  }

  /**
   * Check if task is fully autonomous
   */
  private isFullyAutonomous(
    context: TaskContext,
    policies: AutonomyPolicies,
    domain: string,
  ): boolean {
    // Check global always_autonomous
    for (const op of policies.global.always_autonomous) {
      if (context.operation.includes(op) || context.taskType.includes(op)) {
        return true;
      }
    }

    // Check domain policy
    const domainPolicy = getDomainPolicy(policies, domain);
    if (domainPolicy.autonomous === true) {
      return true;
    }

    // Check specific operation
    return isAutonomous(policies, domain, context.operation);
  }

  /**
   * Check if task scope is ambiguous
   */
  private isAmbiguous(context: TaskContext, policies: AutonomyPolicies): boolean {
    // Ambiguous if directive is inferred
    if (context.userDirective === "inferred") {
      return true;
    }

    // Check domain policy for when_scope_clear
    const domain = getTaskDomain(context.taskType);
    const domainPolicy = getDomainPolicy(policies, domain);
    if (domainPolicy.autonomous === "when_scope_clear") {
      // Implicit directives with this policy are ambiguous
      if (context.userDirective === "implicit") {
        return true;
      }
    }

    return false;
  }

  /**
   * Suggest appropriate checkpoint strategy
   */
  private suggestCheckpointStrategy(
    context: TaskContext,
    policies: AutonomyPolicies,
    domain: string,
  ): CheckpointStrategy {
    const preferredStyle = getPreferredCheckpointStyle(policies, domain);
    const strategyConfig =
      policies.checkpoint_strategies[preferredStyle] || policies.checkpoint_strategies.batch_sample;

    if (preferredStyle === "batch_sample" || !preferredStyle) {
      const sampleSize = Math.min(
        strategyConfig.max_sample_size || 50,
        Math.max(
          strategyConfig.min_sample_size || 10,
          Math.floor(context.scope.itemCount * (strategyConfig.sample_percentage || 0.15)),
        ),
      );

      return {
        type: "batch_sample",
        initialBatchSize: sampleSize,
        validationRequired: strategyConfig.require_explicit_approval ?? true,
        config: strategyConfig,
      };
    }

    if (preferredStyle === "progress_reporting") {
      const interval = Math.max(
        strategyConfig.min_interval_items || 10,
        Math.floor(context.scope.itemCount * (strategyConfig.interval_percentage || 0.1)),
      );

      return {
        type: "progress_reporting",
        progressReportInterval: interval,
        validationRequired: false,
        config: strategyConfig,
      };
    }

    if (preferredStyle === "time_based") {
      return {
        type: "time_based",
        timeIntervalMinutes: strategyConfig.report_every_minutes || 5,
        validationRequired: false,
        config: strategyConfig,
      };
    }

    // Default to batch sample
    return {
      type: "batch_sample",
      initialBatchSize: 30,
      validationRequired: true,
      config: policies.checkpoint_strategies.batch_sample || {},
    };
  }

  /**
   * Generate strategy proposals for ambiguous tasks
   */
  private generateStrategies(
    context: TaskContext,
    policies: AutonomyPolicies,
    domain: string,
  ): Strategy[] {
    const strategies: Strategy[] = [];
    const thresholds = getCheckpointThresholds(policies, domain);

    // Strategy 1: Conservative (sample first)
    const sampleSize = Math.min(30, Math.floor(context.scope.itemCount * 0.15));
    strategies.push({
      id: "conservative",
      name: "Sample First",
      description: "Process a small batch first for validation",
      approach: `Process ${sampleSize} samples first for your approval, then continue with remainder`,
      checkpoints: {
        type: "batch_sample",
        initialBatchSize: sampleSize,
        validationRequired: true,
        config: policies.checkpoint_strategies.batch_sample || {},
      },
      estimatedTime: Math.ceil(context.scope.estimatedTimeMinutes * 1.3),
      pros: ["Validate approach early", "Easy to course-correct"],
      cons: ["Requires intermediate approval"],
    });

    // Strategy 2: Progressive (full with updates)
    const reportInterval = Math.floor(context.scope.itemCount / 10);
    strategies.push({
      id: "progressive",
      name: "Full with Updates",
      description: "Process everything with periodic progress reports",
      approach: `Process all ${context.scope.itemCount} items with updates every ${reportInterval} items`,
      checkpoints: {
        type: "progress_reporting",
        progressReportInterval: reportInterval,
        validationRequired: false,
        config: policies.checkpoint_strategies.progress_reporting || {},
      },
      estimatedTime: context.scope.estimatedTimeMinutes,
      pros: ["Faster completion", "Visibility into progress"],
      cons: ["Harder to stop mid-process"],
    });

    // Strategy 3: Clarify first (if truly ambiguous)
    if (context.userDirective === "inferred") {
      strategies.push({
        id: "clarify",
        name: "Clarify First",
        description: "Get more specific requirements before starting",
        approach: "Let me ask a few focused questions first",
        checkpoints: null,
        estimatedTime: 0,
        pros: ["Better understanding", "Avoid wasted work"],
        cons: ["Delays start"],
      });
    }

    return strategies;
  }

  /**
   * Format strategy prompt for user
   */
  private formatStrategyPrompt(strategies: Strategy[], context: TaskContext): string {
    const options = strategies
      .map((s, i) => `(${String.fromCharCode(97 + i)}) ${s.approach}`)
      .join(", ");

    return `I can approach this as: ${options}. Which direction?`;
  }

  /**
   * Log decision for policy learning
   */
  private logDecision(
    context: TaskContext,
    domain: string,
    decision: DecisionResult["action"],
    reason: string,
  ): void {
    this.decisionLog.push({
      timestamp: new Date(),
      taskType: context.taskType,
      domain,
      decision,
      reason,
      context,
    });
  }

  /**
   * Record user response to decision (for policy learning)
   */
  recordUserResponse(decisionIndex: number, approved: boolean): void {
    if (this.decisionLog[decisionIndex]) {
      this.decisionLog[decisionIndex].userApproved = approved;
    }
  }

  /**
   * Get decision log for policy learning analysis
   */
  getDecisionLog(): DecisionLogEntry[] {
    return [...this.decisionLog];
  }

  /**
   * Clear decision log
   */
  clearDecisionLog(): void {
    this.decisionLog = [];
  }
}

// Export singleton instance
export const decisionBoundary = new DecisionBoundaryEvaluator();
