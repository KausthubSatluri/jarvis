/**
 * WhatsApp Checkpoint Adapter
 * Integrates checkpoint system with WhatsApp messaging channel
 */

import type { MessageSender, ProgressReport, CheckpointResult } from "./checkpoint-executor.js";

// WhatsApp message types for checkpoints
export interface WhatsAppCheckpointMessage {
  type: "checkpoint" | "progress" | "completion" | "approval_request";
  content: string;
  timestamp: Date;
  expectsReply: boolean;
}

// User response patterns for approval
const APPROVAL_PATTERNS = [
  /^(yes|yep|yeah|y|ok|okay|continue|proceed|go|approved|approve|do it|go ahead)$/i,
  /^(looks good|lgtm|perfect|great|fine|all good)$/i,
];

const REJECTION_PATTERNS = [
  /^(no|nope|n|stop|cancel|abort|wait|hold|reject)$/i,
  /^(not right|wrong|fix|change|redo|try again)$/i,
];

/**
 * Format progress report for WhatsApp (concise style)
 */
export function formatProgressForWhatsApp(
  report: ProgressReport,
  format: "concise" | "detailed" = "concise",
): string {
  if (format === "concise") {
    return `${report.percentage}% (${report.processedItems}/${report.totalItems})`;
  }

  return [
    `📊 Progress: ${report.percentage}%`,
    `✅ ${report.processedItems}/${report.totalItems} items`,
    `⏱️ ${report.elapsedMinutes}min elapsed`,
    `⏳ ~${report.estimatedRemainingMinutes}min remaining`,
  ].join("\n");
}

/**
 * Format checkpoint message for WhatsApp
 */
export function formatCheckpointForWhatsApp(message: string, expectsApproval: boolean): string {
  if (expectsApproval) {
    return `${message}\n\n↩️ Reply 'continue' to proceed or 'stop' to cancel.`;
  }
  return message;
}

/**
 * Parse user response to determine approval
 */
export function parseApprovalResponse(response: string): CheckpointResult {
  const trimmed = response.trim().toLowerCase();

  // Check for approval patterns
  for (const pattern of APPROVAL_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { approved: true, shouldContinue: true };
    }
  }

  // Check for rejection patterns
  for (const pattern of REJECTION_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { approved: false, shouldContinue: false, feedback: response };
    }
  }

  // Ambiguous response - ask for clarification
  return {
    approved: false,
    shouldContinue: false,
    feedback: `Unclear response: "${response}". Please reply 'continue' or 'stop'.`,
  };
}

/**
 * WhatsApp Message Sender Implementation
 * Connects checkpoint-executor to WhatsApp channel
 */
export class WhatsAppCheckpointAdapter implements MessageSender {
  private whatsappClient: WhatsAppClient | null = null;
  private pendingApprovals: Map<
    string,
    {
      resolve: (result: CheckpointResult) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  > = new Map();

  /**
   * Set the WhatsApp client
   */
  setClient(client: WhatsAppClient): void {
    this.whatsappClient = client;
  }

  /**
   * Send checkpoint message via WhatsApp
   */
  async sendCheckpointMessage(message: string, channel: string): Promise<void> {
    if (!this.whatsappClient) {
      console.log(`[WhatsApp Checkpoint] ${message}`);
      return;
    }

    const formatted = formatCheckpointForWhatsApp(message, false);
    await this.whatsappClient.sendMessage(channel, formatted);
  }

  /**
   * Send progress report via WhatsApp
   */
  async sendProgressReport(report: ProgressReport, channel: string): Promise<void> {
    if (!this.whatsappClient) {
      console.log(`[WhatsApp Progress] ${report.percentage}%`);
      return;
    }

    const formatted = formatProgressForWhatsApp(report, "concise");
    await this.whatsappClient.sendMessage(channel, formatted);
  }

  /**
   * Wait for user approval via WhatsApp
   */
  async waitForApproval(timeoutMs: number, channel: string): Promise<CheckpointResult> {
    if (!this.whatsappClient) {
      // No client - auto approve
      return { approved: true, shouldContinue: true };
    }

    // Send approval request
    await this.whatsappClient.sendMessage(
      channel,
      "↩️ Reply 'continue' to proceed or 'stop' to cancel.",
    );

    // Create promise that resolves on response or timeout
    return new Promise((resolve) => {
      const approvalId = `approval-${Date.now()}`;

      // Set timeout
      const timeout = setTimeout(() => {
        this.pendingApprovals.delete(approvalId);
        resolve({
          approved: false,
          shouldContinue: false,
          feedback: "Approval timed out",
        });
      }, timeoutMs);

      // Store pending approval
      this.pendingApprovals.set(approvalId, { resolve, timeout });

      // Register message handler
      this.whatsappClient!.onMessage(channel, (message: string) => {
        const pending = this.pendingApprovals.get(approvalId);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingApprovals.delete(approvalId);
          pending.resolve(parseApprovalResponse(message));
        }
      });
    });
  }

  /**
   * Handle incoming message (for approval responses)
   */
  handleIncomingMessage(channel: string, message: string): void {
    // This is called by the WhatsApp channel handler
    // Find any pending approvals for this channel and resolve them
    for (const [id, pending] of this.pendingApprovals) {
      clearTimeout(pending.timeout);
      this.pendingApprovals.delete(id);
      pending.resolve(parseApprovalResponse(message));
      break; // Handle first pending approval
    }
  }

  /**
   * Cancel all pending approvals
   */
  cancelPendingApprovals(): void {
    for (const [id, pending] of this.pendingApprovals) {
      clearTimeout(pending.timeout);
      pending.resolve({
        approved: false,
        shouldContinue: false,
        feedback: "Cancelled",
      });
    }
    this.pendingApprovals.clear();
  }
}

/**
 * WhatsApp client interface (to be implemented by actual WhatsApp integration)
 */
export interface WhatsAppClient {
  sendMessage(channel: string, content: string): Promise<void>;
  onMessage(channel: string, handler: (message: string) => void): void;
}

// Export singleton adapter
export const whatsappCheckpointAdapter = new WhatsAppCheckpointAdapter();
