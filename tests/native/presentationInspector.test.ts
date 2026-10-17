import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { strToU8 } from "fflate";
import { describe, expect, it } from "vitest";
import {
  inspectPresentation,
  mediaDigest,
  presentationDifferences,
} from "./presentationInspector.js";
import { buildTestPresentation, type TestEffect } from "./testPresentation.js";

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

it("reports each effect's type, target and trigger in sequence order, and no timing", () => {
  const presentation = buildTestPresentation([
    {
      shapes: [
        { kind: "shape", id: 2, name: "Box" },
        { kind: "shape", id: 3, name: "Button" },
        { kind: "audio", id: 4, name: "ppt_audio_1", media: clip },
        { kind: "audio", id: 5, name: "ppt_audio_2", media: clip },
      ],
      effects: [
        { type: "play", target: 4, delay: 250 },
        { type: "fade", target: 2 },
        { type: "pause", target: 4 },
        { type: "play", target: 5, trigger: 3 },
        { type: "stop", target: 4 },
        { type: "stop", target: 5, trigger: 5 },
      ],
    },
  ]);

  const [slide] = inspectPresentation(presentation).slides;

  expect(slide?.effects).toEqual([
    { type: "play", target: "ppt_audio_1" },
    { type: "fade", target: "Box" },
    { type: "pause", target: "ppt_audio_1" },
    { type: "stop", target: "ppt_audio_1" },
    { type: "play", target: "ppt_audio_2", trigger: "Button" },
    { type: "stop", target: "ppt_audio_2", trigger: "ppt_audio_2" },
  ]);
});

it("reports the volume and mute of section audio", () => {
  const presentation = buildTestPresentation([
    {
      shapes: [
        { kind: "audio", id: 2, name: "ppt_audio_1", media: clip, volume: 20000 },
        { kind: "audio", id: 3, name: "ppt_audio_2", media: clip, volume: 80000, muted: true },
      ],
    },
  ]);

  const [slide] = inspectPresentation(presentation).slides;

  expect(slide?.sectionAudio.map(({ name, volume, muted }) => ({ name, volume, muted }))).toEqual([
    { name: "ppt_audio_1", volume: 20000, muted: false },
    { name: "ppt_audio_2", volume: 80000, muted: true },
  ]);
});

describe("comparing presentations", () => {
  const BOX = 2;
  const BUTTON = 3;
  const AUDIO_1 = 4;
  const AUDIO_2 = 5;
  const original: TestEffect[] = [
    { type: "play", target: AUDIO_1 },
    { type: "fade", target: BOX },
    { type: "pause", target: AUDIO_1 },
    { type: "stop", target: AUDIO_1 },
    { type: "play", target: AUDIO_2, trigger: BUTTON },
  ];
  const inspect = ({
    effects = original,
    boxOffset = [10, 20],
    notes = "Second",
    muted = true,
  }: {
    effects?: TestEffect[];
    boxOffset?: [number, number];
    notes?: string;
    muted?: boolean;
  } = {}) =>
    inspectPresentation(
      buildTestPresentation([
        { notes: "First" },
        {
          notes,
          shapes: [
            { kind: "shape", id: BOX, name: "Box", offset: boxOffset },
            { kind: "shape", id: BUTTON, name: "Button", text: "Play" },
            { kind: "audio", id: AUDIO_1, name: "ppt_audio_1", media: clip, volume: 20000 },
            { kind: "audio", id: AUDIO_2, name: "ppt_audio_2", media: clip, muted },
          ],
          effects,
        },
      ]),
    );

  it("finds no difference when only timing values differ", () => {
    const delayed = original.map((effect) => ({ ...effect, delay: 1500 }));

    expect(presentationDifferences(inspect(), inspect({ effects: delayed }))).toEqual([]);
  });

  it("names a removed effect", () => {
    const withoutFade = original.filter(({ type }) => type !== "fade");

    expect(presentationDifferences(inspect(), inspect({ effects: withoutFade }))).toEqual([
      "slide 2, effect fade Box: removed",
    ]);
  });

  it("names a reordered effect", () => {
    const [play, fade, pause, stop, triggered] = original;
    const fadeLast = [play, pause, stop, fade, triggered].filter((effect) => effect !== undefined);

    expect(presentationDifferences(inspect(), inspect({ effects: fadeLast }))).toEqual([
      "slide 2, effect fade Box: at position 4, expected 2",
    ]);
  });

  it.each([
    { trigger: AUDIO_2, change: "triggered by ppt_audio_2" },
    { trigger: undefined, change: "in the main sequence" },
  ])("names a trigger moved $change", ({ trigger, change }) => {
    const retriggered = original.map((effect) =>
      effect.trigger === BUTTON ? { ...effect, trigger } : effect,
    );

    expect(presentationDifferences(inspect(), inspect({ effects: retriggered }))).toEqual([
      `slide 2, effect play ppt_audio_2: ${change}, expected triggered by Button`,
    ]);
  });

  it("names a changed property of a shape that is not section audio", () => {
    expect(presentationDifferences(inspect(), inspect({ boxOffset: [10, 21] }))).toEqual([
      'slide 2, shape Box: frame "10,21,100,100", expected "10,20,100,100"',
    ]);
  });

  it("names changed notes and a changed setting of section audio", () => {
    expect(
      presentationDifferences(inspect(), inspect({ notes: "Second, edited", muted: false })),
    ).toEqual([
      'slide 2, notes: "Second, edited", expected "Second"',
      "slide 2, section audio ppt_audio_2: muted false, expected true",
    ]);
  });
});
