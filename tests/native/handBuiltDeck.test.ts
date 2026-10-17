import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { inspectPresentation, type InspectedPresentation } from "./presentationInspector.js";

describe("the hand-built deck holds what its recipe says", () => {
  let deck: InspectedPresentation;

  beforeAll(() => {
    deck = inspectPresentation(
      fileURLToPath(new URL("../fixtures/hand-built-deck.pptx", import.meta.url)),
    );
  });

  it("has five slides with their notes", () => {
    expect(deck.slides.map(({ notes }) => notes)).toEqual([
      "First line of slide one.\nCafé — naïve “quotes” 日本語",
      "Slide two notes.",
      "Slide three notes.",
      "Slide four notes.",
      "Slide five notes.",
    ]);
  });

  it("has the section audio each slide needs", () => {
    expect(deck.slides.map(({ sectionAudio }) => sectionAudio.map(({ name }) => name))).toEqual([
      ["ppt_audio_1", "ppt_audio_2", "ppt_audio_3"],
      ["ppt_audio_1", "ppt_audio_2", "ppt_audio_3"],
      ["ppt_audio_1", "ppt_audio_2"],
      ["ppt_audio_1"],
      [],
    ]);
  });

  it("has media that only resembles section audio on slide 2, and no other media", () => {
    expect(deck.slides.map(({ otherMedia }) => otherMedia.map(({ name }) => name))).toEqual([
      [],
      ["ppt_audio_01"],
      [],
      [],
      [],
    ]);
  });

  it("has a Box on slide 2 and a Play Button on slide 3 beside each slide's title", () => {
    const shapes = deck.slides.map(({ otherShapes }) =>
      otherShapes
        .filter(({ media }) => media === undefined)
        .map(({ name, text }) => ({ name, text })),
    );

    expect(shapes).toEqual([
      [{ name: "Title 3", text: "Load" }],
      [
        { name: "Title 3", text: "Replace main" },
        { name: "Box", text: "" },
      ],
      [
        { name: "Title 2", text: "Replace triggers" },
        { name: "Button", text: "Play" },
      ],
      [{ name: "Title 1", text: "Refused" }],
      [{ name: "Title 1", text: "Clean" }],
    ]);
  });

  it("plays slide 2's ppt_audio_1 at low volume and mutes its ppt_audio_2", () => {
    expect(
      deck.slides[1]?.sectionAudio.map(({ name, volume, muted }) => ({ name, volume, muted })),
    ).toEqual([
      { name: "ppt_audio_1", volume: 20000, muted: false },
      { name: "ppt_audio_2", volume: 80000, muted: true },
      { name: "ppt_audio_3", volume: 80000, muted: false },
    ]);
  });

  it("has faded section audio on slide 4 for the refused-save case", () => {
    expect(deck.slides[3]?.sectionAudio).toMatchObject([{ name: "ppt_audio_1", fadeInMs: 1000 }]);
  });

  it("animates each slide's shapes as the recipe sets up", () => {
    expect(deck.slides.map(({ effects }) => effects)).toEqual([
      [
        { type: "play", target: "ppt_audio_1" },
        { type: "play", target: "ppt_audio_2" },
      ],
      [
        { type: "play", target: "ppt_audio_1" },
        { type: "fade", target: "Box" },
        { type: "pause", target: "ppt_audio_1" },
        { type: "stop", target: "ppt_audio_1" },
        { type: "play", target: "ppt_audio_3" },
        { type: "play", target: "ppt_audio_01" },
        { type: "play", target: "ppt_audio_2" },
      ],
      [
        { type: "play", target: "ppt_audio_1", trigger: "Button" },
        { type: "play", target: "ppt_audio_2", trigger: "ppt_audio_2" },
      ],
      [{ type: "play", target: "ppt_audio_1" }],
      [],
    ]);
  });
});
