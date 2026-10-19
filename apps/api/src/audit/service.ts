import { CreateFlowSchema, normalizeLocalUrl } from "@accesoqa/shared";
import { Repository } from "../db/repository.js";
import { scanPage, type ScanResult } from "./scanner.js";
import { executeFlow } from "./flow-runner.js";

export class AuditService {
  private pending: Promise<void> | null = null;
  constructor(
    private readonly repository: Repository,
    private readonly scanner: (url: string) => Promise<ScanResult> = scanPage,
  ) {}
  get busy() {
    return this.pending !== null;
  }
  start(projectId: string) {
    if (this.busy) throw new Error("BUSY");
    const project = this.repository.project(projectId);
    if (!project) throw new Error("NOT_FOUND");
    const url = normalizeLocalUrl(project.baseUrl);
    const run = this.repository.createRun(project.id, url);
    this.pending = new Promise<void>((resolve) => setImmediate(resolve))
      .then(async () => {
        try {
          this.repository.running(run.id);
          const result = await this.scanner(url);
          this.repository.complete(run.id, result);
        } catch (error) {
          const raw =
            error instanceof Error ? error.message : "Error desconocido.";
          const message = /net::ERR_|ECONNREFUSED|Timeout|timeout/.test(raw)
            ? "No se pudo acceder a la página local o se agotó el tiempo. Comprueba que la aplicación esté iniciada."
            : raw;
          this.repository.fail(run.id, message.slice(0, 1200));
        }
      })
      .finally(() => {
        this.pending = null;
      });
    return run;
  }
  async idle() {
    await this.pending;
  }
  startFlow(flowId: string) {
    if (this.busy) throw new Error("BUSY");
    const flow = this.repository.flow(flowId);
    if (!flow) throw new Error("NOT_FOUND");
    const project = this.repository.project(flow.projectId);
    if (!project) throw new Error("NOT_FOUND");
    CreateFlowSchema.parse({
      name: flow.name,
      testDataOnly: true,
      steps: flow.steps.map((step) => step.definition),
    });
    const url = normalizeLocalUrl(project.baseUrl);
    const run = this.repository.createFlowRun(flow, url);
    this.pending = new Promise<void>((resolve) => setImmediate(resolve))
      .then(async () => {
        try {
          this.repository.running(run.id);
          const result = await executeFlow(url, flow.steps, {
            start: (position) => this.repository.startStep(run.id, position),
            complete: (position, checkpoint) =>
              this.repository.completeStep(run.id, position, checkpoint),
          });
          this.repository.finishRun(
            run.id,
            result.manualReviewCount,
            result.engineVersion,
          );
        } catch (error) {
          this.repository.fail(
            run.id,
            (error instanceof Error
              ? error.message
              : "No se pudo completar el flujo."
            ).slice(0, 1200),
          );
        }
      })
      .finally(() => {
        this.pending = null;
      });
    return run;
  }
}
