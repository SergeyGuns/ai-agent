import { z } from "zod";

export function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  return parseZodDef(schema._def);
}

function parseZodDef(def: z.ZodTypeDef): Record<string, unknown> {
  const typed = def as z.ZodTypeDef & { typeName?: string };
  switch (typed.typeName) {
    case "ZodObject": {
      const shape = (def as z.ZodObjectDef).shape();
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [key, value] of Object.entries(shape)) {
        const fieldSchema = parseZodDef((value as z.ZodTypeAny)._def);
        const description = (value as z.ZodTypeAny).description;
        if (description) fieldSchema.description = description;
        properties[key] = fieldSchema;
        if (!(value as z.ZodTypeAny).isOptional()) required.push(key);
      }
      return {
        type: "object",
        properties,
        required,
        additionalProperties: false,
      };
    }
    case "ZodString":
      return { type: "string" };
    case "ZodEnum":
      return { type: "string", enum: (def as z.ZodEnumDef).values };
    case "ZodArray":
      return {
        type: "array",
        items: parseZodDef(((def as z.ZodArrayDef).type as z.ZodTypeAny)._def),
      };
    case "ZodOptional":
      return parseZodDef(
        ((def as z.ZodOptionalDef).innerType as z.ZodTypeAny)._def,
      );
    case "ZodDefault":
      return parseZodDef(
        ((def as z.ZodDefaultDef).innerType as z.ZodTypeAny)._def,
      );
    default:
      return {};
  }
}
