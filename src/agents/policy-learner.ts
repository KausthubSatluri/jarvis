/**
 * Policy Learner - Suggests new autonomy policies based on user interaction patterns
 * Observes decision outcomes and proposes policy adjustments for user review
 */

import fs from "node:fs";
import path from "node:path";
import yaml from "yaml";
import type {
  AutonomyPolicies,
  DomainPolicy,
  PolicyLearningSettings,
} from "./autonomy-policies.js";
import type { DecisionLogEntry } from "./decision-boundary.js";

// Policy suggestion types
export interface PolicySuggestion {
  id: string;
  type: "add_autonomous" | "add_approval" | "adjust_threshold" | "new_domain";
  domain: string;
  operation?: string;
  currentValue?: unknown;
  suggestedValue?: unknown;
  reason: string;
  confidence: number;
  observationCount: number;
  createdAt: Date;
  status: "pending" | "approved" | "rejected" | "expired";
}

// Learning observation
interface Observation {
  domain: string;
  operation: string;
  decision: string;
  userApproved?: boolean;
  timestamp: Date;
}

// Pattern detection result
interface Pattern {
  domain: string;
  operation: string;
  approvalRate: number;
  count: number;
  suggestion?: PolicySuggestion;
}

/**
 * Policy Learner
 * Analyzes decision logs and suggests policy improvements
 */
export class PolicyLearner {
  private observations: Observation[] = [];
  private suggestions: PolicySuggestion[] = [];
  private lastSuggestionTime: Record<string, Date> = {};
  private settings: PolicyLearningSettings;

  constructor(settings?: Partial<PolicyLearningSettings>) {
    this.settings = {
      enabled: true,
      min_observations_before_suggestion: 5,
      suggestion_cooldown_hours: 24,
      auto_implement: false,
      log_all_decisions: true,
      ...settings,
    };
  }

  /**
   * Record a decision and its outcome
   */
  recordObservation(entry: DecisionLogEntry): void {
    if (!this.settings.enabled) return;

    this.observations.push({
      domain: entry.domain,
      operation: entry.context.operation,
      decision: entry.decision,
      userApproved: entry.userApproved,
      timestamp: entry.timestamp,
    });

    // Analyze patterns after each observation
    this.analyzePatterns();
  }

  /**
   * Batch record observations from decision log
   */
  recordObservations(entries: DecisionLogEntry[]): void {
    for (const entry of entries) {
      this.recordObservation(entry);
    }
  }

  /**
   * Analyze patterns and generate suggestions
   */
  private analyzePatterns(): void {
    if (!this.settings.enabled) return;

    // Group observations by domain and operation
    const grouped = this.groupObservations();

    for (const [key, obs] of grouped) {
      const [domain, operation] = key.split("::");

      // Skip if not enough observations
      if (obs.length < this.settings.min_observations_before_suggestion) {
        continue;
      }

      // Skip if suggestion was made recently
      if (this.isOnCooldown(key)) {
        continue;
      }

      // Analyze approval patterns
      const pattern = this.analyzeApprovalPattern(domain, operation, obs);

      if (pattern.suggestion) {
        this.addSuggestion(pattern.suggestion);
        this.lastSuggestionTime[key] = new Date();
      }
    }
  }

  /**
   * Group observations by domain::operation key
   */
  private groupObservations(): Map<string, Observation[]> {
    const grouped = new Map<string, Observation[]>();

    for (const obs of this.observations) {
      const key = `${obs.domain}::${obs.operation}`;
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(obs);
    }

    return grouped;
  }

  /**
   * Check if suggestion is on cooldown
   */
  private isOnCooldown(key: string): boolean {
    const lastTime = this.lastSuggestionTime[key];
    if (!lastTime) return false;

    const cooldownMs = this.settings.suggestion_cooldown_hours * 60 * 60 * 1000;
    return Date.now() - lastTime.getTime() < cooldownMs;
  }

  /**
   * Analyze approval patterns for a domain/operation
   */
  private analyzeApprovalPattern(
    domain: string,
    operation: string,
    observations: Observation[],
  ): Pattern {
    const approvedCount = observations.filter((o) => o.userApproved === true).length;
    const rejectedCount = observations.filter((o) => o.userApproved === false).length;
    const totalWithFeedback = approvedCount + rejectedCount;

    const approvalRate = totalWithFeedback > 0 ? approvedCount / totalWithFeedback : 0.5;

    const pattern: Pattern = {
      domain,
      operation,
      approvalRate,
      count: observations.length,
    };

    // If user consistently approves, suggest making it autonomous
    if (approvalRate >= 0.9 && totalWithFeedback >= 5) {
      pattern.suggestion = {
        id: `${domain}-${operation}-auto-${Date.now()}`,
        type: "add_autonomous",
        domain,
        operation,
        reason: `You've approved "${operation}" in ${domain} ${approvedCount} out of ${totalWithFeedback} times. Consider making it autonomous.`,
        confidence: approvalRate,
        observationCount: observations.length,
        createdAt: new Date(),
        status: "pending",
      };
    }

    // If user consistently rejects, suggest requiring approval
    if (approvalRate <= 0.1 && totalWithFeedback >= 3) {
      pattern.suggestion = {
        id: `${domain}-${operation}-approval-${Date.now()}`,
        type: "add_approval",
        domain,
        operation,
        reason: `You've rejected "${operation}" in ${domain} ${rejectedCount} out of ${totalWithFeedback} times. Consider requiring approval.`,
        confidence: 1 - approvalRate,
        observationCount: observations.length,
        createdAt: new Date(),
        status: "pending",
      };
    }

    return pattern;
  }

  /**
   * Add a suggestion
   */
  private addSuggestion(suggestion: PolicySuggestion): void {
    // Check for duplicate
    const existing = this.suggestions.find(
      (s) =>
        s.domain === suggestion.domain &&
        s.operation === suggestion.operation &&
        s.type === suggestion.type &&
        s.status === "pending",
    );

    if (!existing) {
      this.suggestions.push(suggestion);
    }
  }

  /**
   * Get pending suggestions
   */
  getPendingSuggestions(): PolicySuggestion[] {
    return this.suggestions.filter((s) => s.status === "pending");
  }

  /**
   * Get all suggestions
   */
  getAllSuggestions(): PolicySuggestion[] {
    return [...this.suggestions];
  }

  /**
   * Format suggestions for user review
   */
  formatSuggestionsForReview(): string {
    const pending = this.getPendingSuggestions();

    if (pending.length === 0) {
      return "";
    }

    const lines = ["I've noticed some patterns that might improve our workflow:\n"];

    for (let i = 0; i < pending.length; i++) {
      const s = pending[i];
      lines.push(`${i + 1}. ${s.reason}`);

      if (s.type === "add_autonomous") {
        lines.push(`   → Suggest: Add "${s.operation}" to autonomous operations in ${s.domain}`);
      } else if (s.type === "add_approval") {
        lines.push(`   → Suggest: Require approval for "${s.operation}" in ${s.domain}`);
      }

      lines.push(
        `   Confidence: ${Math.round(s.confidence * 100)}% (${s.observationCount} observations)\n`,
      );
    }

    lines.push(
      "\nWould you like me to apply any of these? (e.g., 'apply 1' or 'apply all' or 'dismiss')",
    );

    return lines.join("\n");
  }

  /**
   * Apply a suggestion to policies
   */
  applySuggestion(
    suggestionId: string,
    policies: AutonomyPolicies,
  ): { updated: boolean; policies: AutonomyPolicies } {
    const suggestion = this.suggestions.find((s) => s.id === suggestionId);

    if (!suggestion || suggestion.status !== "pending") {
      return { updated: false, policies };
    }

    const updatedPolicies = { ...policies };

    if (!updatedPolicies.domains[suggestion.domain]) {
      updatedPolicies.domains[suggestion.domain] = {};
    }

    const domainPolicy = updatedPolicies.domains[suggestion.domain];

    switch (suggestion.type) {
      case "add_autonomous":
        if (!domainPolicy.autonomous_operations) {
          domainPolicy.autonomous_operations = [];
        }
        if (
          suggestion.operation &&
          !domainPolicy.autonomous_operations.includes(suggestion.operation)
        ) {
          domainPolicy.autonomous_operations.push(suggestion.operation);
        }
        break;

      case "add_approval":
        if (!domainPolicy.requires_approval) {
          domainPolicy.requires_approval = [];
        }
        if (
          suggestion.operation &&
          !domainPolicy.requires_approval.includes(suggestion.operation)
        ) {
          domainPolicy.requires_approval.push(suggestion.operation);
        }
        break;

      case "adjust_threshold":
        if (!domainPolicy.checkpoint_thresholds) {
          domainPolicy.checkpoint_thresholds = {};
        }
        if (typeof suggestion.suggestedValue === "number") {
          domainPolicy.checkpoint_thresholds.item_count = suggestion.suggestedValue;
        }
        break;
    }

    suggestion.status = "approved";

    return { updated: true, policies: updatedPolicies };
  }

  /**
   * Reject a suggestion
   */
  rejectSuggestion(suggestionId: string): void {
    const suggestion = this.suggestions.find((s) => s.id === suggestionId);
    if (suggestion) {
      suggestion.status = "rejected";
    }
  }

  /**
   * Save suggestions to file
   */
  saveSuggestions(workspacePath: string): void {
    const suggestionsPath = path.join(workspacePath, ".jarvis", "policy-suggestions.json");

    // Ensure directory exists
    const dir = path.dirname(suggestionsPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(suggestionsPath, JSON.stringify(this.suggestions, null, 2));
  }

  /**
   * Load suggestions from file
   */
  loadSuggestions(workspacePath: string): void {
    const suggestionsPath = path.join(workspacePath, ".jarvis", "policy-suggestions.json");

    if (fs.existsSync(suggestionsPath)) {
      try {
        const content = fs.readFileSync(suggestionsPath, "utf8");
        this.suggestions = JSON.parse(content);
      } catch (error) {
        console.error("Failed to load policy suggestions:", error);
      }
    }
  }

  /**
   * Save updated policies to AUTONOMY.yaml
   */
  savePolicies(workspacePath: string, policies: AutonomyPolicies): void {
    const yamlPath = path.join(workspacePath, "AUTONOMY.yaml");
    const content = yaml.stringify(policies);
    fs.writeFileSync(yamlPath, content);
  }

  /**
   * Clear observations (for testing or reset)
   */
  clearObservations(): void {
    this.observations = [];
  }

  /**
   * Update settings
   */
  updateSettings(settings: Partial<PolicyLearningSettings>): void {
    this.settings = { ...this.settings, ...settings };
  }
}

// Export singleton instance
export const policyLearner = new PolicyLearner();
