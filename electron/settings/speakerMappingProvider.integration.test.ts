import { beforeEach, expect, it, vi } from "vitest";
import { GcpTtsProvider } from "../tts/GcpTtsProvider.js";
import { migrateSpeakerMappings } from "./speakerMappingMigration.js";

const { synthesizeSpeech } = vi.hoisted(() => ({
  synthesizeSpeech: vi.fn<
    (request: { voice?: unknown }) => Promise<[{ audioContent: Uint8Array }]>
  >(() => Promise.resolve([{ audioContent: new Uint8Array([1, 2, 3]) }])),
}));

vi.mock("@google-cloud/text-to-speech", () => ({
  TextToSpeechClient: class {
    synthesizeSpeech = synthesizeSpeech;
  },
}));

beforeEach(() => {
  synthesizeSpeech.mockClear();
});

it("narrates a migrated mapping with the provider identifier it used before", async () => {
  const legacyName = "en-US-Chirp3-HD-Charon";
  const migrated = migrateSpeakerMappings({
    Narrator: { name: legacyName, languageCodes: ["en-US"], ssmlGender: "MALE", provider: "gcp" },
  });

  await new GcpTtsProvider(() => "/keys/gcp.json")
    .prepareSpeech("Hello", migrated.Narrator!.voice!)
    .synthesize();

  expect(synthesizeSpeech.mock.calls[0]?.[0].voice).toEqual({
    languageCode: "en-US",
    name: legacyName,
  });
});
