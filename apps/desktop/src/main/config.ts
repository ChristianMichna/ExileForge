import { readFile } from "node:fs/promises";
import { z } from "zod";

const Scheme = z.string().regex(/^[a-z][a-z0-9+.-]*:$/);

export const DesktopConfig = z.object({
  version: z.string().min(1),
  port: z.int().min(1024).max(65_535),
  window: z.object({
    width: z.int().positive(),
    height: z.int().positive(),
    minWidth: z.int().positive(),
    minHeight: z.int().positive(),
  }),
  claude: z
    .object({
      desktopUrl: z.string().min(1),
      allowedSchemes: z.array(Scheme).min(1),
      /** Contains `{code}` exactly once. */
      startSentence: z.string().refine((s) => s.split("{code}").length === 2, {
        message: "startSentence must contain {code} exactly once",
      }),
    })
    .refine((c) => URL.canParse(c.desktopUrl), { message: "desktopUrl is not a URL" })
    .refine((c) => c.allowedSchemes.includes(new URL(c.desktopUrl).protocol), {
      message: "desktopUrl uses a scheme that is not in allowedSchemes",
    }),
  update: z.object({
    enabled: z.boolean(),
    firstCheckDelaySeconds: z.int().nonnegative(),
    checkIntervalHours: z.number().positive(),
  }),
});
export type DesktopConfig = z.infer<typeof DesktopConfig>;

export async function loadDesktopConfig(path: string): Promise<DesktopConfig> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    throw new Error(`Cannot read desktop config ${path}`, { cause: error });
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Desktop config ${path} is not valid JSON`, { cause: error });
  }
  const parsed = DesktopConfig.safeParse(json);
  if (!parsed.success) {
    throw new Error(`Desktop config ${path} is invalid:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
