import { z } from "zod";

export const ProjectSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(120),
  baseUrl: z.string().url(),
  createdAt: z.string().datetime(),
});

export const AuditStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
]);
export const SeveritySchema = z.enum([
  "critical",
  "serious",
  "moderate",
  "minor",
]);
export const HealthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("accesoqa-api"),
  version: z.string(),
});

export type Project = z.infer<typeof ProjectSchema>;
export type AuditStatus = z.infer<typeof AuditStatusSchema>;
export type Severity = z.infer<typeof SeveritySchema>;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export function normalizeLocalUrl(value: string): string {
  if (
    value.length > 2048 ||
    Array.from(value).some(
      (char) =>
        char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127 || char === "\\",
    ) ||
    !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::[1-9]\d{0,4})?(?:[/?#]|$)/i.test(
      value,
    )
  ) {
    throw new Error(
      "Usa una URL HTTP/HTTPS con localhost, 127.0.0.1 o [::1], sin credenciales.",
    );
  }
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname.toLowerCase())
  ) {
    throw new Error("El destino no está autorizado.");
  }
  return url.href;
}

export const LocalUrlSchema = z.string().transform((value, ctx) => {
  try {
    return normalizeLocalUrl(value);
  } catch {
    ctx.addIssue({
      code: "custom",
      message:
        "Solo se permiten URLs HTTP/HTTPS explícitas de localhost, 127.0.0.1 o [::1], sin credenciales.",
    });
    return z.NEVER;
  }
});
export const CreateProjectSchema = z
  .object({ name: z.string().trim().min(1).max(120), baseUrl: LocalUrlSchema })
  .strict();
export const FindingNodeSchema = z.object({
  html: z.string(),
  selector: z.string(),
  failureSummary: z.string().nullable(),
});
export const FindingSchema = z.object({
  id: z.string().uuid(),
  ruleId: z.string(),
  description: z.string(),
  impact: SeveritySchema,
  help: z.string(),
  helpUrl: z.string(),
  url: z.string(),
  pageTitle: z.string(),
  createdAt: z.string(),
  nodes: z.array(FindingNodeSchema),
  checkpointId: z.string().uuid().optional(),
  stepPosition: z.number().nullable().default(null),
  stepLabel: z.string().nullable().default(null),
});
export const MAX_FLOW_STEPS = 20;
export const MAX_FLOW_DURATION_MS = 120000;
export const TestDataTemplates = {
  name: "Usuario de prueba",
  email: "usuario@example.test",
  text: "Dato ficticio",
  number: "12345",
  password: "AccesoQA-Prueba-123!",
} as const;
export const AccessibleRoles = [
  "button",
  "link",
  "textbox",
  "checkbox",
  "combobox",
  "radio",
  "heading",
  "status",
  "alert",
  "dialog",
  "tab",
  "menuitem",
  "spinbutton",
  "searchbox",
] as const;
export const FlowLocatorSchema = z.discriminatedUnion("by", [
  z
    .object({
      by: z.literal("role"),
      role: z.enum(AccessibleRoles),
      name: z.string().trim().min(1).max(160),
    })
    .strict(),
  z
    .object({
      by: z.literal("label"),
      value: z.string().trim().min(1).max(160),
    })
    .strict(),
  z
    .object({
      by: z.literal("testId"),
      value: z.string().trim().min(1).max(160),
    })
    .strict(),
]);
export const LocalPathSchema = z
  .string()
  .max(2048)
  .refine(
    (value) =>
      value.startsWith("/") &&
      !value.startsWith("//") &&
      !Array.from(value).some(
        (char) =>
          char.charCodeAt(0) <= 32 ||
          char.charCodeAt(0) === 127 ||
          char === "\\",
      ),
    "Usa una ruta local que empiece por /, sin host ni código.",
  );
const stepCommon = {
  label: z.string().trim().min(1).max(120),
  checkpoint: z.boolean().default(false),
  timeoutMs: z.number().int().min(1000).max(15000).default(5000),
};
export const FlowStepInputSchema = z.discriminatedUnion("action", [
  z
    .object({
      ...stepCommon,
      action: z.literal("navigate"),
      path: LocalPathSchema,
    })
    .strict(),
  z
    .object({
      ...stepCommon,
      action: z.literal("click"),
      locator: FlowLocatorSchema,
    })
    .strict(),
  z
    .object({
      ...stepCommon,
      action: z.literal("fill"),
      locator: FlowLocatorSchema,
      template: z.enum(["name", "email", "text", "number", "password"]),
    })
    .strict(),
  z
    .object({
      ...stepCommon,
      action: z.literal("visible"),
      locator: FlowLocatorSchema,
    })
    .strict(),
]);
export const CreateFlowSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    testDataOnly: z.literal(true),
    steps: z.array(FlowStepInputSchema).min(1).max(MAX_FLOW_STEPS),
  })
  .strict()
  .superRefine((flow, ctx) => {
    if (flow.steps[0]?.action !== "navigate")
      ctx.addIssue({
        code: "custom",
        path: ["steps"],
        message: "El primer paso debe navegar a una ruta local.",
      });
    if (!flow.steps.some((step) => step.checkpoint))
      ctx.addIssue({
        code: "custom",
        path: ["steps"],
        message: "Define al menos un punto de control de accesibilidad.",
      });
  });
export const FlowStepSchema = z.object({
  id: z.string().uuid(),
  position: z.number().int(),
  definition: FlowStepInputSchema,
});
export const FlowSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  name: z.string(),
  createdAt: z.string(),
  steps: z.array(FlowStepSchema),
});
export const StepRunSchema = z.object({
  id: z.string().uuid(),
  position: z.number().int(),
  label: z.string(),
  definition: FlowStepInputSchema,
  status: z.enum(["pending", "running", "completed", "failed", "skipped"]),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  errorMessage: z.string().nullable(),
});
export const CheckpointSchema = z.object({
  id: z.string().uuid(),
  stepRunId: z.string().uuid().nullable(),
  position: z.number(),
  label: z.string(),
  url: z.string(),
  pageTitle: z.string(),
  createdAt: z.string(),
  manualReviewCount: z.number().nullable(),
  engineVersion: z.string().nullable(),
  findings: z.array(FindingSchema),
});
export const AuditRunSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  status: AuditStatusSchema,
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  errorMessage: z.string().nullable(),
  requestedUrl: z.string(),
  url: z.string().nullable(),
  pageTitle: z.string().nullable(),
  configKey: z.string().nullable().default(null),
  findingsCount: z.number().nullable(),
  manualReviewCount: z.number().nullable(),
  engineVersion: z.string().nullable(),
  findings: z.array(FindingSchema),
  flowId: z.string().uuid().nullable().default(null),
  steps: z.array(StepRunSchema).default([]),
  checkpoints: z.array(CheckpointSchema).default([]),
});
export type Finding = z.infer<typeof FindingSchema>;
export type AuditRun = z.infer<typeof AuditRunSchema>;
export type CreateProject = z.infer<typeof CreateProjectSchema>;
export type FlowLocator = z.infer<typeof FlowLocatorSchema>;
export type FlowStepInput = z.infer<typeof FlowStepInputSchema>;
export type FlowStep = z.infer<typeof FlowStepSchema>;
export type Flow = z.infer<typeof FlowSchema>;
export type CreateFlow = z.infer<typeof CreateFlowSchema>;

export const OccurrenceSchema = z.object({
  stableId: z.string(),
  checkpointKey: z.string(),
  checkpointId: z.string(),
  position: z.number(),
  label: z.string(),
  screen: z.string(),
  ruleId: z.string(),
  impact: SeveritySchema,
  description: z.string(),
  helpUrl: z.string(),
  html: z.string(),
  selector: z.string(),
  failureSummary: z.string().nullable(),
  observedAt: z.string(),
});
export type Occurrence = z.infer<typeof OccurrenceSchema>;
export const ImpactCountsSchema = z.object({
  critical: z.number(),
  serious: z.number(),
  moderate: z.number(),
  minor: z.number(),
});
export const AuditSummarySchema = z.object({
  total: z.number(),
  byImpact: ImpactCountsSchema,
  byStep: z.array(
    z.object({
      position: z.number(),
      label: z.string(),
      total: z.number(),
      byImpact: ImpactCountsSchema,
    }),
  ),
});
export const AuditReportSchema = z.object({
  schemaVersion: z.literal(1),
  exportedAt: z.string(),
  run: AuditRunSchema,
  occurrences: z.array(OccurrenceSchema),
  summary: AuditSummarySchema,
  limitations: z.array(z.string()),
});
export const ComparisonSchema = z.object({
  baselineId: z.string(),
  currentId: z.string(),
  flowId: z.string(),
  coverage: z.enum(["complete", "partial", "unavailable"]),
  reasons: z.array(z.string()),
  counts: z.object({
    new: z.number(),
    persistent: z.number(),
    potentiallyFixed: z.number(),
    notCompared: z.number(),
  }),
  changes: z.array(
    z.object({
      classification: z.enum([
        "new",
        "persistent",
        "potentiallyFixed",
        "notCompared",
      ]),
      before: OccurrenceSchema.nullable(),
      after: OccurrenceSchema.nullable(),
    }),
  ),
});
export const HistorySchema = z.object({
  total: z.number(),
  offset: z.number(),
  limit: z.number(),
  items: z.array(
    z.object({
      id: z.string(),
      flowId: z.string().nullable(),
      status: AuditStatusSchema,
      createdAt: z.string(),
      finishedAt: z.string().nullable(),
      errorMessage: z.string().nullable(),
    }),
  ),
});
