/**
 * Types for the Reviral Media API v1.
 * Hand-written from https://reviral.ai/openapi.json (info.version 1.0.0).
 * The API may add optional fields, models and enum values within v1, so
 * response types keep an index signature where the contract allows extras.
 */

export type JobStatus = "queued" | "running" | "ready" | "failed";
export type MediaKind = "video" | "image";

// ---------- models ----------

export interface DurationRange { kind: "range"; min: number; max: number }
export interface DurationEnum { kind: "enum"; values: number[] }

export interface CreditPrice {
  perSecond?: number;
  creditsAtDefaultDuration?: number;
  perVideo?: number;
  perImage?: number;
  byDuration?: Record<string, number>;
  [extra: string]: unknown;
}

export interface ModelReferences {
  images: { max: number };
  videos: { max: number; maxSeconds: number | null; maxBytes: number };
  audio: { max: number; maxBytes: number; needsVisual: boolean };
}

export interface ModelDefaults {
  durationSec?: number;
  resolution: string;
  aspectRatio: string;
  count?: number;
}

export interface Model {
  id: string;
  kind: MediaKind;
  label: string;
  family: string;
  maker: string;
  billing: "per_second" | "per_request";
  durations: DurationRange | DurationEnum;
  resolutions: string[];
  aspects: string[];
  /** Keyed by resolution. */
  credits: Record<string, CreditPrice>;
  references: ModelReferences;
  defaults: ModelDefaults;
  [extra: string]: unknown;
}

// ---------- generate-media / jobs ----------

export interface GenerateMediaRequest {
  /** Model id from GET /api/v1/models. */
  model: string;
  /** 1 to 100,000 characters. Reference uploads as @image1, @video1, @audio1. */
  prompt: string;
  durationSec?: number;
  resolution?: string;
  aspectRatio?: string;
  generateAudio?: boolean;
  referenceImageUrls?: string[];
  referenceVideoUrls?: string[];
  referenceAudioUrls?: string[];
  size?: string;
  /** Images only, 1-4. Multiplies the per-image charge. */
  count?: number;
  /**
   * Price lock. Must EQUAL the live charge: any difference returns
   * 409 price_changed without starting the job. It is not a ceiling.
   */
  maxCredits?: number;
  /** HTTPS URL that receives one best-effort terminal callback. */
  webhookUrl?: string;
}

export interface AcceptedJob {
  jobId: string;
  kind: MediaKind;
  model: string;
  creditsCharged: number;
  status: JobStatus;
  /** Present when an idempotent replay returns a job that already failed. */
  error?: string;
  /** Relative path, e.g. /api/v1/jobs/<jobId>. */
  statusUrl: string;
  [extra: string]: unknown;
}

export interface Job {
  jobId: string;
  kind: string;
  /** Public model requested at submission. Never changes. */
  model: string;
  /** Model of the last clip. */
  modelUsed: string;
  /** Index-aligned per-clip model identity. */
  modelsUsed: string[];
  fallbackFired: boolean;
  status: JobStatus;
  /** Ready video. Signed and expiring: download promptly. */
  outputUrl?: string;
  /** Ready image job. Signed and expiring: download promptly. */
  outputUrls?: string[];
  /** True when a video is ready but its signed delivery URL is not yet available. */
  outputPending?: boolean;
  durationSec?: number;
  /** Net charge after refunds. */
  creditsCharged: number;
  error?: string;
  [extra: string]: unknown;
}

// ---------- uploads ----------

export type UploadKind = "image" | "video" | "audio";

export interface ProductPhotoUpload {
  id: string;
  url: string;
  kind: "product_photo";
  width: number;
  height: number;
  bytes: number;
}

export interface SignedUploadRequest {
  kind: UploadKind;
  contentType: "image/jpeg" | "image/png" | "image/webp" | "video/mp4" | "audio/mpeg" | "audio/wav";
  /** 1 to 67,108,864 bytes. */
  bytes: number;
  filename: string;
}

export interface SignedUpload {
  id: string;
  uploadUrl: string;
  method: "PUT";
  headers: Record<string, string>;
  expiresInSec: number;
}

export interface VerifiedUpload {
  id: string;
  /** The only URL that may be used as a reference. */
  url: string;
  kind: UploadKind;
  bytes: number;
  width?: number;
  height?: number;
  durationSec?: number;
}

// ---------- image ads ----------

export interface ImageAdProduct {
  title: string;
  bullets: string[];
  price: string;
  /** HTTPS URLs returned by POST /api/v1/uploads. */
  photos: string[];
  rating: number;
  reviewCount?: number;
  reviews: string[];
  brand: string;
}

export interface ImageAdBrand {
  /** #RRGGBB values. */
  colors: string[];
  fonts: string[];
  voice: string[];
  neverSay: string[];
  logoUrl: string | null;
}

export type ImageAdLanguage =
  | "en" | "zh-CN" | "ja" | "ko" | "th" | "vi" | "ar" | "fa" | "he" | "hi" | "ru"
  | "uk" | "el" | "tr" | "es" | "pt" | "fr" | "de" | "it" | "ms" | "id";

export interface ImageAdRequest {
  templateId: string;
  sizeId?: string;
  product: ImageAdProduct;
  brand: ImageAdBrand;
  copy: Record<string, string>;
  creative?: Record<string, string>;
  background?: string;
  mood?: string[];
  finish?: string;
  offerAvailable?: boolean;
  language?: ImageAdLanguage;
  /** Price lock: must equal the template's current credits. */
  maxCredits?: number;
  webhookUrl?: string;
}

export interface ImageAdAccepted {
  jobId: string;
  status: JobStatus;
  credits: number;
  error?: string;
  statusUrl: string;
  [extra: string]: unknown;
}

export interface ImageAdTemplateField {
  path: string;
  type: string;
  description: string;
  example: unknown;
}

export interface ImageAdTemplate {
  id: string;
  name: string;
  category: string;
  requiredFields: string[];
  constraints: Record<string, { minItems: number }>;
  fields: ImageAdTemplateField[];
  examplePictureUrl: string;
  credits: number;
  [extra: string]: unknown;
}

// ---------- UGC ads ----------

export interface UgcAdRequest {
  /** id returned by POST /api/v1/uploads. */
  uploadId: string;
  prompt: string;
  angle: "testimonial" | "unboxing" | "before-after" | "problem-solution" | "founder" | "day-in-life";
  creator: "skincare" | "lifestyle" | "fitness" | "tech";
  scene: "home" | "kitchen" | "cafe" | "desk";
  singleClip?: boolean;
  /** Reference-to-video is the only UGC ad mode. Omit it or set "r2v". */
  mode?: "r2v";
  durationSec?: 15 | 30 | 45 | 60;
  resolution?: "480p" | "720p" | "1080p";
  aspectRatio?: "9:16" | "16:9" | "1:1";
  maxCredits?: number;
  webhookUrl?: string;
}

export interface UgcAdAccepted {
  jobId: string;
  kind: "ugc-ad";
  creditsCharged: number;
  status: JobStatus;
  statusUrl: string;
  [extra: string]: unknown;
}

export interface UgcAdOptions {
  angles: unknown;
  creators: unknown;
  scenes: unknown;
  modes: unknown;
  durationsSec: unknown;
  resolutions: unknown;
  aspectRatios: unknown;
  [extra: string]: unknown;
}

// ---------- full render ----------

export type RenderWorkflow =
  | "prompt-to-video" | "script-to-video" | "article-to-video" | "static-bg-video"
  | "caption-video" | "ad-generator" | "ugc-ad" | "avatar-to-video" | "quiz-video";

export interface MediaItem {
  url: string;
  type?: "image" | "video";
  title?: string;
  urlLowRes?: string;
  imagePreview?: string;
  noReencode?: boolean;
}

export interface RenderRequest {
  workflow: RenderWorkflow;
  prompt?: string;
  userScript?: string;
  articleUrl?: string;
  videoUrl?: string;
  productUrl?: string;
  avatarImageUrl?: string;
  tier?: "base" | "pro" | "ultra";
  durationSec?: number;
  aspectRatio?: "9:16" | "16:9" | "1:1" | "auto";
  presetId?: string;
  language?: string;
  captionStyle?: string;
  captionPosition?: "top" | "middle" | "bottom";
  music?: boolean;
  webhookUrl?: string;
  referenceImageUrls?: string[];
  referenceVideoUrls?: string[];
  referenceAudioUrls?: string[];
  nbGenerations?: number;
  musicUrl?: string;
  voiceId?: string;
  musicTrackId?: string;
  improveConsistency?: boolean;
  continuousMode?: boolean;
  premiumVideoModelId?: string;
  mediaItems?: MediaItem[];
  [extra: string]: unknown;
}

export interface RenderAccepted {
  projectId: string;
  renderJobId: string;
  debited: number;
  balanceBefore: number;
  [extra: string]: unknown;
}

// ---------- credits ----------

export interface RenderCreditsRequest {
  tier?: "base" | "pro" | "ultra";
  mediaType?: "ai-video" | "ai-moving" | "motion-graphics" | "stock-videos" | "user-upload" | "static-images" | "ai-action";
  durationSec?: number;
  presetId?: string;
  nbGenerations?: number;
}
export interface ImageAdCreditsRequest { kind: "image-ad"; templateId: string; sizeId?: string }
export interface UgcAdCreditsRequest {
  kind: "ugc-ad";
  /** Reference-to-video is the only UGC ad mode. Omit it or set "r2v". */
  mode?: "r2v";
  durationSec?: 15 | 30 | 45 | 60;
  resolution?: "480p" | "720p" | "1080p";
  singleClip?: boolean;
}
export type CalculateCreditsRequest = RenderCreditsRequest | ImageAdCreditsRequest | UgcAdCreditsRequest;

// ---------- director / writers / stitch ----------

export interface DirectorSimpleChatRequest {
  message: string;
  chatId?: string;
  model?: string;
  durationSec?: number;
  resolution?: string;
  aspectRatio?: string;
  referenceImageUrls?: string[];
  referenceVideoUrls?: string[];
  referenceAudioUrls?: string[];
}
export interface DirectorPublishedChatRequest {
  messages: { role: "user" | "assistant"; content: string }[];
  cinemaContext: {
    modelId: string;
    durationSec: number;
    resolution?: string;
    aspect?: string;
    references?: { kind: UploadKind; index: number; name: string; token: string }[];
  };
}
export type DirectorChatRequest = DirectorSimpleChatRequest | DirectorPublishedChatRequest;
export interface DirectorChatReply {
  chatId: string;
  reply: string;
  status: "talking" | "prompt_ready";
  prompt?: string;
  plan?: unknown;
  replyId?: string;
  finalPrompt?: string;
  [extra: string]: unknown;
}

export interface ScriptWriterRequest {
  prompt: string;
  durationSec?: number;
  tone?: string;
  scriptFormat?: string;
  mediaType?: string;
  variants?: number;
  wordsOnly?: boolean;
  assetBlocks?: string[];
}
export interface HookWriterRequest { topic: string; clickbait?: 1 | 2 | 3 | 4 | 5 }
export interface PromptBuilderRequest {
  brief: string;
  durationSec: number;
  section1MaxChars: number | null;
  styleId: string;
  effectEnabled: boolean;
  effectId: string | null;
  images: { name: string; mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif"; base64: string }[];
  variationSeed?: string;
  compact?: boolean;
}
export type WriterResult = Record<string, unknown>;

export interface StitchRequest { projectIds: string[] }
export interface StitchAccepted {
  jobId: string;
  kind: "stitch";
  creditsCharged: 0;
  status: "queued" | "ready";
  statusUrl: string;
}

// ---------- account / characters / discover / media search ----------

export interface Account {
  profileId: string;
  email?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  about?: string | null;
  timezone?: string | null;
  topics?: string[];
  plan: string;
  credits: number;
  aiSettings?: Record<string, unknown> | null;
  [extra: string]: unknown;
}

export interface CharacterRequest {
  name: string;
  imageUrl?: string;
  source?: "avatar" | "lora";
  voiceId?: string;
}

export interface DiscoverQuery {
  page?: number;
  limit?: number;
  q?: string;
  tag?: "youtube" | "hackernews" | "wikipedia" | "google_trends" | "tiktok";
}
export interface DiscoverItem {
  id: string;
  title: string;
  source: "youtube" | "hackernews" | "wikipedia" | "google_trends" | "tiktok";
  tags: string[];
  url?: string;
  score?: number;
  traffic?: string;
  imageUrl?: string;
  region?: string;
  video?: {
    platform: "youtube" | "tiktok" | "instagram";
    videoId: string;
    thumbnailUrl: string;
    videoUrl: string;
    viewCount: number;
    likeCount?: number;
    creator?: string;
  };
}
export interface DiscoverPage { items: DiscoverItem[]; page: number; limit: number; total: number }

export interface MediaSearchRequest { query: string; type?: "image" | "video" | "any"; limit?: number }

// ---------- webhooks ----------

export interface WebhookReady {
  ok: true;
  status: "ready";
  jobId: string;
  kind: MediaKind;
  model?: string;
  modelUsed: string;
  fallbackFired: boolean;
  outputUrl?: string;
  outputUrls?: string[];
  durationSec?: number;
  partial?: boolean;
  deliveredCount?: number;
}
export interface WebhookFailed {
  ok: false;
  status: "failed";
  jobId: string;
  modelUsed: string;
  fallbackFired: boolean;
  error: string;
}
export type WebhookPayload = WebhookReady | WebhookFailed;

// ---------- errors ----------

export interface FieldError { field: string; message: string; code: string }

/** Standard v1 error envelope. */
export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: FieldError[];
    /** Current live charge on 409 price_changed, or the needed credits on 402. */
    required?: number;
    balance?: number;
    /** Echoed on 504 so the caller can retry with the same key. */
    idempotencyKey?: string;
  };
  docs: "/docs/api";
}
