import { z } from "zod";

export function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return (schema as any)._def?.jsonSchema || {};
}
