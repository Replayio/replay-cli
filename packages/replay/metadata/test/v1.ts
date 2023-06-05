import {
  array,
  defaulted,
  enums,
  number,
  object,
  optional,
  string,
  define,
  any,
} from "superstruct";
const isUuid = require("is-uuid");

import { envString, firstEnvValueOf } from "../env";

export default {
  "1.0.0": object({
    suite: optional(envString("RECORD_REPLAY_METADATA_TEST_SUITE")),
    file: optional(envString("RECORD_REPLAY_METADATA_TEST_FILE")),
    title: envString("RECORD_REPLAY_METADATA_TEST_TITLE"),
    path: optional(array(string())),
    result: defaulted(
      enums(["passed", "failed", "timedOut", "skipped", "unknown"]),
      firstEnvValueOf("RECORD_REPLAY_METADATA_TEST_RESULT")
    ),
    // before/after all hooks
    hooks: optional(
      array(
        object({
          title: string(),
          path: array(string()),
          steps: optional(array(any())),
        })
      )
    ),
    tests: optional(
      array(
        object({
          id: optional(string()),
          parentId: optional(string()),
          title: string(),
          path: optional(array(string())),
          relativePath: optional(string()),
          result: enums(["passed", "failed", "timedOut", "skipped", "unknown"]),
          error: optional(
            object({
              message: string(),
              line: optional(number()),
              column: optional(number()),
            })
          ),
          relativeStartTime: optional(number()),
          duration: optional(number()),
          steps: optional(array(any())),
        })
      )
    ),
    runner: optional(
      defaulted(
        object({
          name: optional(envString("RECORD_REPLAY_METADATA_TEST_RUNNER_NAME")),
          version: optional(envString("RECORD_REPLAY_METADATA_TEST_RUNNER_VERSION")),
          plugin: optional(envString("RECORD_REPLAY_METADATA_TEST_RUNNER_PLUGIN")),
        }),
        {}
      )
    ),
    run: optional(
      defaulted(
        object({
          id: defaulted(
            define("uuid", (v: any) => isUuid.v4(v)),
            firstEnvValueOf("RECORD_REPLAY_METADATA_TEST_RUN_ID", "RECORD_REPLAY_TEST_RUN_ID")
          ),
          title: optional(envString("RECORD_REPLAY_METADATA_TEST_RUN_TITLE")),
          mode: optional(envString("RECORD_REPLAY_METADATA_TEST_RUN_MODE")),
        }),
        {}
      )
    ),
    reporterErrors: defaulted(array(any()), []),
    version: defaulted(number(), () => 1),
  }),
};
