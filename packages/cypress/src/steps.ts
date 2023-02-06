/// <reference types="cypress" />

import { Test, TestStep } from "@replayio/test-utils";
import type debug from "debug";
import { AFTER_EACH_HOOK } from "./constants";
import type { StepEvent } from "./support";

interface StepStackItem {
  event: StepEvent;
  step: TestStep;
}

function toTime(timestamp: string) {
  return new Date(timestamp).getTime();
}

function toRelativeTime(timestamp: string, startTime: number) {
  return toTime(timestamp) - startTime;
}

function assertCurrentTest(currentTest: Test | undefined): asserts currentTest is Test {
  if (!currentTest) {
    throw new Error("currentTest does not exist");
  }
}

function assertMatchingStep(
  currentStep: StepEvent | undefined,
  previousStep: StepEvent | undefined
): asserts previousStep is StepEvent {
  if (
    !currentStep ||
    !previousStep ||
    !currentStep.command ||
    !previousStep.command ||
    currentStep.command.id !== previousStep.command.id
  ) {
    throw new Error(
      "Mismatched step event: " + JSON.stringify(currentStep) + JSON.stringify(previousStep)
    );
  }
}

function shouldSkipStep(step: StepEvent, skippedSteps: string[], debug: debug.Debugger) {
  debug = debug.extend("skip");
  const lastArg = step.command?.args?.[step.command.args.length - 1];

  let reason: string | undefined;
  if (lastArg != null && typeof lastArg === "object" && lastArg.log === false) {
    reason = "Command logging disabled";
  } else if (skippedSteps.includes(step.command?.id as any)) {
    reason = "Prior step event already skipped";
  } else if (skippedSteps.includes(step.command?.groupId as any)) {
    reason = "Parent skipped";
  }

  if (reason) {
    debug("Test step %s skipped: %s", step.command?.id || "", reason);
    return true;
  }

  return false;
}

function groupStepsByTest(
  steps: StepEvent[],
  firstTimestamp: number,
  debug: debug.Debugger
): Test[] {
  debug = debug.extend("group");
  if (steps.length === 0) {
    debug("No test steps found");
    return [];
  }

  // The steps can come in out of order but are sortable by timestamp
  const sortedSteps = [...steps].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const tests: Test[] = sortedSteps
    .filter(a => a.event === "test:start")
    .map(step => ({
      title: step.test[step.test.length - 1] || step.file,
      path: step.test,
      result: "passed",
      relativePath: step.file,
      relativeStartTime: toRelativeTime(step.timestamp, firstTimestamp),
      steps: [],
    }));

  debug("Found %d tests", tests.length);
  debug(
    "%O",
    tests.map(t => t.title)
  );

  const stepStack: StepStackItem[] = [];
  const skippedStepIds: string[] = [];

  // steps are grouped by `chainerId` and then assigned a parent here by
  // tracking the most recent groupId
  let activeGroup: { groupId: string; parentId: string } | undefined;
  let currentTest: Test | undefined;

  for (let i = 0; i < sortedSteps.length; i++) {
    const step = sortedSteps[i];

    let testForStep: Test | undefined = tests.find(
      t => t.title === step.test[step.test.length - 1]
    );
    if (currentTest !== testForStep) {
      activeGroup = undefined;
    }
    currentTest = testForStep;
    assertCurrentTest(currentTest);

    debug("Processing %s event: %o", step.event, step);

    switch (step.event) {
      case "step:enqueue":
        // ignore for now ...
        break;
      case "step:start":
        let parentId: string | undefined;

        if (shouldSkipStep(step, skippedStepIds, debug)) {
          if (step.command?.id) {
            skippedStepIds.push(step.command.id);
          }

          if (step.command?.groupId) {
            skippedStepIds.push(step.command.groupId);
          }
          break;
        }

        if (activeGroup && activeGroup.groupId === step.command?.groupId) {
          parentId = activeGroup.parentId;
        } else if (step.command?.groupId) {
          activeGroup = { groupId: step.command.groupId, parentId: step.command.id };
        }

        // Simplify args to avoid sending large objects in metadata that we
        // won't render in the UI anyway
        const args = step.command!.args.map(a => (a && typeof a === "object" ? {} : a));

        const testStep: TestStep = {
          id: step.command!.id,
          parentId,
          name: step.command!.name,
          args: args,
          commandId: step.command!.commandId,
          relativeStartTime:
            toRelativeTime(step.timestamp, firstTimestamp) - currentTest.relativeStartTime!,
          category: step.category || "other",
          hook: step.hook,
        };

        // If this assertion has an associated commandId, find that step by
        // command and add this command to its assertIds array
        if (step.command!.commandId) {
          const commandStep = currentTest.steps!.find(s => s.id === step.command!.commandId);
          if (commandStep) {
            commandStep.assertIds = commandStep?.assertIds || [];
            commandStep.assertIds.push(testStep.id);
          }
        }

        currentTest.steps!.push(testStep);
        stepStack.push({ event: step, step: testStep });
        break;
      case "step:end":
        assertCurrentTest(currentTest);
        const isAssert = step.command!.name === "assert";
        const lastStep: StepStackItem | undefined = stepStack.find(
          a => a.step.id === step.command!.id && a.event.test.toString() === step.test.toString()
        );

        if (!lastStep && skippedStepIds.includes(step.command?.id as any)) {
          // ignore step:ends for skipped steps
          break;
        }

        // TODO [ryanjduffy]: Skipping handling after each events for now
        if (step.test[0] === AFTER_EACH_HOOK) {
          debug("After each hooks are not currently supported");
          continue;
        }

        assertMatchingStep(step, lastStep?.event);

        // asserts can change the args if the message changes
        if (isAssert && step.command) {
          lastStep.step.args = step.command.args;
        }

        const currentTestStep = lastStep.step!;
        const relativeEndTime =
          toRelativeTime(step.timestamp, firstTimestamp) - currentTest.relativeStartTime!;
        currentTestStep.duration = Math.max(
          0,
          relativeEndTime - currentTestStep.relativeStartTime!
        );

        // Always set the error so that a successful retry will clear a previous error
        currentTestStep.error = step.error;
        break;
      case "test:end":
        currentTest.duration =
          toRelativeTime(step.timestamp, firstTimestamp) - currentTest.relativeStartTime!;
        break;
    }
  }

  return tests;
}

export { groupStepsByTest };
