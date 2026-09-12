import fs from "node:fs";
import path from "node:path";
import type { NarratedSaveResult } from "../../shared/types/narration.js";

type NarratedSaveFailure = Extract<NarratedSaveResult, { success: false }>;

export type ResolvedPresentationSaveTarget<TRequest> =
  | { resolved: true; request: TRequest }
  | { resolved: false; failure: NarratedSaveFailure };

/**
 * Resolves a narrated save request's presentation path and rejects a missing
 * presentation before any narration is synthesized.
 */
export function resolvePresentationSaveTarget<TRequest extends { filePath: string }>(
  request: TRequest,
): ResolvedPresentationSaveTarget<TRequest> {
  const absolutePath = path.resolve(request.filePath);

  if (!fs.existsSync(absolutePath)) {
    return {
      resolved: false,
      failure: {
        success: false,
        stage: "validation",
        partial: false,
        message: `File not found: ${absolutePath}`,
      },
    };
  }

  return { resolved: true, request: { ...request, filePath: absolutePath } };
}
