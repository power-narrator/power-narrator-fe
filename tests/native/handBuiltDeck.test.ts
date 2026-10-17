import path from "node:path";
import { describe, expect, it } from "vitest";
import { inspectPresentation } from "./presentationInspector.js";

const deck = inspectPresentation(path.join(__dirname, "../fixtures/hand-built-deck.pptx"));

describe("the hand-built deck holds what its recipe says", () => {
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
