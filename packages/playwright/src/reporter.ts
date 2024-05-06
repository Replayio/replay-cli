import type {
  FullConfig,
  Reporter,
  TestCase,
  TestError,
  TestResult,
  TestStep,
} from "@playwright/test/reporter";
import path from "path";

import {
  ReplayReporter,
  ReplayReporterConfig,
  removeAnsiCodes,
  TestMetadataV2,
  getMetadataFilePath as getMetadataFilePathBase,
  TestIdContext,
} from "@replayio/test-utils";

type UserActionEvent = TestMetadataV2.UserActionEvent;

import { readFileSync } from "fs";

const pluginVersion = require("@replayio/playwright/package.json").version;

export function getMetadataFilePath(workerIndex = 0) {
  return getMetadataFilePathBase("PLAYWRIGHT", workerIndex);
}

function extractErrorMessage(error: TestError) {
  const message = removeAnsiCodes(error.message);
  if (message) {
    // Error message. Set when [Error] (or its subclass) has been thrown.
    const errorMessageLines = message.split("\n");
    let stackStart = errorMessageLines.findIndex(l => l.startsWith("Call log:"));
    stackStart = stackStart == null || stackStart === -1 ? 10 : Math.min(stackStart, 10);
    return errorMessageLines.slice(0, stackStart).join("\n");
  } else if (error.value != null) {
    // The value that was thrown. Set when anything except the [Error] (or its subclass) has been thrown.
    return error.value;
  }

  return "Unknown error";
}

function mapTestStepCategory(step: TestStep): UserActionEvent["data"]["category"] {
  switch (step.category) {
    case "expect":
      return "assertion";
    case "step":
    case "pw:api":
      return "command";
    default:
      return "other";
  }
}

function mapTestStepHook(step: TestStep): "beforeEach" | "afterEach" | undefined {
  if (step.category !== "hook") return;

  switch (step.title) {
    case "Before Hooks":
      return "beforeEach";
    case "After Hooks":
      return "afterEach";
  }
}

type ReplayPlaywrightRecordingMetadata = {
  title: string;
  test: TestMetadataV2.TestRun;
};

export interface ReplayPlaywrightConfig
  extends ReplayReporterConfig<ReplayPlaywrightRecordingMetadata> {
  captureTestFile?: boolean;
}

class ReplayPlaywrightReporter implements Reporter {
  reporter?: ReplayReporter<ReplayPlaywrightRecordingMetadata>;
  captureTestFile: boolean;
  config: ReplayPlaywrightConfig;

  constructor(config: ReplayPlaywrightConfig) {
    if (!config || typeof config !== "object") {
      throw new Error(
        `Expected an object for @replayio/playwright/reporter configuration but received: ${config}`
      );
    }

    this.config = {
      ...config,
      apiKey: config.apiKey || process.env.REPLAY_API_KEY || process.env.RECORD_REPLAY_API_KEY,
    };
    if (!this.config.apiKey) {
      throw new Error(
        "`@replayio/playwright/reporter` requires an API key. Either pass a value to the apiKey plugin configuration or set the REPLAY_API_KEY environment variable"
      );
    }
    this.captureTestFile =
      "captureTestFile" in config
        ? !!config.captureTestFile
        : ["1", "true"].includes(
            process.env.PLAYWRIGHT_REPLAY_CAPTURE_TEST_FILE?.toLowerCase() || "true"
          );
  }

  getTestId(test: TestCase) {
    return test.titlePath().join("-");
  }

  getSource(test: TestCase) {
    return {
      title: test.title,
      scope: test.titlePath().slice(3, -1),
    };
  }

  getTestIdContext(test: TestCase, testResult: TestResult): TestIdContext {
    return {
      ...this.getSource(test),
      attempt: testResult.retry + 1,
    };
  }

  onBegin({ version }: FullConfig) {
    this.reporter = new ReplayReporter(
      {
        name: "playwright",
        version,
        plugin: pluginVersion,
      },
      "2.1.0"
    );
    this.reporter.onTestSuiteBegin(this.config, "PLAYWRIGHT_REPLAY_METADATA");
  }

  onTestBegin(test: TestCase, testResult: TestResult) {
    this.reporter?.onTestBegin(
      this.getTestIdContext(test, testResult),
      getMetadataFilePath(testResult.workerIndex)
    );
  }

  onTestEnd(test: TestCase, result: TestResult) {
    const status = result.status;
    // skipped tests won't have a reply so nothing to do here
    if (status === "skipped") return;

    const relativePath = test.titlePath()[2];
    let playwrightMetadata: Record<string, any> | undefined;

    if (this.captureTestFile) {
      try {
        playwrightMetadata = {
          "x-replay-playwright": {
            sources: {
              [relativePath]: readFileSync(test.location.file, "utf8").toString(),
            },
          },
        };
      } catch (e) {
        console.warn("Failed to read playwright test source from " + test.location.file);
        console.warn(e);
      }
    }

    const hookMap = new Map<"beforeEach" | "afterEach", UserActionEvent[]>();
    const steps: UserActionEvent[] = [];
    for (let [i, s] of result.steps.entries()) {
      const hook = mapTestStepHook(s);
      const stepErrorMessage = s.error ? extractErrorMessage(s.error) : null;
      const step: UserActionEvent = {
        data: {
          id: String(i),
          parentId: null,
          command: {
            name: s.title,
            arguments: [],
          },
          scope: s.titlePath(),
          error: stepErrorMessage
            ? {
                name: "AssertionError",
                message: stepErrorMessage,
                line: s.location?.line || 0,
                column: s.location?.column || 0,
              }
            : null,
          category: mapTestStepCategory(s),
        },
      };

      if (hook) {
        const hookSteps = hookMap.get(hook) || [];
        hookSteps.push(step);
        hookMap.set(hook, hookSteps);
      } else {
        steps.push(step);
      }
    }

    this.reporter?.onTestEnd({
      tests: [
        {
          id: 0,
          attempt: result.retry + 1,
          approximateDuration: test.results.reduce((acc, r) => acc + r.duration, 0),
          source: this.getSource(test),
          result: (status as any) === "interrupted" ? "unknown" : status,
          error: result.error
            ? {
                name: "Error",
                message: extractErrorMessage(result.error),
                line: (result.error as any).location?.line || 0,
                column: (result.error as any).location?.column || 0,
              }
            : null,
          events: {
            beforeAll: [],
            afterAll: [],
            beforeEach: hookMap.get("beforeEach") || [],
            afterEach: hookMap.get("afterEach") || [],
            main: steps,
          },
        },
      ],
      specFile: relativePath,
      replayTitle: test.title,
      extraMetadata: playwrightMetadata,
    });
  }

  async onEnd() {
    await this.reporter?.onEnd();
  }
}

export default ReplayPlaywrightReporter;
