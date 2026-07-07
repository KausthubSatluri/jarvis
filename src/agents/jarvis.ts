/**
 * Jarvis - Main integration module for bounded autonomy system
 * Ties together all autonomy components and integrates with OpenClaw agent loop
 */

import type { AutonomyPolicies } from "./autonomy-policies.js";
import type { DecisionResult, CheckpointStrategy } from "./decision-boundary.js";
import type { TaskContext } from "./task-context.js";
import { loadAutonomyPolicies } from "./autonomy-policies.js";
import { CheckpointExecutor, checkpointExecutor } from "./checkpoint-executor.js";
import { DecisionBoundaryEvaluator, decisionBoundary } from "./decision-boundary.js";
import { PolicyLearner, policyLearner } from "./policy-learner.js";
import { extractTaskContext } from "./task-context.js";
import { whatsappCheckpointAdapter } from "./whatsapp-checkpoint-adapter.js";

// Jarvis configuration
export interface JarvisConfig {
  workspacePath: string;
  enablePolicyLearning: boolean;
  whatsappEnabled: boolean;
  defaultChannel?: string;
}

// Jarvis action result
export interface JarvisActionResult {
  decision: DecisionResult;
  executed: boolean;
  checkpointUsed: boolean;
  policySuggestions?: string;
}

/**
 * Jarvis - Bounded Autonomy Controller
 * Main entry point for the Jarvis autonomy system
 */
export class Jarvis {
  private config: JarvisConfig;
  private policies: AutonomyPolicies;
  private evaluator: DecisionBoundaryEvaluator;
  private executor: CheckpointExecutor;
  private learner: PolicyLearner;

  constructor(config: JarvisConfig) {
    this.config = config;
    this.policies = loadAutonomyPolicies(config.workspacePath);
    this.evaluator = decisionBoundary;
    this.executor = checkpointExecutor;
    this.learner = policyLearner;

    // Initialize WhatsApp integration if enabled
    if (config.whatsappEnabled) {
      this.executor.setMessageSender(whatsappCheckpointAdapter);
    }

    // Load existing policy suggestions
    this.learner.loadSuggestions(config.workspacePath);
  }

  /**
   * Evaluate a proposed action and determine how to proceed
   */
  evaluateAction(userInput: string, toolCalls: string[]): JarvisActionResult {
    // Extract task context
    const context = extractTaskContext(userInput, toolCalls, this.policies);

    // Evaluate decision boundary
    const decision = this.evaluator.evaluate(context, this.policies);

    // Record observation for policy learning
    if (this.config.enablePolicyLearning) {
      this.learner.recordObservation({
        timestamp: new Date(),
        taskType: context.taskType,
        domain: context.scope.affectedDomains[0] || "default",
        decision: decision.action,
        reason: this.getDecisionReason(decision),
        context,
      });
    }

    // Check for policy suggestions
    let policySuggestions: string | undefined;
    if (this.config.enablePolicyLearning) {
      const pendingSuggestions = this.learner.formatSuggestionsForReview();
      if (pendingSuggestions) {
        policySuggestions = pendingSuggestions;
      }
    }

    return {
      decision,
      executed: decision.action === "execute",
      checkpointUsed: decision.action === "execute" && !!decision.checkpoints,
      policySuggestions,
    };
  }

  /**
   * Execute a task with checkpoint handling
   */
  async executeWithCheckpoints<T>(
    processItem: (index: number) => Promise<T>,
    context: TaskContext,
    strategy: CheckpointStrategy,
  ): Promise<{ results: T[]; completed: boolean }> {
    const result = await this.executor.executeWithCheckpoints(
      processItem,
      strategy,
      context,
      this.policies,
    );

    return { results: result.results, completed: result.completed };
  }

  /**
   * Handle user response to approval request
   */
  recordApprovalResponse(approved: boolean): void {
    const log = this.evaluator.getDecisionLog();
    if (log.length > 0) {
      this.evaluator.recordUserResponse(log.length - 1, approved);

      // Re-record for policy learning
      if (this.config.enablePolicyLearning) {
        const lastEntry = log[log.length - 1];
        lastEntry.userApproved = approved;
        this.learner.recordObservation(lastEntry);
      }
    }
  }

  /**
   * Apply a policy suggestion
   */
  applyPolicySuggestion(suggestionId: string): boolean {
    const result = this.learner.applySuggestion(suggestionId, this.policies);
    if (result.updated) {
      this.policies = result.policies;
      this.learner.savePolicies(this.config.workspacePath, this.policies);
      this.learner.saveSuggestions(this.config.workspacePath);
    }
    return result.updated;
  }

  /**
   * Reject a policy suggestion
   */
  rejectPolicySuggestion(suggestionId: string): void {
    this.learner.rejectSuggestion(suggestionId);
    this.learner.saveSuggestions(this.config.workspacePath);
  }

  /**
   * Get pending policy suggestions formatted for display
   */
  getPolicySuggestions(): string {
    return this.learner.formatSuggestionsForReview();
  }

  /**
   * Get current autonomy policies
   */
  getPolicies(): AutonomyPolicies {
    return this.policies;
  }

  /**
   * Reload policies from disk
   */
  reloadPolicies(): void {
    this.policies = loadAutonomyPolicies(this.config.workspacePath);
  }

  /**
   * Get decision reason for logging
   */
  private getDecisionReason(decision: DecisionResult): string {
    switch (decision.action) {
      case "execute":
        return decision.checkpoints ? "Autonomous with checkpoints" : "Autonomous";
      case "approve_first":
        return decision.reason;
      case "propose_strategy":
        return "Ambiguous scope - proposed strategies";
      default:
        return "Unknown";
    }
  }
}

// Re-export all types and utilities
export * from "./autonomy-policies.js";
export * from "./task-context.js";
export * from "./decision-boundary.js";
export * from "./checkpoint-executor.js";
export * from "./policy-learner.js";
export * from "./whatsapp-checkpoint-adapter.js";

/**
 * Create a Jarvis instance with default configuration
 */
export function createJarvis(workspacePath: string, options?: Partial<JarvisConfig>): Jarvis {
  return new Jarvis({
    workspacePath,
    enablePolicyLearning: true,
    whatsappEnabled: true,
    ...options,
  });
}

// Default export
export default Jarvis;
