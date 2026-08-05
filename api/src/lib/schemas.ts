import { z } from "zod";

/** The `:id` path param shared by every top-level resource route. */
export const idParamsSchema = z.object({ id: z.uuid() });
