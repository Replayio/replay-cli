/// <reference types="cypress" />

import semver from "semver";
import { getPlaywrightBrowserPath } from "@replayio/replay";
import { initMetadataFile } from "@replayio/test-utils";
import dbg from "debug";
import chalk from "chalk";

import { TASK_NAME } from "./constants";
import CypressReporter, { getMetadataFilePath, isStepEvent } from "./reporter";
import run from "./run";
import { PluginFeature } from "./features";

const debug = dbg("replay:cypress:plugin");
const debugTask = debug.extend("task");
const debugEvents = debug.extend("events");

let cypressReporter: CypressReporter;
let missingSteps = false;

function warn(...lines: string[]) {
  const terminalWidth = process.stdout.columns || 80;
  const packageName = "@replayio/cypress";

  const startHeaderWidth = Math.floor((terminalWidth - packageName.length) / 2 - 1);
  const endHeaderWidth = terminalWidth - startHeaderWidth - packageName.length - 2;

  console.warn(
    "\n%s %s %s\n",
    "".padEnd(startHeaderWidth, "="),
    chalk.magentaBright(packageName),
    "".padEnd(endHeaderWidth, "=")
  );
  lines.forEach(l => console.warn(l));
  console.warn("\n%s\n", "".padEnd(terminalWidth, "="));
}

function getAuthKey<T extends { env?: { [key: string]: any } }>(config: T): string | undefined {
  return (
    // migrating away from `RECORD_REPLAY_` to `REPLAY_`
    config.env?.REPLAY_API_KEY ||
    config.env?.RECORD_REPLAY_API_KEY ||
    process.env.REPLAY_API_KEY ||
    process.env.RECORD_REPLAY_API_KEY
  );
}

async function onBeforeRun(details: Cypress.BeforeRunDetails) {
  const authKey = getAuthKey(details.config);
  if (authKey) {
    await cypressReporter.authenticate(authKey);
  }
}

function onBeforeBrowserLaunch(
  config: Cypress.PluginConfigOptions,
  browser: Cypress.Browser,
  launchOptions: Cypress.BrowserLaunchOptions
) {
  debugEvents("Handling before:browser:launch");
  cypressReporter.onLaunchBrowser(browser.family);

  debugEvents("Browser launching: %o", { family: browser.family });

  if (browser.name !== "electron" && config.version && semver.gte(config.version, "10.9.0")) {
    const diagnosticConfig = cypressReporter.getDiagnosticConfig();
    const noRecord = !!process.env.RECORD_REPLAY_NO_RECORD || diagnosticConfig.noRecord;

    const env: NodeJS.ProcessEnv = {
      ...launchOptions.env,
      RECORD_REPLAY_DRIVER: noRecord && browser.family === "chromium" ? __filename : undefined,
      RECORD_ALL_CONTENT: noRecord ? undefined : "1",
      RECORD_REPLAY_METADATA_FILE: initMetadataFile(getMetadataFilePath()),
      ...diagnosticConfig.env,
    };

    debugEvents("Adding environment variables to browser: %o", env);

    launchOptions.env = env;
  }

  return launchOptions;
}

function onAfterRun() {
  if (missingSteps) {
    warn(
      "Your tests completed but our plugin did not receive any command events.",
      "",
      `Did you remember to include ${chalk.magentaBright(
        "@replayio/cypress/support"
      )} in your support file?`
    );
  }
}

function onBeforeSpec(spec: Cypress.Spec) {
  debugEvents("Handling before:spec %s", spec.relative);
  cypressReporter.onBeforeSpec(spec);
}

function onAfterSpec(spec: Cypress.Spec, result: CypressCommandLine.RunResult) {
  debugEvents("Handling after:spec %s", spec.relative);
  const metadata = cypressReporter.onAfterSpec(spec, result);

  if (metadata) {
    const tests = metadata.test.tests;
    const completedTests = tests.filter(t => ["passed", "failed", "timedOut"].includes(t.result));

    if (
      completedTests.length > 0 &&
      tests.flatMap(t => Object.values(t.events).flat()).length === 0
    ) {
      missingSteps = true;
    }
  }
}

function onReplayTask(value: any) {
  debugTask("Handling %s task", TASK_NAME);
  if (!Array.isArray(value)) return;

  value.forEach(v => {
    if (isStepEvent(v)) {
      debugTask("Forwarding event to reporter: %o", v);
      cypressReporter.addStep(v);
    } else {
      debugTask("Unexpected %s payload: %o", TASK_NAME, v);
    }
  });

  return true;
}

const plugin: Cypress.PluginConfig = (on, config) => {
  cypressReporter = new CypressReporter(config, debug);

  const _on = (base: Cypress.PluginEvents): Cypress.PluginEvents => {
    const handlers: any = {};

    const singleHandlerEvents = {
      "after:screenshot": false,
      "file:preprocessor": false,
      "dev-server:start": false,
    };

    const makeHandlerDispatcher =
      (e: string) =>
      async (...args: any[]) => {
        if (e === "before:browser:launch") {
          let [browser, launchOptions] = args;
          for (const currentHandler of handlers[e]) {
            launchOptions = (await currentHandler(browser, launchOptions)) ?? launchOptions;
          }

          return launchOptions;
        } else {
          for (const currentHandler of handlers[e]) {
            await currentHandler(...args);
          }
        }
      };

    return (e, h: any) => {
      if (e === "task") {
        base(e, h);
        return;
      }

      if (Object.keys(singleHandlerEvents).includes(e)) {
        const key = e as keyof typeof singleHandlerEvents;
        if (singleHandlerEvents[key] === true) {
          throw new Error(`Only 1 handler allowed for ${e}`);
        }

        singleHandlerEvents[key] = true;
        base(e as any, h);
        return;
      }

      handlers[e] = handlers[e] || [];
      handlers[e].push(h);

      if (handlers[e].length === 1) {
        base(e as any, makeHandlerDispatcher(e));
      }
    };
  };

  on = _on(on);

  if (!cypressReporter.isFeatureEnabled(PluginFeature.Metrics)) {
    process.env.RECORD_REPLAY_TEST_METRICS = "0";
  }

  if (
    cypressReporter.isFeatureEnabled(PluginFeature.Plugin) ||
    cypressReporter.isFeatureEnabled(PluginFeature.Metrics)
  ) {
    on("after:spec", onAfterSpec);
  }

  if (
    cypressReporter.isFeatureEnabled(PluginFeature.Plugin) ||
    cypressReporter.isFeatureEnabled(PluginFeature.Support)
  ) {
    on("task", {
      // Events are sent to the plugin by the support adapter which runs in the
      // browser context and has access to `Cypress` and `cy` methods.
      [TASK_NAME]: onReplayTask,
    });
  }

  if (cypressReporter.isFeatureEnabled(PluginFeature.Plugin)) {
    on("before:run", onBeforeRun);
    on("before:browser:launch", (browser, launchOptions) =>
      onBeforeBrowserLaunch(config, browser, launchOptions)
    );
    on("before:spec", onBeforeSpec);
    on("after:run", onAfterRun);

    // make sure we have a config object with the keys we need to mutate
    config = config || {};
    config.env = config.env || {};
    config.browsers = config.browsers || [];

    if (config.isTextTerminal) {
      config.env.NO_COMMAND_LOG =
        process.env.CYPRESS_NO_COMMAND_LOG ?? config.env.NO_COMMAND_LOG ?? 1;
      debug("Command log enabled? %s", config.env.NO_COMMAND_LOG);
    }

    const chromiumPath = getPlaywrightBrowserPath("chromium");
    if (chromiumPath) {
      debug("Adding chromium to cypress at %s", chromiumPath);
      config.browsers = config.browsers.concat({
        name: "replay-chromium",
        channel: "stable",
        family: "chromium",
        displayName: "Replay",
        version: "91.0",
        path: chromiumPath,
        majorVersion: 91,
        isHeaded: true,
        isHeadless: false,
      });
    } else {
      debug("Chromium not supported on this platform", chromiumPath);
    }

    const firefoxPath = getPlaywrightBrowserPath("firefox");
    if (firefoxPath) {
      debug("Adding firefox to cypress at %s", chromiumPath);
      config.browsers = config.browsers.concat({
        name: "replay-firefox",
        channel: "stable",
        family: "firefox",
        displayName: "Replay",
        version: "91.0",
        path: firefoxPath,
        majorVersion: 91,
        isHeaded: true,
        isHeadless: false,
      });
    } else {
      debug("Firefox not supported on this platform", chromiumPath);
    }
  }

  return config;
};

export function getCypressReporter() {
  return cypressReporter;
}

export default plugin;
export {
  plugin,
  run,
  onBeforeRun,
  onBeforeBrowserLaunch,
  onBeforeSpec,
  onAfterSpec,
  onAfterRun,
  getMetadataFilePath,
  TASK_NAME as REPLAY_TASK_NAME,
};
