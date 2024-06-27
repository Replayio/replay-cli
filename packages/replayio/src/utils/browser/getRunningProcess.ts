import { logger } from "@replay-cli/shared/logger";
import findProcess from "find-process";
import { highlight } from "../theme";
import { getBrowserPath } from "./getBrowserPath";

export async function getRunningProcess() {
  const browserExecutablePath = getBrowserPath();

  const processes = await findProcess("name", browserExecutablePath);
  if (processes.length > 0) {
    const match = processes[0];

    logger.debug(`Browser process already running at ${highlight(match.pid)}`);

    return match;
  }

  return null;
}
