import { gitPathspecError } from "@/lib/git-pathspec";

/**
 * Reject pathspecs that bypass the all:true metadata excludes or that are
 * magic/glob forms. Returns an error message, or null when the path is ok.
 */
export function commitPathError(p: string): string | null {
  return gitPathspecError(p, { rejectWebuiMeta: true });
}
