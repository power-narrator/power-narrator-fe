import { describe, expect, it } from "vitest";
import { migrateSpeakerMappings } from "./speakerMappingMigration.js";

const legacyMappings = {
  _default_: {
    name: "en-US-Chirp3-HD-Aoede",
    languageCodes: ["en-US"],
    ssmlGender: "FEMALE",
    provider: "gcp",
  },
  Narrator: {
    name: "en-GB-Chirp3-HD-Puck",
    languageCodes: ["en-GB"],
    ssmlGender: "MALE",
    provider: "gcp",
  },
};

describe("migrateSpeakerMappings", () => {
  it("parses a legacy provider voice name rather than copying it across", () => {
    expect(migrateSpeakerMappings(legacyMappings)).toEqual({
      _default_: {
        voice: {
          provider: "gcp",
          voiceId: "Aoede",
          model: "chirp-3-hd",
          languageCode: "en-US",
          supportsPrompt: false,
        },
      },
      Narrator: {
        voice: {
          provider: "gcp",
          voiceId: "Puck",
          model: "chirp-3-hd",
          languageCode: "en-GB",
          supportsPrompt: false,
        },
      },
    });
  });

  it("leaves a converted store untouched when run again", () => {
    const once = migrateSpeakerMappings(legacyMappings);

    expect(migrateSpeakerMappings(once)).toEqual(once);
  });

  it.each([
    ["an empty placeholder", { name: "", languageCodes: [], ssmlGender: "", provider: "gcp" }],
    ["an unresolved placeholder", { name: "default", provider: "gcp" }],
    ["an unregistered provider", { name: "en_UK/apope_low", provider: "local" }],
    ["a malformed record", null],
  ])("leaves the voice unconfigured for %s", (_, record) => {
    expect(migrateSpeakerMappings({ Narrator: record })).toEqual({ Narrator: {} });
  });

  it("passes an already-converted mapping through with its prompt", () => {
    expect(migrateSpeakerMappings({ Narrator: { voice: undefined, prompt: "Whisper" } })).toEqual({
      Narrator: { voice: undefined, prompt: "Whisper" },
    });
  });

  it.each([undefined, null, "not an object"])("tolerates a missing store value (%j)", (stored) => {
    expect(migrateSpeakerMappings(stored)).toEqual({});
  });
});
