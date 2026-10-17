import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { strToU8 } from "fflate";
import { expect, it } from "vitest";
import { inspectPresentation, mediaDigest } from "./presentationInspector.js";
import { buildTestPresentation } from "./testPresentation.js";

const clip = strToU8("clip");

it("tells section audio apart from media whose name only resembles it", () => {
  const presentation = buildTestPresentation([
    {
      shapes: [
        { kind: "audio", id: 2, name: "ppt_audio_1", media: clip },
        { kind: "audio", id: 3, name: "ppt_audio_12", media: clip },
        { kind: "audio", id: 4, name: "ppt_audio_01", media: clip },
        { kind: "audio", id: 5, name: "ppt_audio_0", media: clip },
        { kind: "audio", id: 6, name: "ppt_audio_2 copy", media: clip },
        { kind: "audio", id: 7, name: "PPT_AUDIO_3", media: clip },
        { kind: "video", id: 8, name: "ppt_audio_4", media: clip },
        { kind: "shape", id: 9, name: "ppt_audio_5" },
      ],
    },
  ]);

  const [slide] = inspectPresentation(presentation).slides;

  expect(slide?.sectionAudio.map(({ name }) => name)).toEqual(["ppt_audio_1", "ppt_audio_12"]);
  expect(slide?.otherMedia.map(({ name }) => name)).toEqual([
    "ppt_audio_01",
    "ppt_audio_0",
    "ppt_audio_2 copy",
    "PPT_AUDIO_3",
    "ppt_audio_4",
  ]);
  expect(slide?.otherShapes.map(({ name }) => name)).toEqual([
    "ppt_audio_01",
    "ppt_audio_0",
    "ppt_audio_2 copy",
    "PPT_AUDIO_3",
    "ppt_audio_4",
    "ppt_audio_5",
  ]);
});

it("identifies the clip each section audio plays", () => {
  const first = strToU8("first clip");
  const second = strToU8("second clip");
  const presentation = buildTestPresentation([
    {
      shapes: [
        { kind: "audio", id: 2, name: "ppt_audio_1", media: first },
        { kind: "audio", id: 3, name: "ppt_audio_2", media: second },
      ],
    },
  ]);

  const [slide] = inspectPresentation(presentation).slides;

  expect(slide?.sectionAudio.map(({ media }) => media)).toEqual([
    mediaDigest(first),
    mediaDigest(second),
  ]);
});

it("reads each slide's notes as written, in slide order", () => {
  const presentation = buildTestPresentation([
    { notes: "[Narrator]\nCafé — naïve “quotes” 日本語\n---\nSecond section" },
    {},
    { notes: "Third slide" },
  ]);

  const { slides } = inspectPresentation(presentation);

  expect(slides.map(({ slideNumber, notes }) => ({ slideNumber, notes }))).toEqual([
    { slideNumber: 1, notes: "[Narrator]\nCafé — naïve “quotes” 日本語\n---\nSecond section" },
    { slideNumber: 2, notes: "" },
    { slideNumber: 3, notes: "Third slide" },
  ]);
});

it("reports what identifies a shape that is not section audio, so a moved shape differs", () => {
  const slide = (offset: [number, number]) =>
    inspectPresentation(
      buildTestPresentation([
        { shapes: [{ kind: "shape", id: 4, name: "Box", text: "Play", offset }] },
      ]),
    ).slides[0];

  expect(slide([10, 20])?.otherShapes).toEqual([
    { id: "4", name: "Box", kind: "sp", frame: "10,20,100,100", text: "Play" },
  ]);
  expect(slide([10, 21])).not.toEqual(slide([10, 20]));
});

it("reads archive entries named with either path separator", () => {
  const slides = [
    {
      notes: "Notes",
      shapes: [{ kind: "audio" as const, id: 2, name: "ppt_audio_1", media: clip }],
    },
  ];

  expect(inspectPresentation(buildTestPresentation(slides, { separator: "\\" }))).toEqual(
    inspectPresentation(buildTestPresentation(slides, { separator: "/" })),
  );
});

it("reads a saved presentation from disk without changing it", () => {
  const presentation = buildTestPresentation([{ notes: "On disk" }]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "presentation-inspector-"));
  const filePath = path.join(dir, "deck.pptx");
  fs.writeFileSync(filePath, presentation);

  try {
    expect(inspectPresentation(filePath).slides[0]?.notes).toBe("On disk");
    expect(new Uint8Array(fs.readFileSync(filePath))).toEqual(presentation);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
