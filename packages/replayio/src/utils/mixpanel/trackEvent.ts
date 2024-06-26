import { STATUS_PENDING, createDeferred } from "@replay-cli/shared/async/createDeferred";
import { debug } from "./debug";
import { getMixpanelAPI } from "./getMixpanelAPI";
import { addPendingEvent, removePendingEvent } from "./pendingEvents";
import { defaultProperties, deferredSession } from "./session";
import { EventProperties, MixpanelAPI } from "./types";

export function trackEvent(eventName: string, properties: EventProperties = {}) {
  const mixpanelAPI = getMixpanelAPI();
  if (!mixpanelAPI) {
    return;
  }

  if (!eventName.startsWith("replayio.")) {
    eventName = `replayio.${eventName}`;
  }

  debug(`trackEvent: "${eventName}" %j`, properties);

  // This method does not await the deferred/promise
  // because it is meant to be used in a fire-and-forget manner
  // The application will wait for all pending events to be resolved before exiting
  trackEventImplementation(mixpanelAPI, eventName, properties);
}

async function trackEventImplementation(
  mixpanelAPI: MixpanelAPI,
  eventName: string,
  properties: EventProperties
) {
  const deferredEvent = createDeferred<boolean, string>(eventName);

  addPendingEvent(deferredEvent.promise);

  // Wait until user auth completed before tracking events
  if (deferredSession.status === STATUS_PENDING) {
    await deferredSession.promise;
  }

  mixpanelAPI.track(
    eventName,
    {
      ...properties,
      ...defaultProperties,
    },
    (error: any) => {
      if (error) {
        debug(`trackEvent: "${eventName}" -> failed: %j`, error);
      } else {
        debug(`trackEvent: "${eventName}" -> success`);
      }

      deferredEvent.resolve(!error);

      removePendingEvent(deferredEvent.promise);
    }
  );
}
