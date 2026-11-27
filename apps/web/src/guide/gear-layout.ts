import { z } from "zod";
import raw from "../../../../config/web/gear-layout.json";

/** Where each slot sits on the paper doll (config/web/gear-layout.json), checked at start-up. */
const Area = z.object({
  col: z.number().int().min(1),
  row: z.number().int().min(1),
  colSpan: z.number().int().min(1),
  rowSpan: z.number().int().min(1),
});

const GearLayoutConfig = z.object({
  columns: z.number().int().min(1),
  slots: z.record(z.string().min(1), Area),
  glyphs: z.record(z.string().min(1), z.string().min(1)),
});

export const GEAR_LAYOUT = GearLayoutConfig.parse(raw);
