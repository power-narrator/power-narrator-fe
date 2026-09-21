import { toSlideIndex } from "../../../shared/slides/slideCoordinates";
import { MantineProvider } from "@mantine/core";
import type { PropsWithChildren } from "react";
import { afterEach, expect, test, vi, type MockInstance } from "vitest";
import { render } from "vitest-browser-react";
import type {
  NarrationPreviewResult,
  PreviewNarrationRequest,
} from "../../../shared/types/narration";
import type { NarrationSection } from "../../../shared/narration/NarrationSections";
import type { SpeakerMapping, Voice } from "../../../shared/types/tts";
import { AudioProvider } from "../../context/AudioContext";
import { SectionPreviewButtons } from "./SectionPreviewButtons";
import { NarrationPreviewProvider } from "./useNarrationPreview";
import { useSectionTextareas } from "./useSectionTextareas";

const narratorVoice: Voice = {
  provider: "gcp",
  voiceId: "Narrator",
  model: "chirp-3-hd",
  languageCode: "en-US",
  supportsPrompt: false,
};

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, "electronAPI");
});

function playedMediaTypes(createObjectUrl: MockInstance<typeof URL.createObjectURL>) {
  return createObjectUrl.mock.calls.map(([source]) => (source as Blob).type);
}

function PreviewProviders({ children }: PropsWithChildren) {
  return (
    <MantineProvider>
      <AudioProvider>
        <NarrationPreviewProvider>{children}</NarrationPreviewProvider>
      </AudioProvider>
    </MantineProvider>
  );
}

async function renderSpeakerChoicePreview({
  sections,
  sectionIndex = 0,
  captureAudio = false,
  mappings = { Narrator: { voice: narratorVoice } },
  respond = () => Promise.resolve({ audio: new Uint8Array([1, 2, 3]), mediaType: "audio/mpeg" }),
}: {
  sections: NarrationSection[];
  sectionIndex?: number;
  captureAudio?: boolean;
  mappings?: Record<string, SpeakerMapping>;
  respond?: () => Promise<NarrationPreviewResult>;
}) {
  const previewRequests: PreviewNarrationRequest[] = [];
  const audioElements: HTMLAudioElement[] = [];
  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: {
      prepareNarrationPreview: (request: PreviewNarrationRequest) => {
        previewRequests.push(request);
        return respond();
      },
    },
  });
  if (captureAudio) {
    const NativeAudio = window.Audio;
    vi.spyOn(window, "Audio").mockImplementation(function (...args) {
      const audio = new NativeAudio(...args);
      audioElements.push(audio);
      return audio;
    });
  }
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview");
  const screen = await render(
    <PreviewProviders>
      <SectionPreviewButtons
        id={`1-${sectionIndex}`}
        slideIndex={toSlideIndex(0)}
        sectionIndex={sectionIndex}
        sections={sections}
        mappings={mappings}
        onFocus={() => {}}
      />
    </PreviewProviders>,
  );

  return { audioElements, previewRequests, screen };
}

const concurrentSections: NarrationSection[] = [
  { speaker: "First", text: "First section" },
  { speaker: "Second", text: "Second section" },
];

async function renderConcurrentSectionPreviews() {
  const finishPreview = new Map<number, (preview: NarrationPreviewResult) => void>();
  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: {
      prepareNarrationPreview: ({ sectionIndex }: PreviewNarrationRequest) =>
        new Promise<NarrationPreviewResult>((resolve) => finishPreview.set(sectionIndex, resolve)),
    },
  });
  const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  const createObjectUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview");
  const screen = await render(
    <PreviewProviders>
      {concurrentSections.map((section, sectionIndex) => (
        <SectionPreviewButtons
          key={section.speaker}
          id={`1-${sectionIndex}`}
          slideIndex={toSlideIndex(0)}
          sectionIndex={sectionIndex}
          sections={concurrentSections}
          mappings={{ [section.speaker]: { voice: narratorVoice } }}
          onFocus={() => {}}
        />
      ))}
    </PreviewProviders>,
  );

  return { createObjectUrl, finishPreview, pause, play, screen };
}

const liveSection: NarrationSection = {
  speaker: "Narrator",
  prompt: "wearily",
  text: "Stale section text",
};

/**
 * Wires the preview to the real textarea adapter, so what the author has
 * selected in the live editor is what reaches narration preparation.
 */
function renderLivePreview(previewRequests: PreviewNarrationRequest[]) {
  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: {
      prepareNarrationPreview: (request: PreviewNarrationRequest) => {
        previewRequests.push(request);
        return Promise.resolve({ audio: new Uint8Array([1, 2, 3]), mediaType: "audio/mpeg" });
      },
    },
  });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});

  function PreviewHarness() {
    const textareas = useSectionTextareas();
    return (
      <PreviewProviders>
        <label htmlFor="preview-editor">Narration text</label>
        <textarea
          id="preview-editor"
          ref={(element) => textareas.assign("section-0", element)}
          defaultValue="Read only this phrase please"
        />
        <SectionPreviewButtons
          id="section-0"
          slideIndex={toSlideIndex(0)}
          sectionIndex={0}
          sections={[liveSection]}
          mappings={{ Narrator: { voice: narratorVoice } }}
          onFocus={() => {}}
          getSelectedText={() => textareas.selectedTextIn("section-0")}
        />
      </PreviewProviders>
    );
  }

  return render(<PreviewHarness />);
}

test("previews only the text selected in the live notes editor", async () => {
  const previewRequests: PreviewNarrationRequest[] = [];
  const screen = await renderLivePreview(previewRequests);
  const editor = screen.getByRole("textbox", { name: "Narration text" });
  (editor.element() as HTMLTextAreaElement).setSelectionRange(5, 21);

  await screen.getByRole("button", { name: "Narrator" }).click();

  await vi.waitFor(() => {
    expect(previewRequests).toContainEqual(
      expect.objectContaining({
        text: "only this phrase",
        sections: [liveSection],
        speakerChoice: { kind: "override", speaker: "Narrator" },
      }),
    );
  });
});

test("previews the whole live notes editor when nothing is selected", async () => {
  const previewRequests: PreviewNarrationRequest[] = [];
  const screen = await renderLivePreview(previewRequests);

  await screen.getByRole("button", { name: "Narrator" }).click();

  await vi.waitFor(() => {
    expect(previewRequests).toContainEqual(
      expect.objectContaining({ text: "Read only this phrase please" }),
    );
  });
});

test("an effective preview derives its highlighted speaker from slide notes", async () => {
  const { previewRequests, screen } = await renderSpeakerChoicePreview({
    sections: [
      { speaker: "Narrator", text: "First" },
      { speaker: "", text: "Inherited" },
    ],
    sectionIndex: 1,
  });

  await screen.getByRole("button", { name: "Preview effective speaker" }).click();

  expect(screen.getByRole("button", { name: "Stop preview" }).element()).toHaveAttribute(
    "title",
    "Effective speaker: Narrator",
  );
  await vi.waitFor(() =>
    expect(previewRequests).toEqual([
      expect.objectContaining({ speakerChoice: { kind: "effective" } }),
    ]),
  );
  await vi.waitFor(() =>
    expect(screen.getByRole("button", { name: "Narrator" }).element()).toHaveAttribute(
      "data-variant",
      "filled",
    ),
  );
});

test("an effective preview remembers the inherited speaker after playback", async () => {
  const { audioElements, previewRequests, screen } = await renderSpeakerChoicePreview({
    sections: [
      { speaker: "Narrator", text: "First" },
      { speaker: "", text: "Inherited" },
    ],
    sectionIndex: 1,
    captureAudio: true,
  });

  await screen.getByRole("button", { name: "Preview effective speaker" }).click();
  await vi.waitFor(() => expect(previewRequests).toHaveLength(1));
  const activeAudio = audioElements.at(-1);
  expect(activeAudio).toBeDefined();
  activeAudio!.dispatchEvent(new Event("play"));
  await vi.waitFor(() =>
    expect(screen.getByRole("button", { name: "Stop preview" })).toBeVisible(),
  );
  activeAudio!.dispatchEvent(new Event("ended"));

  await vi.waitFor(() =>
    expect(screen.getByRole("button", { name: "Preview effective speaker" })).toBeVisible(),
  );
  expect(screen.getByRole("button", { name: "Narrator" }).element()).toHaveAttribute(
    "title",
    "Previously previewed",
  );
});

test("an explicit Default preview remains a temporary override", async () => {
  const sections: NarrationSection[] = [{ speaker: "Narrator", text: "Stored narration" }];
  const { previewRequests, screen } = await renderSpeakerChoicePreview({ sections });

  await screen.getByRole("button", { name: "Default" }).click();

  await vi.waitFor(() =>
    expect(previewRequests).toEqual([
      expect.objectContaining({
        sections: [{ speaker: "Narrator", text: "Stored narration" }],
        speakerChoice: { kind: "default" },
      }),
    ]),
  );
  expect(sections).toEqual([{ speaker: "Narrator", text: "Stored narration" }]);
});

test("stopping a pending preview suppresses its late audio result", async () => {
  let finishPreview: ((preview: NarrationPreviewResult) => void) | undefined;
  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: {
      prepareNarrationPreview: () =>
        new Promise<NarrationPreviewResult>((resolve) => {
          finishPreview = resolve;
        }),
    },
  });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  const createObjectUrl = vi.spyOn(URL, "createObjectURL");
  const screen = await render(
    <PreviewProviders>
      <SectionPreviewButtons
        id="1-0"
        slideIndex={toSlideIndex(0)}
        sectionIndex={0}
        sections={[{ speaker: "Narrator", text: "Delayed preview" }]}
        mappings={{ Narrator: { voice: narratorVoice } }}
        onFocus={() => {}}
      />
    </PreviewProviders>,
  );

  await screen.getByRole("button", { name: "Narrator" }).click();
  await screen.getByRole("button", { name: "Narrator" }).click();
  const suppressed = finishPreview;
  suppressed?.({ audio: new Uint8Array([1, 2, 3]), mediaType: "audio/mpeg" });

  // A later preview that does play gives the suppressed result somewhere to have shown up first.
  await screen.getByRole("button", { name: "Narrator" }).click();
  await vi.waitFor(() => expect(finishPreview).not.toBe(suppressed));
  finishPreview?.({ audio: new Uint8Array([4, 5, 6]), mediaType: "audio/mpeg" });

  await vi.waitFor(() => expect(playedMediaTypes(createObjectUrl)).toEqual(["audio/mpeg"]));
});

test("a newer section preview suppresses an older section's late result", async () => {
  const { createObjectUrl, finishPreview, screen } = await renderConcurrentSectionPreviews();

  await screen.getByRole("button", { name: "First" }).click();
  await screen.getByRole("button", { name: "Second" }).click();
  finishPreview.get(1)?.({ audio: new Uint8Array([2]), mediaType: "audio/mpeg" });
  await vi.waitFor(() => expect(playedMediaTypes(createObjectUrl)).toEqual(["audio/mpeg"]));
  finishPreview.get(0)?.({ audio: new Uint8Array([1]), mediaType: "audio/mpeg" });

  // A later preview that does play gives the superseded result somewhere to have shown up first.
  finishPreview.delete(0);
  await screen.getByRole("button", { name: "First" }).click();
  await vi.waitFor(() => expect(finishPreview.has(0)).toBe(true));
  finishPreview.get(0)?.({ audio: new Uint8Array([3]), mediaType: "audio/mpeg" });

  await vi.waitFor(() =>
    expect(playedMediaTypes(createObjectUrl)).toEqual(["audio/mpeg", "audio/mpeg"]),
  );
});

test("active playback remains stoppable while another section generates", async () => {
  const { finishPreview, pause, play, screen } = await renderConcurrentSectionPreviews();

  await screen.getByRole("button", { name: "First" }).click();
  finishPreview.get(0)?.({ audio: new Uint8Array([1]), mediaType: "audio/mpeg" });
  await vi.waitFor(() => expect(play).toHaveBeenCalledOnce());
  await screen.getByRole("button", { name: "Second" }).click();
  await screen.getByRole("button", { name: "First" }).click();
  expect(pause).toHaveBeenCalled();

  finishPreview.get(1)?.({ audio: new Uint8Array([2]), mediaType: "audio/mpeg" });
  await vi.waitFor(() => expect(play).toHaveBeenCalledTimes(2));
});

test("creates MP3 playback for a narration preview", async () => {
  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: {
      prepareNarrationPreview: () =>
        Promise.resolve({
          audio: new Uint8Array([1, 2, 3]),
          mediaType: "audio/mpeg",
        }),
    },
  });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview");
  const screen = await render(
    <PreviewProviders>
      <SectionPreviewButtons
        id="1-0"
        slideIndex={toSlideIndex(0)}
        sectionIndex={0}
        sections={[{ speaker: "Narrator", text: "Local narration" }]}
        mappings={{ Narrator: { voice: narratorVoice } }}
        onFocus={() => {}}
      />
    </PreviewProviders>,
  );

  await screen.getByRole("button", { name: "Narrator" }).click();

  await vi.waitFor(() => expect(createObjectURL).toHaveBeenCalledOnce());
  expect((createObjectURL.mock.calls[0]![0] as Blob).type).toBe("audio/mpeg");
});

test("surfaces a contextual narration-preparation failure and stays ready to retry", async () => {
  const alerted = vi.spyOn(window, "alert").mockImplementation(() => {});
  const { screen } = await renderSpeakerChoicePreview({
    sections: [{ speaker: "Narrator", text: "Unnarratable" }],
    mappings: { Narrator: {} },
    respond: () =>
      Promise.reject(
        new Error(
          'Narration validation failed for slide 1, section 1, speaker "Narrator": no voice mapping is configured.',
        ),
      ),
  });

  await screen.getByRole("button", { name: "Narrator" }).click();

  await vi.waitFor(() =>
    expect(alerted).toHaveBeenCalledWith(
      'Failed to play audio: Narration validation failed for slide 1, section 1, speaker "Narrator": no voice mapping is configured.',
    ),
  );
  await expect.element(screen.getByRole("button", { name: "Narrator" })).toBeEnabled();
});
