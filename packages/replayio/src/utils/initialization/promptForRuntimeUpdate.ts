import { installLatestRelease } from "../installation/installLatestRelease";
import { parseBuildId } from "../installation/parseBuildId";
import { prompt } from "../prompt/prompt";
import { updateCachedPromptData } from "../prompt/updateCachedPromptData";
import { emphasize, highlight } from "../theme";
import { Version } from "./checkForRuntimeUpdate";
import { UpdateCheckResult } from "./types";

const PROMPT_ID = "runtime-update";

export async function promptForRuntimeUpdate(updateCheck: UpdateCheckResult<Version>) {
  const { fromVersion, toVersion } = updateCheck;

  // If the user hasn't installed Replay runtime, they'll have to install it
  // Otherwise let's check for potential updates and ask them (at most) once per day
  let confirmed = fromVersion == null;

  if (fromVersion) {
    const { releaseDate } = parseBuildId(toVersion.buildId);

    console.log("");
    console.log("A new version of Replay is available!");
    console.log("  Release date:", highlight(releaseDate.toLocaleDateString()));
    console.log("  Version:", highlight(toVersion.version));
    console.log("");
    console.log(`Press ${emphasize("[Enter]")} to upgrade`);
    console.log("Press any other key to skip");
    console.log("");

    confirmed = await prompt();
  } else {
    console.log("");
    console.log("In order to record a Replay, you'll have to first install the browser.");
    console.log(`Press any key to continue`);
    console.log("");

    await prompt();
  }

  updateCachedPromptData({
    id: PROMPT_ID,
    metadata: toVersion.buildId,
  });

  if (confirmed) {
    await installLatestRelease();
    console.log("");
  }
}
