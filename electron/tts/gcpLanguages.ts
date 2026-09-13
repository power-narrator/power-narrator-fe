import type { VoiceLanguage } from "./TtsProvider.js";

/**
 * Transcribed from Google's Gemini-TTS documentation, because the API offers no
 * way to discover them: `ListVoicesRequest` takes only a language code, and
 * there is no model-listing RPC. The list drifts whenever Google edits that
 * page, and no Gemini voice is assumed to be unavailable in any of them — the
 * documentation lists voices and languages in separate tables with no coverage
 * matrix, so the assumption that every voice speaks all 87 is unverified.
 */
const GEMINI_GA_LANGUAGE_CODES = [
  "ar-EG",
  "bn-BD",
  "nl-NL",
  "en-IN",
  "en-US",
  "fr-FR",
  "de-DE",
  "hi-IN",
  "id-ID",
  "it-IT",
  "ja-JP",
  "ko-KR",
  "mr-IN",
  "pl-PL",
  "pt-BR",
  "ro-RO",
  "ru-RU",
  "es-ES",
  "ta-IN",
  "te-IN",
  "th-TH",
  "tr-TR",
  "uk-UA",
  "vi-VN",
];

const GEMINI_PREVIEW_LANGUAGE_CODES = [
  "af-ZA",
  "sq-AL",
  "am-ET",
  "ar-001",
  "hy-AM",
  "az-AZ",
  "eu-ES",
  "be-BY",
  "bg-BG",
  "my-MM",
  "ca-ES",
  "ceb-PH",
  "cmn-CN",
  "cmn-TW",
  "hr-HR",
  "cs-CZ",
  "da-DK",
  "en-AU",
  "en-GB",
  "et-EE",
  "fil-PH",
  "fi-FI",
  "fr-CA",
  "gl-ES",
  "ka-GE",
  "el-GR",
  "gu-IN",
  "ht-HT",
  "he-IL",
  "hu-HU",
  "is-IS",
  "jv-JV",
  "kn-IN",
  "kok-IN",
  "lo-LA",
  "la-VA",
  "lv-LV",
  "lt-LT",
  "lb-LU",
  "mk-MK",
  "mai-IN",
  "mg-MG",
  "ms-MY",
  "ml-IN",
  "mn-MN",
  "ne-NP",
  "nb-NO",
  "nn-NO",
  "or-IN",
  "ps-AF",
  "fa-IR",
  "pt-PT",
  "pa-IN",
  "sr-RS",
  "sd-IN",
  "si-LK",
  "sk-SK",
  "sl-SI",
  "es-419",
  "es-MX",
  "sw-KE",
  "sv-SE",
  "ur-PK",
];

/**
 * A label is the locale itself, so the app never renames what a provider
 * published; the preview marker is the one thing added to it.
 */
function toLanguages(codes: string[], suffix = ""): VoiceLanguage[] {
  return codes.map((code) => ({ code, label: `${code}${suffix}` }));
}

/** Generally available languages first, so a preview choice is never the obvious one. */
export const GEMINI_LANGUAGES: VoiceLanguage[] = [
  ...toLanguages(GEMINI_GA_LANGUAGE_CODES),
  ...toLanguages(GEMINI_PREVIEW_LANGUAGE_CODES, " (Preview)"),
];
