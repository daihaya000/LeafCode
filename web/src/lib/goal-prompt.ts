import { memoryInjectionFor } from "./memory";
import type { GoalLoopDto } from "./goal-loop";

export function buildGoalPromptWithMemory(
  loop: GoalLoopDto,
  turnNumber: number,
  maxTurns: number,
  forceMemory = false,
): string {
  const prompt =
    turnNumber === 1
      ? buildGoalPrompt(loop, turnNumber, maxTurns)
      : buildGoalContinuationPrompt(loop, turnNumber, maxTurns);
  if (turnNumber !== 1 && !forceMemory) return prompt;
  // The goal text is the retrieval query: injecting the globally most-used
  // memories regardless of the task fills the budget with irrelevant notes and
  // makes the same few rows win forever (use_count feedback loop).
  const memory = memoryInjectionFor(loop.workspaceId, loop.goal);
  return memory ? `${memory}\n${prompt}` : prompt;
}

/**
 * One prompt = one loop turn. The agent cannot see the loop counter from
 * inside the session, so without it being stated explicitly agents compress
 * every remaining step into a single turn (and even narrate turns that never
 * ran) instead of letting the WebUI drive the next iteration.
 */
export function buildGoalPrompt(loop: GoalLoopDto, turnNumber: number, maxTurns: number): string {
  const acceptance = loop.acceptance.length
    ? `\n\nAcceptance criteria:\n${loop.acceptance.map((a, i) => `${i + 1}. ${a}`).join("\n")}`
    : "";
  const recent = loop.progress.length
    ? `\n\nRecent progress:\n${loop.progress
        .slice(-5)
        .map((p) => `- ${p.time}: ${p.summary}${p.next ? ` / next: ${p.next}` : ""}`)
        .join("\n")}`
    : "";
  if (loop.forceFullRun) {
    return `<!-- webui-goal-loop-prompt -->

You are running a WebUI native persistent goal loop in full-run mode. The WebUI will always run exactly ${maxTurns} goal turns — do not declare the goal complete early.

This is turn ${turnNumber} of exactly ${maxTurns}. ${turnNumber - 1} loop turn(s) completed before this one. The WebUI sends the next prompt automatically after this turn ends.

Rules:
- One turn = one iteration. Do the smallest useful increment, then end this turn and let the WebUI prompt you again. Do not chain the remaining steps to finish the whole goal in a single turn.
- Report only work you actually performed in this turn. Never simulate, narrate, or count future turns as if they already happened.
- Write a brief human-readable summary before the JSON block. Do not make the JSON block your only output; the WebUI hides that internal block in the chat.
- Continue until all ${maxTurns} turns have been executed, or you are blocked / paused / stopped by the WebUI. Never claim the goal is complete; early completion claims are ignored.
- Do not ask the user questions unless truly blocked.
- Keep changes incremental and reviewable.
- Follow repository safety instructions and avoid destructive operations.

Goal:
${loop.goal}${acceptance}${recent}

The very last thing you output this turn must be a single fenced JSON block:

\`\`\`json
{"status":"progress","summary":"what changed this turn","next":"the next step","evidence":"commands run, files touched, results"}
\`\`\`

- status must be exactly one of: progress, blocked.
- progress: work performed this turn (always use this unless blocked).
- blocked: user input or manual intervention is required (put the reason in blockedReason).
- Do not use status "completed". The loop ignores completion claims and keeps running until turn ${maxTurns}.
- summary is required. Write nothing after the closing fence.`;
  }
  return `<!-- webui-goal-loop-prompt -->

You are running a WebUI native persistent goal loop. Work on the next smallest useful step toward the goal. Prefer code changes, tests, typechecks, builds, and concrete evidence over discussion.

This is turn ${turnNumber} of at most ${maxTurns}. ${turnNumber - 1} loop turn(s) completed before this one. The WebUI sends the next prompt automatically after this turn ends.

Rules:
- One turn = one iteration. Do the smallest useful increment, then end this turn and let the WebUI prompt you again. Do not chain the remaining steps to finish the whole goal in a single turn.
- Report only work you actually performed in this turn. Never simulate, narrate, or count future turns as if they already happened.
- Write a brief human-readable summary before the JSON block. Do not make the JSON block your only output; the WebUI hides that internal block in the chat.
- Continue autonomously until the goal is completed, blocked, paused, or stopped by the WebUI.
- Do not ask the user questions unless truly blocked.
- Do not claim completion unless the goal and acceptance criteria are satisfied. A completed claim will be independently verified before the loop ends.
- Keep changes incremental and reviewable.
- Follow repository safety instructions and avoid destructive operations.

Goal:
${loop.goal}${acceptance}${recent}

The very last thing you output this turn must be a single fenced JSON block:

\`\`\`json
{"status":"progress","summary":"what changed this turn","next":"the next step","evidence":"commands run, files touched, results"}
\`\`\`

- status must be exactly one of: progress, completed, blocked.
- progress: meaningful progress was made but the goal is not complete.
- completed: the goal is complete with concrete evidence.
- blocked: user input or manual intervention is required (put the reason in blockedReason).
- summary is required. Write nothing after the closing fence.`;
}

/**
 * Short prompt used after turn 1. The goal and acceptance criteria remain in
 * the prompt because they are the loop's durable task state, while the long
 * static rules are reduced to the few invariants needed for one continuation
 * turn. Keep the structured progress fields, including evidence, so the next
 * turn and the later verification turn retain the previous claim context.
 */
export function buildGoalContinuationPrompt(
  loop: GoalLoopDto,
  turnNumber: number,
  maxTurns: number,
): string {
  const acceptance = loop.acceptance.length
    ? `\n\nAcceptance criteria:\n${loop.acceptance.map((a, i) => `${i + 1}. ${a}`).join("\n")}`
    : "";
  const recent = loop.progress.length
    ? `\n\nRecent progress:\n${loop.progress
        .slice(-2)
        .map(
          (p) =>
            `- ${p.time}: ${p.summary}${p.next ? ` / next: ${p.next}` : ""}${
              p.evidence ? ` / evidence: ${p.evidence}` : ""
            }`,
        )
        .join("\n")}`
    : "";
  if (loop.forceFullRun) {
    return `<!-- webui-goal-loop-prompt -->

Continue the WebUI native persistent goal loop in full-run mode. Work on exactly one smallest useful step, then end this turn. The WebUI will run exactly ${maxTurns} turns — never declare the goal complete.

This is turn ${turnNumber} of exactly ${maxTurns}. Report only work actually performed in this turn. Do not simulate future work. Do not claim completion.

Goal:
${loop.goal}${acceptance}${recent}

The very last thing you output this turn must be a single fenced JSON block:

\`\`\`json
{"status":"progress","summary":"what changed this turn","next":"the next step","evidence":"commands run, files touched, results"}
\`\`\`

Use exactly one status: progress or blocked. Do not use status "completed". summary is required. Put a blocked reason in blockedReason when status is blocked. Write nothing after the closing fence.`;
  }
  return `<!-- webui-goal-loop-prompt -->

Continue the WebUI native persistent goal loop. Work on exactly one smallest useful step toward the goal, then end this turn for the WebUI to continue.

This is turn ${turnNumber} of at most ${maxTurns}. Report only work actually performed in this turn. Do not simulate future work or claim completion without concrete evidence.

Goal:
${loop.goal}${acceptance}${recent}

The very last thing you output this turn must be a single fenced JSON block:

\`\`\`json
{"status":"progress","summary":"what changed this turn","next":"the next step","evidence":"commands run, files touched, results"}
\`\`\`

Use exactly one status: progress, completed, or blocked. summary is required. Put a blocked reason in blockedReason when status is blocked. Write nothing after the closing fence.`;
}

export function buildVerificationPrompt(
  loop: GoalLoopDto,
  turnsExecuted: number,
  maxTurns: number,
): string {
  const claim = loop.progress.at(-1);
  const acceptance = loop.acceptance.length
    ? `\n\nAcceptance criteria to verify:\n${loop.acceptance.map((a, i) => `${i + 1}. ${a}`).join("\n")}`
    : "";
  return `<!-- webui-goal-loop-prompt -->

The previous turn claimed the goal was completed. Your job this turn is to independently verify that claim. Do not do new work unless necessary to verify; focus on inspection, tests, or checks.

Only ${turnsExecuted} loop turn(s) of at most ${maxTurns} have actually been executed so far. Treat that count as ground truth when judging the claim.

Rules:
- Verify each acceptance criterion above and report whether the claim is actually true.
- Check the claim against the real transcript and repository state, not against the claim's own narration. Reject it (return progress) if it reports more turns, iterations, or work than the ${turnsExecuted} executed turn(s) could contain, or if the evidence is simulated rather than observable.
- Write a brief human-readable verification summary before the JSON block. Do not make the JSON block your only output; the WebUI hides that internal block in the chat.
- If the claim is fully verified, return verified_completed.
- If the claim is not fully verified or more work is needed, return progress.
- If you are blocked from verifying, return blocked.

Claimed completion:
${claim ? `summary: ${claim.summary}\nevidence: ${claim.evidence ?? "(none)"}` : "(no claim recorded)"}${acceptance}

The very last thing you output this turn must be a single fenced JSON block:

\`\`\`json
{"status":"verified_completed","summary":"verification result","evidence":"checks performed and their results"}
\`\`\`

- status must be exactly one of: verified_completed, progress, blocked.
- verified_completed: the completed claim is true and all acceptance criteria are satisfied.
- progress: the claim is not fully verified or additional work is required.
- blocked: verification cannot proceed without user input.
- summary is required. Write nothing after the closing fence.`;
}
