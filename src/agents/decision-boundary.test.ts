/**
 * Tests for Decision Boundary Evaluator
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { AutonomyPolicies } from "./autonomy-policies.js";
import type { TaskContext } from "./task-context.js";
import { DecisionBoundaryEvaluator } from "./decision-boundary.js";

// Mock policies for testing
const mockPolicies: AutonomyPolicies = {
  version: "1.0",
  domains: {
    email: {
      autonomous_operations: ["read", "search", "draft"],
      requires_approval: ["send", "delete"],
      checkpoint_thresholds: {
        item_count: 50,
        time_minutes: 5,
      },
    },
    file_operations: {
      autonomous_operations: ["create", "read", "modify"],
      requires_approval: ["delete"],
    },
    problem_generation: {
      autonomous: true,
    },
  },
  global: {
    max_autonomous_item_count: 200,
    max_autonomous_time_minutes: 30,
    max_file_size_mb: 500,
    always_require_approval: ["financial_transactions", "bulk_message_sending"],
    always_autonomous: ["reading_data", "local_computation", "draft_creation"],
  },
  checkpoint_strategies: {
    batch_sample: {
      sample_percentage: 0.15,
      min_sample_size: 10,
      max_sample_size: 50,
      require_explicit_approval: true,
    },
    progress_reporting: {
      interval_percentage: 0.1,
      min_interval_items: 10,
    },
  },
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

describe("DecisionBoundaryEvaluator", () => {
  let evaluator: DecisionBoundaryEvaluator;

  beforeEach(() => {
    evaluator = new DecisionBoundaryEvaluator();
  });

  describe("evaluate", () => {
    it("should execute autonomously for low-risk, clear scope tasks", () => {
      const context: TaskContext = {
        taskType: "generate_problems",
        operation: "generate_problems",
        scope: {
          itemCount: 10,
          estimatedTimeMinutes: 2,
          affectedDomains: ["problem_generation"],
        },
        reversibility: true,
        riskLevel: "low",
        userDirective: "explicit",
        toolCalls: ["generate_problems"],
      };

      const result = evaluator.evaluate(context, mockPolicies);

      expect(result.action).toBe("execute");
    });

    it("should require approval for irreversible operations", () => {
      const context: TaskContext = {
        taskType: "send_email",
        operation: "send_email",
        scope: {
          itemCount: 1,
          estimatedTimeMinutes: 1,
          affectedDomains: ["email"],
        },
        reversibility: false,
        riskLevel: "high",
        userDirective: "explicit",
        toolCalls: ["send_email"],
      };

      const result = evaluator.evaluate(context, mockPolicies);

      expect(result.action).toBe("approve_first");
    });

    it("should propose checkpoints for large scope tasks", () => {
      const context: TaskContext = {
        taskType: "organize_photos",
        operation: "organize_photos",
        scope: {
          itemCount: 250, // Exceeds max_autonomous_item_count of 200
          estimatedTimeMinutes: 35, // Exceeds max_autonomous_time_minutes of 30
          affectedDomains: ["media_organization"],
        },
        reversibility: true,
        riskLevel: "medium",
        userDirective: "explicit",
        toolCalls: ["organize_photos"],
      };

      const result = evaluator.evaluate(context, mockPolicies);

      expect(result.action).toBe("execute");
      if (result.action === "execute") {
        expect(result.checkpoints).toBeDefined();
        expect(result.checkpoints?.type).toBe("batch_sample");
      }
    });

    it("should propose strategy for ambiguous tasks", () => {
      const context: TaskContext = {
        taskType: "analyze_data",
        operation: "analyze_data",
        scope: {
          itemCount: 50,
          estimatedTimeMinutes: 10,
          affectedDomains: ["data_analysis"],
        },
        reversibility: true,
        riskLevel: "low",
        userDirective: "inferred", // Ambiguous
        toolCalls: ["analyze_data"],
      };

      const result = evaluator.evaluate(context, mockPolicies);

      expect(result.action).toBe("propose_strategy");
    });

    it("should require approval for operations in global always_require_approval", () => {
      const context: TaskContext = {
        taskType: "financial_transactions",
        operation: "financial_transactions",
        scope: {
          itemCount: 1,
          estimatedTimeMinutes: 1,
          affectedDomains: ["finance"],
        },
        reversibility: false,
        riskLevel: "high",
        userDirective: "explicit",
        toolCalls: ["financial_transactions"],
      };

      const result = evaluator.evaluate(context, mockPolicies);

      expect(result.action).toBe("approve_first");
    });

    it("should be autonomous for operations in global always_autonomous", () => {
      const context: TaskContext = {
        taskType: "read_file",
        operation: "reading_data",
        scope: {
          itemCount: 5,
          estimatedTimeMinutes: 1,
          affectedDomains: ["file_operations"],
        },
        reversibility: true,
        riskLevel: "low",
        userDirective: "explicit",
        toolCalls: ["read"],
      };

      const result = evaluator.evaluate(context, mockPolicies);

      expect(result.action).toBe("execute");
    });
  });

  describe("decision logging", () => {
    it("should log decisions for policy learning", () => {
      const context: TaskContext = {
        taskType: "generate_problems",
        operation: "generate_problems",
        scope: {
          itemCount: 10,
          estimatedTimeMinutes: 2,
          affectedDomains: ["problem_generation"],
        },
        reversibility: true,
        riskLevel: "low",
        userDirective: "explicit",
        toolCalls: ["generate_problems"],
      };

      evaluator.evaluate(context, mockPolicies);
      const log = evaluator.getDecisionLog();

      expect(log.length).toBe(1);
      expect(log[0].taskType).toBe("generate_problems");
      expect(log[0].decision).toBe("execute");
    });

    it("should record user responses", () => {
      const context: TaskContext = {
        taskType: "send_email",
        operation: "send_email",
        scope: {
          itemCount: 1,
          estimatedTimeMinutes: 1,
          affectedDomains: ["email"],
        },
        reversibility: false,
        riskLevel: "high",
        userDirective: "explicit",
        toolCalls: ["send_email"],
      };

      evaluator.evaluate(context, mockPolicies);
      evaluator.recordUserResponse(0, true);
      const log = evaluator.getDecisionLog();

      expect(log[0].userApproved).toBe(true);
    });
  });
});
