/// <reference types="cypress" />

import path from "path";
import { getPlaywrightBrowserPath } from "@replayio/replay";
import { getDirectory } from "@replayio/replay/src/utils";
import { ReplayReporter, Test } from "@replayio/test-utils";

const plugin: Cypress.PluginConfig = (on, config) => {
  const reporter = new ReplayReporter({ name: "cypress", version: config.version });
  let selectedBrowser: "chromium" | "firefox";
  on("before:browser:launch", (browser, launchOptions) => {
    selectedBrowser = browser.family;
    reporter.onTestSuiteBegin(undefined, "CYPRESS_REPLAY_METADATA");

    const [major, minor] = config.version.split(".");
    if (major && Number.parseInt(major) >= 10 && minor && Number.parseInt(minor) >= 9) {
      return {
        ...launchOptions,
        env: {
          RECORD_REPLAY_DRIVER:
            process.env.RECORD_REPLAY_NO_RECORD && selectedBrowser === "chromium"
              ? __filename
              : undefined,
          RECORD_ALL_CONTENT: process.env.RECORD_REPLAY_NO_RECORD ? undefined : 1,
          RECORD_REPLAY_METADATA_FILE: getMetadataFilePath(),
        },
      };
    }
  });
  on("before:spec", () => reporter.onTestBegin(undefined, getMetadataFilePath()));
  on("after:spec", (spec, result) => {
    const status = result.tests.reduce<Test["result"]>((acc, t) => {
      if (acc === "failed" || t.state === "failed") {
        return "failed";
      }

      return "passed";
    }, "passed");

    if (!["passed", "failed"].includes(status)) return;

    reporter.onTestEnd({
      title: spec.relative,
      path: ["", selectedBrowser || "", spec.relative, spec.specType || ""],
      result: status,
      relativePath: spec.relative,
    });
  });

  const chromiumPath = getPlaywrightBrowserPath("chromium");
  if (chromiumPath) {
    Object.assign(config, {
      browsers: config.browsers.concat({
        name: "Replay Chromium",
        channel: "stable",
        family: "chromium",
        displayName: "Replay",
        version: "91.0",
        path: chromiumPath,
        majorVersion: 91,
        isHeaded: true,
        isHeadless: false,
      }),
    });
  }

  const firefoxPath = getPlaywrightBrowserPath("firefox");
  if (firefoxPath) {
    Object.assign(config, {
      browsers: config.browsers.concat({
        name: "Replay Firefox",
        channel: "stable",
        family: "firefox",
        displayName: "Replay",
        version: "91.0",
        path: firefoxPath,
        majorVersion: 91,
        isHeaded: true,
        isHeadless: false,
      }),
    });
  }

  return config;
};

export function getMetadataFilePath(workerIndex = 0) {
  return (
    process.env.RECORD_REPLAY_METADATA_FILE ||
    path.join(getDirectory(), `CYPRESS_METADATA_${workerIndex}`)
  );
}

export default plugin;
