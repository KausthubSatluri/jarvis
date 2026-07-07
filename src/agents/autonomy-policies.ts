/**
 * Autonomy Policies - YAML loader and configuration types
 * Loads AUTONOMY.yaml and provides programmatic access to domain policies
 */

import fs from "node:fs";
import path from "node:path";
import yaml from "yaml";

// Domain-specific policy configuration
export interface DomainPolicy {
  autonomous_operations?: string[];
  requires_approval?: string[];
  autonomous?: boolean | "when_scope_clear";
  checkpoint_triggers?: string[];
  checkpoint_thresholds?: {
    item_count?: number;
    time_minutes?: number;
    size_mb?: number;
  };
  auto_report_progress?: boolean;
  auto_save_sources?: boolean;
  default_behavior?: string;
  default_strategy?: string;
  checkpoint_channel?: string;
}

// Checkpoint strategy configuration
export interface CheckpointStrategyConfig {
  sample_percentage?: number;
  min_sample_size?: number;
  max_sample_size?: number;
  require_explicit_approval?: boolean;
  interval_percentage?: number;
  min_interval_items?: number;
  include_time_estimate?: boolean;
  allow_interruption?: boolean;
  report_every_minutes?: number;
  max_time_before_checkin?: number;
}

// Strategy template
export interface StrategyTemplate {
  trigger: string[];
  proposal: string;
  strategies?: Array<{
    name: string;
    description: string;
  }>;
}

// Global constraints
export interface GlobalConstraints {
  max_autonomous_item_count: number;
  max_autonomous_time_minutes: number;
  max_file_size_mb: number;
  always_require_approval: string[];
  always_autonomous: string[];
}

// User preferences
export interface UserPreferences {
  verbosity: "minimal" | "moderate" | "detailed";
  explanation_mode: "on_request" | "always" | "never";
  progress_updates: "important_only" | "all" | "none";
  default_stance: "conservative" | "balanced" | "aggressive";
  checkpoint_frequency: "low" | "medium" | "high";
  preferred_checkpoint_style: string;
}

// WhatsApp integration settings
export interface WhatsAppSettings {
  checkpoint_enabled: boolean;
  approval_timeout_minutes: number;
  progress_message_format: "concise" | "detailed";
  send_completion_summary: boolean;
}

// Policy learning settings
export interface PolicyLearningSettings {
  enabled: boolean;
  min_observations_before_suggestion: number;
  suggestion_cooldown_hours: number;
  auto_implement: boolean;
  log_all_decisions: boolean;
}

// Complete autonomy policies configuration
export interface AutonomyPolicies {
  version: string;
  domains: Record<string, DomainPolicy>;
  global: GlobalConstraints;
  checkpoint_strategies: Record<string, CheckpointStrategyConfig>;
  strategy_templates: Record<string, StrategyTemplate>;
  user_preferences: UserPreferences;
  whatsapp?: WhatsAppSettings;
  policy_learning?: PolicyLearningSettings;
}

// Default policies when AUTONOMY.yaml doesn't exist
const DEFAULT_POLICIES: AutonomyPolicies = {
  version: "1.0",
  domains: {
    default: {
      autonomous: true,
      checkpoint_thresholds: {
        item_count: 50,
        time_minutes: 5,
      },
    },
  },
  global: {
    max_autonomous_item_count: 200,
    max_autonomous_time_minutes: 30,
    max_file_size_mb: 500,
    always_require_approval: [
      "financial_transactions",
      "account_deletions",
      "bulk_message_sending",
    ],
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
      include_time_estimate: true,
      allow_interruption: true,
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

/**
 * Load autonomy policies from AUTONOMY.yaml
 */
export function loadAutonomyPolicies(workspacePath: string): AutonomyPolicies {
  const yamlPath = path.join(workspacePath, "AUTONOMY.yaml");

  if (!fs.existsSync(yamlPath)) {
    return DEFAULT_POLICIES;
  }

  try {
    const content = fs.readFileSync(yamlPath, "utf8");
    const config = yaml.parse(content) as Partial<AutonomyPolicies>;

    // Merge with defaults
    return {
      ...DEFAULT_POLICIES,
      ...config,
      global: { ...DEFAULT_POLICIES.global, ...config.global },
      checkpoint_strategies: {
        ...DEFAULT_POLICIES.checkpoint_strategies,
        ...config.checkpoint_strategies,
      },
      user_preferences: {
        ...DEFAULT_POLICIES.user_preferences,
        ...config.user_preferences,
      },
    };
  } catch (error) {
    console.error("Failed to load AUTONOMY.yaml:", error);
    return DEFAULT_POLICIES;
  }
}

/**
 * Get the policy for a specific domain
 */
export function getDomainPolicy(policies: AutonomyPolicies, domain: string): DomainPolicy {
  return policies.domains[domain] || policies.domains.default || {};
}

/**
 * Check if an operation requires approval in a given domain
 */
export function requiresApproval(
  policies: AutonomyPolicies,
  domain: string,
  operation: string,
): boolean {
  // Check global always_require_approval first
  if (policies.global.always_require_approval.includes(operation)) {
    return true;
  }

  const domainPolicy = getDomainPolicy(policies, domain);

  // Check domain-specific requires_approval
  if (domainPolicy.requires_approval?.includes(operation)) {
    return true;
  }

  return false;
}

/**
 * Check if an operation can run autonomously
 */
export function isAutonomous(
  policies: AutonomyPolicies,
  domain: string,
  operation: string,
): boolean {
  // Check global always_autonomous first
  if (policies.global.always_autonomous.includes(operation)) {
    return true;
  }

  const domainPolicy = getDomainPolicy(policies, domain);

  // Check if domain is fully autonomous
  if (domainPolicy.autonomous === true) {
    return !requiresApproval(policies, domain, operation);
  }

  // Check domain-specific autonomous_operations
  if (domainPolicy.autonomous_operations?.includes(operation)) {
    return true;
  }

  return false;
}

/**
 * Get checkpoint thresholds for a domain
 */
export function getCheckpointThresholds(
  policies: AutonomyPolicies,
  domain: string,
): { itemCount: number; timeMinutes: number; sizeMb: number } {
  const domainPolicy = getDomainPolicy(policies, domain);
  const thresholds = domainPolicy.checkpoint_thresholds || {};

  return {
    itemCount: thresholds.item_count ?? policies.global.max_autonomous_item_count,
    timeMinutes: thresholds.time_minutes ?? policies.global.max_autonomous_time_minutes,
    sizeMb: thresholds.size_mb ?? policies.global.max_file_size_mb,
  };
}

/**
 * Get checkpoint strategy configuration
 */
export function getCheckpointStrategy(
  policies: AutonomyPolicies,
  strategyName: string,
): CheckpointStrategyConfig | undefined {
  return policies.checkpoint_strategies[strategyName];
}

/**
 * Get preferred checkpoint style for a domain
 */
export function getPreferredCheckpointStyle(policies: AutonomyPolicies, domain: string): string {
  const domainPolicy = getDomainPolicy(policies, domain);
  return domainPolicy.default_strategy || policies.user_preferences.preferred_checkpoint_style;
}
