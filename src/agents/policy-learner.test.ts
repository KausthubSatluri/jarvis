/**
 * Tests for Policy Learner
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { AutonomyPolicies } from "./autonomy-policies.js";
import type { DecisionLogEntry } from "./decision-boundary.js";
import { PolicyLearner } from "./policy-learner.js";

const mockPolicies: AutonomyPolicies = {
  version: "1.0",
  domains: {
    email: {
      autonomous_operations: ["read"],
      requires_approval: ["send"],
    },
  },
  global: {
    max_autonomous_item_count: 200,
    max_autonomous_time_minutes: 30,
    max_file_size_mb: 500,
    always_require_approval: [],
    always_autonomous: [],
  },
  checkpoint_strategies: {},
  strategy_templates: {},
  user_preferences: {
    verbosity: "minimal",
    explanation_mode: "on_request",
    progress_updates: "important_only",
    default_stance: "conservative",
    checkpoint_frequency: "medium",
    preferred_checkpoint_style: "batch_sample",
  },
};

describe("PolicyLearner", () => {
  let learner: PolicyLearner;

  beforeEach(() => {
    learner = new PolicyLearner({
      min_observations_before_suggestion: 3,
      suggestion_cooldown_hours: 0, // Disable cooldown for testing
    });
  });

  describe("recordObservation", () => {
    it("should record observations", () => {
      const entry: DecisionLogEntry = {
        timestamp: new Date(),
        taskType: "send_email",
        domain: "email",
        decision: "approve_first",
        reason: "Requires approval",
        context: {
          taskType: "send_email",
          operation: "send",
          scope: { itemCount: 1, estimatedTimeMinutes: 1, affectedDomains: ["email"] },
          reversibility: false,
          riskLevel: "high",
          userDirective: "explicit",
        },
        userApproved: true,
      };

      // Should not throw
      learner.recordObservation(entry);
    });
  });

  describe("suggestion generation", () => {
    it("should suggest making operation autonomous after consistent approvals", () => {
      // Record 5 approved send_email operations
      for (let i = 0; i < 5; i++) {
        const entry: DecisionLogEntry = {
          timestamp: new Date(),
          taskType: "draft_response",
          domain: "email",
          decision: "approve_first",
          reason: "Requires approval",
          context: {
            taskType: "draft_response",
            operation: "draft_response",
            scope: { itemCount: 1, estimatedTimeMinutes: 1, affectedDomains: ["email"] },
            reversibility: true,
            riskLevel: "low",
            userDirective: "explicit",
          },
          userApproved: true,
        };
        learner.recordObservation(entry);
      }

      const suggestions = learner.getPendingSuggestions();
      const relevantSuggestion = suggestions.find(
        (s) => s.domain === "email" && s.operation === "draft_response",
      );

      expect(relevantSuggestion).toBeDefined();
      expect(relevantSuggestion?.type).toBe("add_autonomous");
    });

    it("should suggest requiring approval after consistent rejections", () => {
      // Record 5 rejected operations
      for (let i = 0; i < 5; i++) {
        const entry: DecisionLogEntry = {
          timestamp: new Date(),
          taskType: "bulk_update",
          domain: "file_operations",
          decision: "execute",
          reason: "Autonomous",
          context: {
            taskType: "bulk_update",
            operation: "bulk_update",
            scope: { itemCount: 10, estimatedTimeMinutes: 2, affectedDomains: ["file_operations"] },
            reversibility: true,
            riskLevel: "medium",
            userDirective: "explicit",
          },
          userApproved: false,
        };
        learner.recordObservation(entry);
      }

      const suggestions = learner.getPendingSuggestions();
      const relevantSuggestion = suggestions.find(
        (s) => s.domain === "file_operations" && s.operation === "bulk_update",
      );

      expect(relevantSuggestion).toBeDefined();
      expect(relevantSuggestion?.type).toBe("add_approval");
    });
  });

  describe("applySuggestion", () => {
    it("should add operation to autonomous_operations", () => {
      // Create a suggestion
      for (let i = 0; i < 5; i++) {
        learner.recordObservation({
          timestamp: new Date(),
          taskType: "new_op",
          domain: "email",
          decision: "approve_first",
          reason: "Test",
          context: {
            taskType: "new_op",
            operation: "new_op",
            scope: { itemCount: 1, estimatedTimeMinutes: 1, affectedDomains: ["email"] },
            reversibility: true,
            riskLevel: "low",
            userDirective: "explicit",
          },
          userApproved: true,
        });
      }

      const suggestions = learner.getPendingSuggestions();
      const suggestion = suggestions.find((s) => s.operation === "new_op");

      if (suggestion) {
        const result = learner.applySuggestion(suggestion.id, mockPolicies);
        expect(result.updated).toBe(true);
        expect(result.policies.domains.email.autonomous_operations).toContain("new_op");
      }
    });
  });

  describe("formatSuggestionsForReview", () => {
    it("should format suggestions in a readable way", () => {
      // Create a suggestion
      for (let i = 0; i < 5; i++) {
        learner.recordObservation({
          timestamp: new Date(),
          taskType: "format_test",
          domain: "email",
          decision: "approve_first",
          reason: "Test",
          context: {
            taskType: "format_test",
            operation: "format_test",
            scope: { itemCount: 1, estimatedTimeMinutes: 1, affectedDomains: ["email"] },
            reversibility: true,
            riskLevel: "low",
            userDirective: "explicit",
          },
          userApproved: true,
        });
      }

      const formatted = learner.formatSuggestionsForReview();

      expect(formatted).toContain("patterns");
      expect(formatted).toContain("format_test");
    });

    it("should return empty string when no suggestions", () => {
      const formatted = learner.formatSuggestionsForReview();
      expect(formatted).toBe("");
    });
  });
});
