export type TelegramCommand = "/status" | "/positions" | "/orders" | "/last_decisions" | "/system_health" | "/pause_auto_entries" | "/resume_auto_entries";
const COMMANDS = new Set<TelegramCommand>(["/status","/positions","/orders","/last_decisions","/system_health","/pause_auto_entries","/resume_auto_entries"]);

export class TelegramOutboxClient {
  private readonly pending: string[] = [];
  private readonly token: string;
  private readonly authorizedChatId: string;
  private readonly transport: typeof fetch;
  constructor(token: string, authorizedChatId: string, transport: typeof fetch = fetch) {
    this.token = token; this.authorizedChatId = authorizedChatId; this.transport = transport;
  }
  async notify(text: string): Promise<boolean> {
    if (!this.token || !this.authorizedChatId) { this.pending.push(text); return false; }
    try {
      const response = await this.transport(`https://api.telegram.org/bot${this.token}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: this.authorizedChatId, text }) });
      if (!response.ok) throw new Error("TELEGRAM_SEND_FAILED");
      return true;
    } catch { this.pending.push(text); return false; }
  }
  authorize(chatId: string, text: string): TelegramCommand | null {
    if (chatId !== this.authorizedChatId) return null;
    const command = text.trim().split(/\s+/)[0] as TelegramCommand;
    return COMMANDS.has(command) ? command : null;
  }
  queued(): readonly string[] { return Object.freeze([...this.pending]); }
}
