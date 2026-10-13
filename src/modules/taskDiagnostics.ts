/** Local, ordered task records. Never record authentication headers. */
export class TaskDiagnostics {
  private pending = Promise.resolve();
  private sequence = 0;
  private stage = "created";
  private timeline = "";

  constructor(
    private readonly write: (name: string, content: string) => Promise<void>,
    private readonly secrets: string[] = [],
  ) {}

  private redact(content: string): string {
    for (const secret of this.secrets) {
      if (secret) content = content.split(secret).join("<REDACTED>");
    }
    return content;
  }

  save(name: string, value: unknown): Promise<void> {
    const content = this.redact(
      typeof value === "string" ? value : JSON.stringify(value, null, 2),
    );
    this.pending = this.pending.then(() => this.write(name, content));
    return this.pending;
  }

  async event(
    type: string,
    detail: Record<string, unknown> = {},
  ): Promise<void> {
    if (type === "stage") this.stage = String(detail.status);
    const number = ++this.sequence;
    const time = new Date().toISOString();
    const summary = { ...detail };
    delete summary.payload;
    delete summary.body;
    this.timeline += `${time} [${number}] ${this.stage} ${type} ${JSON.stringify(summary)}\n`;
    const timeline = this.timeline;
    await this.save(`event-${String(number).padStart(5, "0")}.json`, {
      time,
      sequence: number,
      stage: this.stage,
      type,
      ...detail,
    });
    await this.save("timeline.log", timeline);
  }

  async finish(status: string, detail: Record<string, unknown>): Promise<void> {
    await this.event(status, detail);
    await this.save("status.json", {
      status,
      stage: this.stage,
      time: new Date().toISOString(),
      ...detail,
    });
  }
}
