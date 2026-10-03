// UI localization: zh/en dictionaries plus a persisted locale store.
import { create } from "zustand";

export type Locale = "zh" | "en";

const STORAGE_KEY = "echosmith-locale";

const zh = {
  appSubtitle: "本地媒体下载、转写、纠错与导出中心",
  switchToLight: "切换浅色模式",
  switchToDark: "切换深色模式",
  switchLanguage: "Switch to English",
  languageButton: "EN",
  openSettings: "打开设置",
  settings: "设置",
  tabBatch: "本地批量",
  tabUrl: "在线视频",

  status: {
    queued: "排队中",
    running: "进行中",
    paused: "暂停中",
    completed: "已完成",
    failed: "失败",
    cancelled: "已停止",
  } as Record<string, string>,

  resume: "继续",
  pause: "暂停",
  remove: "移除",

  // Transcript panels
  waitingTask: "等待任务",
  recognitionFailed: "识别失败",
  transcribing: "转写中",
  rawTitle: "ASR 原文",
  rawSubtitle: "本地识别结果，未经大模型纠错",
  rawEmptyWithTask: "原文会随着转写进度显示在这里。",
  selectOrCreateTask: "在左侧添加文件或粘贴链接开始转写；点左侧列表中的一项查看它的结果。",
  notEnabled: "未启用",
  correctionDone: "智能纠错完成",
  correcting: "智能纠错中",
  waitingCorrection: "等待纠错开始",
  correctedTitle: "智能纠错结果",
  correctedSubtitleOn: "大模型纠错文本，边转写边流式输出",
  correctedSubtitleOff: "未配置 API Key，导出将使用 ASR 原文",
  correctionDisabledHint: "未启用智能纠错。在「设置」中配置大模型 API Key 后，这里会显示纠错结果。",
  correctedEmpty: "纠错结果会显示在这里。",
  correctedPending: "转写进行中，纠错结果会随批次完成逐步显示。",
  copied: "已复制",
  copy: "复制",

  // Batch composer
  unsupportedFormat: "不支持的文件格式，请选择音视频文件",
  batchTitle: "本地媒体批量处理",
  batchSubtitle: "选择多个音视频文件，自动转写并保存到源文件目录",
  dropToAdd: "松开以添加文件",
  clickOrDrag: "点击选择或拖拽文件到此处",
  supportedFormats: "支持 MP3 / WAV / M4A / MP4 / MOV 等常见格式",
  allDone: "全部完成",
  resumeBatch: (n: number) => `继续转写 (剩余 ${n} 个文件)`,
  startBatch: (n: number) => `开始转写 (${n} 个文件)`,

  // URL composer
  platformWaiting: "等待链接",
  platformWaitingHint: "支持粘贴完整分享文本",
  platformBilibiliHint: "已启用 B 站请求头、超时和重试策略",
  platformYoutubeHint: "如需登录视频，请先在浏览器登录",
  platformDouyin: "抖音",
  platformDouyinHint: "会自动解析分享文本中的短链接",
  platformXHint: "公开媒体可直接下载，受限媒体需要登录状态",
  platformGeneric: "通用视频链接",
  platformGenericHint: "由 yt-dlp 自动识别平台",
  preparingDownload: "准备下载…",
  savedToDownloads: (name: string) => `已保存到 Downloads 目录：${name}`,
  urlTitle: "在线视频采集",
  urlSubtitle: "粘贴视频链接，自动下载音频并转写为文字",
  videoLink: "视频链接",
  urlPlaceholder: "粘贴视频链接或分享文本…",
  pasteFromClipboard: "从剪贴板粘贴",
  creatingTaskHint: "正在创建任务，请在右侧面板查看进度…",
  creating: "创建中…",
  startTranscription: "开始转写",
  downloadVideo: "下载视频",
  downloadAudio: "下载音频",
  createTaskFailed: "创建任务失败",
  downloadFailed: "下载失败",

  // Settings
  correctionOff: "纠错已关闭",
  correctionOn: "纠错已开启",
  needApiKey: "需要配置 API Key",
  appearance: "外观",
  language: "语言",
  themeLight: "浅色",
  themeDark: "深色",
  themeSystem: "系统",
  correctionMode: "纠错模式",
  modeNone: "关闭",
  modeNoneDesc: "不进行纠错，直接输出转写结果",
  modeCloud: "云端 API 纠错",
  modeCloudDesc: "调用 OpenAI / Anthropic / DeepSeek 等大模型纠错",
  cloudConfig: "云端 API 配置",
  provider: "服务商",
  providerDoubao: "豆包（火山引擎）",
  providerCustom: "自定义",
  apiKeySetPlaceholder: "已设置（输入新值覆盖）",
  apiKeyPlaceholder: "输入 API Key",
  modelName: "模型名称",
  saving: "保存中…",
  saved: "已保存",
  apiUsage: "API 调用统计",
  resetUsage: "重置统计",
  reset: "重置",
  totalCalls: "总调用次数",
  correctedSegments: "纠错段数",
  failedCalls: "失败次数",
  hotwords: "热词表",
  hotwordsDesc: "导入文本文件，每行一个词。纠错时优先使用这些词汇。",
  importHotwords: "导入热词文件",
  hotwordsLoaded: (n: number) => `已加载 ${n} 个热词`,
  hotwordsFormatHint: "支持 .txt 文件，每行一个词，或用逗号分隔",
  hotwordsOverBudget: (n: number) => `热词表总长度超过上限，纠错时只使用前 ${n} 个；请删减不常用的词。`,
  hotwordsNeedCorrection: "热词在智能纠错时生效；当前纠错已关闭，热词不会起作用。",

  // Output area & saving
  outputTitle: "转写结果",
  resizeHint: "拖动调整宽度，双击恢复默认",
  hideCorrection: "关闭智能纠错栏",
  showCorrection: "显示智能纠错栏",
  downloading: "下载中",
  close: "关闭",
  exportFailed: "导出失败",
  correctionOffForTask: "此任务未开启智能纠错。在「设置」中配置大模型 API Key 后，新任务会边转写边纠错。",
  correctionFailedBatches: (n: number) => `${n} 批纠错失败，已保留原文`,
  stopBatch: "停止",
  clearList: "清空列表",
  exportErrorPrefix: "自动保存失败：",
  defaultSave: "默认保存",
  defaultSaveHint: "点亮的格式会在任务完成后自动保存：本地文件存到源文件旁，在线视频存到「下载」文件夹。可多选，至少保留一种。",
  saveNow: "保存",
  savedFiles: (names: string) => `已保存：${names}`,
  keepOneFormat: "至少保留一种格式",
  clearKey: "清除 Key",

  // Error boundary
  appCrashed: "应用出错了",
  errorMessage: "错误信息：",
  reload: "重新加载",
};

export type Messages = typeof zh;

const en: Messages = {
  appSubtitle: "Local media download, transcription, correction & export",
  switchToLight: "Switch to light mode",
  switchToDark: "Switch to dark mode",
  switchLanguage: "切换为中文",
  languageButton: "中",
  openSettings: "Open settings",
  settings: "Settings",
  tabBatch: "Local Files",
  tabUrl: "Online Video",

  status: {
    queued: "Queued",
    running: "Running",
    paused: "Paused",
    completed: "Completed",
    failed: "Failed",
    cancelled: "Stopped",
  },

  resume: "Resume",
  pause: "Pause",
  remove: "Remove",

  waitingTask: "No task",
  recognitionFailed: "Recognition failed",
  transcribing: "Transcribing",
  rawTitle: "ASR Transcript",
  rawSubtitle: "Local recognition output, not corrected by LLM",
  rawEmptyWithTask: "The transcript will appear here as transcription progresses.",
  selectOrCreateTask: "Add files or paste a link on the left to start; click an item in the list to view its result.",
  notEnabled: "Disabled",
  correctionDone: "Correction complete",
  correcting: "Correcting",
  waitingCorrection: "Waiting for correction",
  correctedTitle: "Corrected Transcript",
  correctedSubtitleOn: "LLM-corrected text, streamed while transcribing",
  correctedSubtitleOff: "No API key configured; exports use the ASR transcript",
  correctionDisabledHint: "Smart correction is off. Configure an LLM API key in Settings to see corrected text here.",
  correctedEmpty: "Corrected text will appear here.",
  correctedPending: "Transcribing; corrected text will appear batch by batch.",
  copied: "Copied",
  copy: "Copy",

  unsupportedFormat: "Unsupported file format, please choose audio or video files",
  batchTitle: "Batch Local Media",
  batchSubtitle: "Pick multiple audio/video files; transcripts are saved next to the source files",
  dropToAdd: "Release to add files",
  clickOrDrag: "Click to choose or drag files here",
  supportedFormats: "Supports MP3 / WAV / M4A / MP4 / MOV and more",
  allDone: "All Done",
  resumeBatch: (n) => `Resume (${n} file${n === 1 ? "" : "s"} left)`,
  startBatch: (n) => `Start Transcription (${n} file${n === 1 ? "" : "s"})`,

  platformWaiting: "Waiting for link",
  platformWaitingHint: "You can paste the full share text",
  platformBilibiliHint: "Bilibili headers, timeouts and retries enabled",
  platformYoutubeHint: "For sign-in-only videos, log in with your browser first",
  platformDouyin: "Douyin",
  platformDouyinHint: "Short links in share text are resolved automatically",
  platformXHint: "Public media downloads directly; restricted media needs a login",
  platformGeneric: "Generic video link",
  platformGenericHint: "Platform detected automatically by yt-dlp",
  preparingDownload: "Preparing download…",
  savedToDownloads: (name) => `Saved to Downloads: ${name}`,
  urlTitle: "Online Video",
  urlSubtitle: "Paste a video link to download its audio and transcribe it",
  videoLink: "Video Link",
  urlPlaceholder: "Paste a video link or share text…",
  pasteFromClipboard: "Paste from clipboard",
  creatingTaskHint: "Creating task, check progress in the right panel…",
  creating: "Creating…",
  startTranscription: "Start Transcription",
  downloadVideo: "Download Video",
  downloadAudio: "Download Audio",
  createTaskFailed: "Failed to create task",
  downloadFailed: "Download failed",

  correctionOff: "Correction is off",
  correctionOn: "Correction is on",
  needApiKey: "API key required",
  appearance: "Appearance",
  language: "Language",
  themeLight: "Light",
  themeDark: "Dark",
  themeSystem: "System",
  correctionMode: "Correction Mode",
  modeNone: "Off",
  modeNoneDesc: "No correction; output the raw transcript",
  modeCloud: "Cloud API Correction",
  modeCloudDesc: "Correct with LLMs such as OpenAI / Anthropic / DeepSeek",
  cloudConfig: "Cloud API Settings",
  provider: "Provider",
  providerDoubao: "Doubao (Volcengine)",
  providerCustom: "Custom",
  apiKeySetPlaceholder: "Already set (enter a new value to replace)",
  apiKeyPlaceholder: "Enter API key",
  modelName: "Model",
  saving: "Saving…",
  saved: "Saved",
  apiUsage: "API Usage",
  resetUsage: "Reset usage",
  reset: "Reset",
  totalCalls: "Total calls",
  correctedSegments: "Segments corrected",
  failedCalls: "Failed calls",
  hotwords: "Hotwords",
  hotwordsDesc: "Import a text file with one term per line. Correction prefers these terms.",
  importHotwords: "Import Hotwords",
  hotwordsLoaded: (n) => `${n} hotword${n === 1 ? "" : "s"} loaded`,
  hotwordsFormatHint: "Supports .txt files, one term per line or comma-separated",
  hotwordsOverBudget: (n) => `The list is longer than the limit; correction uses only the first ${n} terms. Remove rarely used ones.`,
  hotwordsNeedCorrection: "Hotwords are used by smart correction; correction is off, so they have no effect now.",

  outputTitle: "Transcript",
  resizeHint: "Drag to resize, double-click to reset",
  hideCorrection: "Close the correction panel",
  showCorrection: "Show the correction panel",
  downloading: "Downloading",
  close: "Close",
  exportFailed: "Export failed",
  correctionOffForTask: "Smart correction was off for this task. Add an LLM API key in Settings and new tasks are corrected while they transcribe.",
  correctionFailedBatches: (n) => `${n} correction batch${n === 1 ? "" : "es"} failed; raw text kept`,
  stopBatch: "Stop",
  clearList: "Clear list",
  exportErrorPrefix: "Auto-save failed: ",
  defaultSave: "Save as",
  defaultSaveHint: "Lit formats are saved automatically when a task finishes: next to the source file, or to Downloads for online videos. Pick any combination; at least one stays on.",
  saveNow: "Save",
  savedFiles: (names) => `Saved: ${names}`,
  keepOneFormat: "Keep at least one format",
  clearKey: "Clear key",

  appCrashed: "Something went wrong",
  errorMessage: "Error: ",
  reload: "Reload",
};

const MESSAGES: Record<Locale, Messages> = { zh, en };

// Backend progress messages are emitted in Chinese; translate known phrases
// for display only (CorrectedPanel still matches the raw "纠错" substring).
// ponytail: phrase table, move to backend message codes if phrases multiply.
const BACKEND_PHRASES: Array<[string, string]> = [
  ["批纠错失败，已保留原文", " correction batches failed; raw text kept"],
  ["智能纠错收尾中", "Finishing correction"],
  ["智能纠错中", "Correcting"],
  ["需要认证，尝试读取浏览器登录状态", "Auth required, reading browser login"],
  ["下载完成，提取音频中", "Downloaded, extracting audio"],
  ["解析抖音链接", "Resolving Douyin link"],
  ["下载抖音视频", "Downloading Douyin video"],
  ["合并/转码中", "Merging/transcoding"],
  ["模型加载中", "Loading model"],
  ["模型已加载", "Model loaded"],
  ["语音检测中", "Detecting speech"],
  ["准备音频", "Preparing audio"],
  ["读取音频", "Reading audio"],
  ["提取音频", "Extracting audio"],
  ["下载完成", "Download complete"],
  ["转写完成", "Transcription complete"],
  ["恢复处理", "Resuming"],
  ["转码中", "Transcoding"],
  ["转写中", "Transcribing"],
  ["下载中", "Downloading"],
  ["准备中", "Preparing"],
  ["排队中", "Queued"],
  ["已暂停", "Paused"],
  ["已取消", "Cancelled"],
  ["完成", "Done"],
  ["失败", "Failed"],
  ["模型", "Model "],
];

export function localizeBackendMessage(message: string, locale: Locale): string {
  if (locale === "zh") return message;
  return BACKEND_PHRASES.reduce((text, [from, to]) => text.split(from).join(to), message);
}

function readStoredLocale(): Locale {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "en" ? "en" : "zh";
  } catch {
    return "zh";
  }
}

interface LocaleState {
  locale: Locale;
  setLocale(locale: Locale): void;
}

export const useLocaleStore = create<LocaleState>((set) => ({
  locale: readStoredLocale(),
  setLocale: (locale) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      // Storage unavailable; keep the in-memory choice.
    }
    set({ locale });
  },
}));

export function useT(): Messages {
  return MESSAGES[useLocaleStore((state) => state.locale)];
}

export function getMessages(): Messages {
  return MESSAGES[useLocaleStore.getState().locale];
}
