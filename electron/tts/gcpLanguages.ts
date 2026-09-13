import type { VoiceLanguage } from "./TtsProvider.js";

/**
 * Transcribed from Google's Gemini-TTS documentation, because the API offers no
 * way to discover them: `ListVoicesRequest` takes only a language code, and
 * there is no model-listing RPC. The list drifts whenever Google edits that
 * page, and no Gemini voice is assumed to be unavailable in any of them — the
 * documentation lists voices and languages in separate tables with no coverage
 * matrix, so the assumption that every voice speaks all 87 is unverified.
 */
const GEMINI_GA_LANGUAGE_NAMES: Record<string, string> = {
  "ar-EG": "Arabic (Egypt)",
  "bn-BD": "Bangla (Bangladesh)",
  "nl-NL": "Dutch (Netherlands)",
  "en-IN": "English (India)",
  "en-US": "English (United States)",
  "fr-FR": "French (France)",
  "de-DE": "German (Germany)",
  "hi-IN": "Hindi (India)",
  "id-ID": "Indonesian (Indonesia)",
  "it-IT": "Italian (Italy)",
  "ja-JP": "Japanese (Japan)",
  "ko-KR": "Korean (South Korea)",
  "mr-IN": "Marathi (India)",
  "pl-PL": "Polish (Poland)",
  "pt-BR": "Portuguese (Brazil)",
  "ro-RO": "Romanian (Romania)",
  "ru-RU": "Russian (Russia)",
  "es-ES": "Spanish (Spain)",
  "ta-IN": "Tamil (India)",
  "te-IN": "Telugu (India)",
  "th-TH": "Thai (Thailand)",
  "tr-TR": "Turkish (Turkey)",
  "uk-UA": "Ukrainian (Ukraine)",
  "vi-VN": "Vietnamese (Vietnam)",
};

const GEMINI_PREVIEW_LANGUAGE_NAMES: Record<string, string> = {
  "af-ZA": "Afrikaans",
  "sq-AL": "Albanian",
  "am-ET": "Amharic",
  "ar-001": "Arabic (World)",
  "hy-AM": "Armenian",
  "az-AZ": "Azerbaijani",
  "eu-ES": "Basque",
  "be-BY": "Belarusian",
  "bg-BG": "Bulgarian",
  "my-MM": "Burmese",
  "ca-ES": "Catalan",
  "ceb-PH": "Cebuano",
  "cmn-CN": "Chinese Mandarin (China)",
  "cmn-TW": "Chinese Mandarin (Taiwan)",
  "hr-HR": "Croatian",
  "cs-CZ": "Czech",
  "da-DK": "Danish",
  "en-AU": "English (Australia)",
  "en-GB": "English (United Kingdom)",
  "et-EE": "Estonian",
  "fil-PH": "Filipino",
  "fi-FI": "Finnish",
  "fr-CA": "French (Canada)",
  "gl-ES": "Galician",
  "ka-GE": "Georgian",
  "el-GR": "Greek",
  "gu-IN": "Gujarati",
  "ht-HT": "Haitian Creole",
  "he-IL": "Hebrew",
  "hu-HU": "Hungarian",
  "is-IS": "Icelandic",
  "jv-JV": "Javanese",
  "kn-IN": "Kannada",
  "kok-IN": "Konkani",
  "lo-LA": "Lao",
  "la-VA": "Latin",
  "lv-LV": "Latvian",
  "lt-LT": "Lithuanian",
  "lb-LU": "Luxembourgish",
  "mk-MK": "Macedonian",
  "mai-IN": "Maithili",
  "mg-MG": "Malagasy",
  "ms-MY": "Malay",
  "ml-IN": "Malayalam",
  "mn-MN": "Mongolian",
  "ne-NP": "Nepali",
  "nb-NO": "Norwegian Bokmal",
  "nn-NO": "Norwegian Nynorsk",
  "or-IN": "Odia",
  "ps-AF": "Pashto",
  "fa-IR": "Persian",
  "pt-PT": "Portuguese (Portugal)",
  "pa-IN": "Punjabi",
  "sr-RS": "Serbian",
  "sd-IN": "Sindhi",
  "si-LK": "Sinhala",
  "sk-SK": "Slovak",
  "sl-SI": "Slovenian",
  "es-419": "Spanish (Latin America)",
  "es-MX": "Spanish (Mexico)",
  "sw-KE": "Swahili",
  "sv-SE": "Swedish",
  "ur-PK": "Urdu",
};

/** Names every language this provider can label, whichever model speaks it. */
const LANGUAGE_NAMES: Record<string, string> = {
  ...GEMINI_GA_LANGUAGE_NAMES,
  ...GEMINI_PREVIEW_LANGUAGE_NAMES,
};

function toLanguages(names: Record<string, string>, suffix = ""): VoiceLanguage[] {
  return Object.entries(names).map(([code, name]) => ({
    code,
    label: `${name}${suffix}`,
  }));
}

/** Generally available languages first, so a preview choice is never the obvious one. */
export const GEMINI_LANGUAGES: VoiceLanguage[] = [
  ...toLanguages(GEMINI_GA_LANGUAGE_NAMES),
  ...toLanguages(GEMINI_PREVIEW_LANGUAGE_NAMES, " (Preview)"),
];

/** Falls back to the code itself, so an unlisted language is still selectable. */
export function toCatalogueLanguage(code: string): VoiceLanguage {
  return { code, label: LANGUAGE_NAMES[code] ?? code };
}
