import { z } from "zod";

const envSchema = z.object({
  GOOGLE_APPLICATION_CREDENTIALS: z.string().min(1),
  DRIVE_ROOT_FOLDER_ID: z.string().min(1),
  ORG_DOMAIN: z.string().min(1),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(): Config {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
