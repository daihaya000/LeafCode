import {
  findWorkspaceIdsBySessionAndDirectory,
} from "@/lib/db";
import {
  claimMemoryInjectionForSession,
  type MemoryInjectionClaim,
} from "@/lib/memory";
import {
  collaborationContextFor,
  prependCollaborationContext,
} from "@/lib/collaboration-context";

/**
 * Request-body augmentation for the BFF proxy (REFACTORING_PLAN P4-a):
 * approved-memory injection and collaboration-context prepending on session
 * writes. Both are best-effort and must never block a prompt.
 */

export function injectWorkspaceMemory(
  requestBody: ArrayBuffer,
  sessionId: string,
  directory: string,
): { body: ArrayBuffer; claim: MemoryInjectionClaim | null } {
  const workspaces = findWorkspaceIdsBySessionAndDirectory(sessionId, directory);
  // A session can belong to more than one workspace; inject only when the
  // ownership is unambiguous so one project's context never leaks into another.
  if (workspaces.length !== 1) return { body: requestBody, claim: null };
  try {
    const body = JSON.parse(new TextDecoder().decode(requestBody)) as {
      parts?: Array<{ type?: unknown; text?: unknown }>;
    };
    const firstText = body.parts?.find((part) => part.type === "text" && typeof part.text === "string");
    if (
      !firstText ||
      typeof firstText.text !== "string"
    ) {
      return { body: requestBody, claim: null };
    }
    const claim = claimMemoryInjectionForSession(
      workspaces[0]!,
      sessionId,
      firstText.text,
    );
    if (!claim) return { body: requestBody, claim: null };
    firstText.text = `${claim.block}\n${firstText.text}`;
    return { body: new TextEncoder().encode(JSON.stringify(body)).buffer, claim };
  } catch {
    return { body: requestBody, claim: null };
  }
}

export async function injectCollaborationContext(
  requestBody: ArrayBuffer,
  sessionId: string,
  directory: string,
): Promise<ArrayBuffer> {
  const workspaces = findWorkspaceIdsBySessionAndDirectory(sessionId, directory);
  if (workspaces.length !== 1) return requestBody;
  try {
    const block = await collaborationContextFor({
      workspaceId: workspaces[0]!,
      sessionId,
      directory,
    });
    if (!block) return requestBody;
    const body = JSON.parse(new TextDecoder().decode(requestBody)) as Record<string, unknown>;
    return new TextEncoder()
      .encode(JSON.stringify(prependCollaborationContext(body, block)))
      .buffer;
  } catch {
    // Collaboration awareness is best-effort and must never block a prompt.
    return requestBody;
  }
}
