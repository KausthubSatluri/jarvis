/**
 * Checkpoint Executor - Manages long-running tasks with validation checkpoints
 * Integrates with WhatsApp for checkpoint messages and approvals
 */

import type { AutonomyPolicies } from "./autonomy-policies.js";
import type { CheckpointStrategy } from "./decision-boundary.js";
import type { TaskContext } from "./task-context.js";

// Checkpoint state during execution
export interface CheckpointState {
  totalItems: number;
  processedItems: number;
  validationPending: boolean;
  results: unknown[];
  startTime: Date;
  lastCheckpointTime: Date;
  approved: boolean;
  cancelled: boolean;
}

// Checkpoint options for presentation
export interface CheckpointOptions {
  message: string;
  expectsApproval: boolean;
  showResults: boolean;
  channel?: string;
}

// Progress report
export interface ProgressReport {
  percentage: number;
  processedItems: number;
  totalItems: number;
  elapsedMinutes: number;
  estimatedRemainingMinutes: number;
  currentBatchResults?: unknown[];
}

// Checkpoint result
export interface CheckpointResult {
  approved: boolean;
  feedback?: string;
  shouldContinue: boolean;
}

// Message sender interface (for WhatsApp integration)
export interface MessageSender {
  sendCheckpointMessage(message: string, channel: string): Promise<void>;
  sendProgressReport(report: ProgressReport, channel: string): Promise<void>;
  waitForApproval(timeoutMs: number, channel: string): Promise<CheckpointResult>;
}

/**
 * Checkpoint Executor
 * Handles execution of tasks with intermediate validation and progress reporting
 */
export class CheckpointExecutor {
  private messageSender: MessageSender | null = null;

  /**
   * Set message sender for WhatsApp integration
   */
  setMessageSender(sender: MessageSender): void {
    this.messageSender = sender;
  }

  /**
   * Execute a task with checkpoints
   */
  async executeWithCheckpoints<T>(
    processItem: (index: number) => Promise<T>,
    strategy: CheckpointStrategy,
    context: TaskContext,
    policies: AutonomyPolicies,
  ): Promise<{ results: T[]; completed: boolean; state: CheckpointState }> {
    const state: CheckpointState = {
      totalItems: context.scope.itemCount,
      processedItems: 0,
      validationPending: false,
      results: [],
      startTime: new Date(),
      lastCheckpointTime: new Date(),
      approved: false,
      cancelled: false,
    };

    const channel = policies.whatsapp?.checkpoint_enabled ? "whatsapp" : "default";

    switch (strategy.type) {
      case "batch_sample":
        return this.executeBatchSample(processItem, strategy, state, channel, policies);

      case "progress_reporting":
        return this.executeWithProgress(processItem, strategy, state, channel, policies);

      case "time_based":
        return this.executeWithTimeCheckpoints(processItem, strategy, state, channel, policies);

      default:
        // Fallback to batch sample
        return this.executeBatchSample(processItem, strategy, state, channel, policies);
    }
  }

  /**
   * Execute with batch sample strategy - process subset first, then continue after approval
   */
  private async executeBatchSample<T>(
    processItem: (index: number) => Promise<T>,
    strategy: CheckpointStrategy,
    state: CheckpointState,
    channel: string,
    policies: AutonomyPolicies,
  ): Promise<{ results: T[]; completed: boolean; state: CheckpointState }> {
    const batchSize = strategy.initialBatchSize || 30;
    const results: T[] = [];

    // 1. Process initial batch
    for (let i = 0; i < Math.min(batchSize, state.totalItems); i++) {
      const result = await processItem(i);
      results.push(result);
      state.processedItems++;
    }

    state.results = results;
    state.lastCheckpointTime = new Date();

    // 2. Present for validation
    const checkpointMessage = this.formatBatchCheckpointMessage(state, batchSize);
    await this.presentCheckpoint({
      message: checkpointMessage,
      expectsApproval: strategy.validationRequired,
      showResults: true,
      channel,
    });

    // 3. Wait for approval if required
    if (strategy.validationRequired) {
      state.validationPending = true;

      const approvalResult = await this.waitForCheckpointApproval(
        policies.whatsapp?.approval_timeout_minutes || 30,
        channel,
      );

      state.validationPending = false;

      if (!approvalResult.shouldContinue) {
        state.cancelled = true;
        await this.sendMessage("Stopping. Let me know what needs adjustment.", channel);
        return { results, completed: false, state };
      }

      state.approved = true;
    }

    // 4. Process remainder
    const remainingCount = state.totalItems - batchSize;
    if (remainingCount > 0) {
      await this.sendMessage(`Continuing with remaining ${remainingCount} items.`, channel);

      const reportInterval = Math.floor(remainingCount / 10);

      for (let i = batchSize; i < state.totalItems; i++) {
        const result = await processItem(i);
        results.push(result);
        state.processedItems++;

        // Progress update every 10%
        if (reportInterval > 0 && (state.processedItems - batchSize) % reportInterval === 0) {
          await this.sendProgressUpdate(state, channel);
        }
      }
    }

    // 5. Present final results
    if (policies.whatsapp?.send_completion_summary) {
      await this.presentFinalResults(state, channel);
    }

    return { results, completed: true, state };
  }

  /**
   * Execute with progress reporting - process all with periodic updates
   */
  private async executeWithProgress<T>(
    processItem: (index: number) => Promise<T>,
    strategy: CheckpointStrategy,
    state: CheckpointState,
    channel: string,
    policies: AutonomyPolicies,
  ): Promise<{ results: T[]; completed: boolean; state: CheckpointState }> {
    const results: T[] = [];
    const reportInterval = strategy.progressReportInterval || Math.floor(state.totalItems / 10);

    for (let i = 0; i < state.totalItems; i++) {
      const result = await processItem(i);
      results.push(result);
      state.processedItems++;

      // Report progress at intervals
      if (reportInterval > 0 && state.processedItems % reportInterval === 0) {
        await this.sendProgressUpdate(state, channel);
      }
    }

    state.results = results;

    if (policies.whatsapp?.send_completion_summary) {
      await this.presentFinalResults(state, channel);
    }

    return { results, completed: true, state };
  }

  /**
   * Execute with time-based checkpoints
   */
  private async executeWithTimeCheckpoints<T>(
    processItem: (index: number) => Promise<T>,
    strategy: CheckpointStrategy,
    state: CheckpointState,
    channel: string,
    policies: AutonomyPolicies,
  ): Promise<{ results: T[]; completed: boolean; state: CheckpointState }> {
    const results: T[] = [];
    const intervalMs = (strategy.timeIntervalMinutes || 5) * 60 * 1000;

    for (let i = 0; i < state.totalItems; i++) {
      const result = await processItem(i);
      results.push(result);
      state.processedItems++;

      // Check if time interval has passed
      const elapsed = Date.now() - state.lastCheckpointTime.getTime();
      if (elapsed >= intervalMs) {
        await this.sendProgressUpdate(state, channel);
        state.lastCheckpointTime = new Date();
      }
    }

    state.results = results;

    if (policies.whatsapp?.send_completion_summary) {
      await this.presentFinalResults(state, channel);
    }

    return { results, completed: true, state };
  }

  /**
   * Format batch checkpoint message
   */
  private formatBatchCheckpointMessage(state: CheckpointState, batchSize: number): string {
    const format = "concise"; // Could be from policies.whatsapp.progress_message_format

    if (format === "concise") {
      return `Processed ${batchSize} samples. Ready for review.`;
    }

    return (
      `Completed initial batch of ${batchSize}/${state.totalItems} items.\n` +
      `Elapsed time: ${this.getElapsedMinutes(state)}min.\n` +
      `Ready for your review before continuing.`
    );
  }

  /**
   * Present checkpoint to user
   */
  private async presentCheckpoint(options: CheckpointOptions): Promise<void> {
    if (this.messageSender && options.channel) {
      await this.messageSender.sendCheckpointMessage(options.message, options.channel);
    } else {
      console.log(`[Checkpoint] ${options.message}`);
    }
  }

  /**
   * Wait for checkpoint approval
   */
  private async waitForCheckpointApproval(
    timeoutMinutes: number,
    channel: string,
  ): Promise<CheckpointResult> {
    if (this.messageSender) {
      return this.messageSender.waitForApproval(timeoutMinutes * 60 * 1000, channel);
    }

    // Default: auto-approve for non-WhatsApp channels
    return { approved: true, shouldContinue: true };
  }

  /**
   * Send a message
   */
  private async sendMessage(message: string, channel: string): Promise<void> {
    if (this.messageSender) {
      await this.messageSender.sendCheckpointMessage(message, channel);
    } else {
      console.log(`[Jarvis] ${message}`);
    }
  }

  /**
   * Send progress update
   */
  private async sendProgressUpdate(state: CheckpointState, channel: string): Promise<void> {
    const progress = Math.floor((state.processedItems / state.totalItems) * 100);
    const elapsed = this.getElapsedMinutes(state);
    const estimated = this.estimateRemainingTime(state);

    const report: ProgressReport = {
      percentage: progress,
      processedItems: state.processedItems,
      totalItems: state.totalItems,
      elapsedMinutes: elapsed,
      estimatedRemainingMinutes: estimated,
    };

    if (this.messageSender) {
      await this.messageSender.sendProgressReport(report, channel);
    } else {
      console.log(`[Progress] ${progress}% (${state.processedItems}/${state.totalItems})`);
    }
  }

  /**
   * Present final results
   */
  private async presentFinalResults(state: CheckpointState, channel: string): Promise<void> {
    const elapsed = this.getElapsedMinutes(state);
    const message = `Done. Processed ${state.totalItems} items in ${elapsed}min.`;
    await this.sendMessage(message, channel);
  }

  /**
   * Get elapsed time in minutes
   */
  private getElapsedMinutes(state: CheckpointState): number {
    const elapsed = Date.now() - state.startTime.getTime();
    return Math.floor(elapsed / 60000);
  }

  /**
   * Estimate remaining time
   */
  private estimateRemainingTime(state: CheckpointState): number {
    if (state.processedItems === 0) return 0;

    const elapsed = Date.now() - state.startTime.getTime();
    const timePerItem = elapsed / state.processedItems;
    const remaining = state.totalItems - state.processedItems;

    return Math.ceil((timePerItem * remaining) / 60000);
  }
}

// Export singleton instance
export const checkpointExecutor = new CheckpointExecutor();
