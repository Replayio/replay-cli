export enum RECORDING_LOG_KIND {
  addMetadata = "addMetadata",
  crashData = "crashData",
  crashed = "crashed",
  crashUploaded = "crashUploaded",
  createRecording = "createRecording",
  originalSourceAdded = "originalSourceAdded",
  recordingUnusable = "recordingUnusable",
  sourcemapAdded = "sourcemapAdded",
  uploadFailed = "uploadFailed",
  uploadFinished = "uploadFinished",
  uploadStarted = "uploadStarted",
  writeFinished = "writeFinished",
  writeStarted = "writeStarted",
}

export type ProcessType = "devtools" | "extension" | "iframe" | "root";

export type UnstructuredMetadata = Record<string, unknown>;

// This data primarily comes from the runtime
// The CLI adds some entries as well, based on upload status
export type LogEntry = {
  buildId?: string;
  data?: any;
  driverVersion?: string;
  id: string;
  kind: RECORDING_LOG_KIND;
  metadata?: {
    argv?: string[];
    process?: ProcessType;
    processGroupId?: string;
    uri?: string;
    [key: string]: unknown;
  };
  path?: string;
  recordingId?: string;
  server?: string;
  timestamp: number;
  baseURL?: string;
  targetContentHash?: string;
  targetURLHash?: string;
  targetMapURLHash?: string;
  parentId?: string;
  parentOffset?: number;
};

export type OriginalSource = {
  path: string;
  parentOffset: number;
};

export type SourceMap = {
  id: string;
  path: string;
  baseURL: string;
  targetContentHash?: string;
  targetURLHash?: string;
  targetMapURLHash: string;
  originalSources: OriginalSource[];
};

export type LocalRecording = {
  buildId: string;
  crashData: any[] | undefined;
  date: Date;
  driverVersion: string;
  duration: number | undefined;
  id: string;
  metadata: {
    host: string | undefined;
    processGroupId: string | undefined;
    processType: ProcessType | undefined;
    sourcemaps: SourceMap[];
    uri: string | undefined;
    [key: string]: unknown;
  };
  path: string | undefined;
  recordingStatus: "crashed" | "finished" | "recording" | "unusable";
  uploadStatus: "failed" | "uploading" | "uploaded" | undefined;
};
