import { MantineProvider } from "@mantine/core";
import { useRef, type PropsWithChildren } from "react";
import { afterEach, expect, test, vi, type MockInstance } from "vitest";
import { render } from "vitest-browser-react";
import type {
  NarrationPreviewResult,
  PreviewNarrationRequest,
} from "../../../shared/types/narration";
import type { NarrationSection } from "../../../shared/narration/NarrationSections";
import type { Voice } from "../../../shared/types/tts";
import { AudioProvider } from "../../context/AudioContext";
import { SectionPreviewButtons } from "./SectionPreviewButtons";
import { NarrationPreviewProvider } from "./useNarrationPreview";

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
  slideNotes,
  section,
  sectionIndex = 0,
  captureAudio = false,
}: {
  slideNotes: string;
  section: NarrationSection;
  sectionIndex?: number;
  captureAudio?: boolean;
}) {
  const previewRequests: PreviewNarrationRequest[] = [];
  const audioElements: HTMLAudioElement[] = [];
  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: {
      prepareNarrationPreview: (request: PreviewNarrationRequest) => {
        previewRequests.push(request);
        return Promise.resolve({ audio: new Uint8Array([1, 2, 3]), mediaType: "audio/mpeg" });
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
        slideIndex={1}
        sectionIndex={sectionIndex}
        slideNotes={slideNotes}
        section={section}
        mappings={{ Narrator: { voice: narratorVoice } }}
        onFocus={() => {}}
      />
    </PreviewProviders>,
  );

  return { audioElements, previewRequests, screen };
}

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
      {[
        { index: 0, speaker: "First" },
        { index: 1, speaker: "Second" },
      ].map(({ index, speaker }) => (
        <SectionPreviewButtons
          key={speaker}
          id={`1-${index}`}
          slideIndex={1}
          sectionIndex={index}
          slideNotes={`${speaker} section`}
          section={{ speaker, text: `${speaker} section` }}
          mappings={{ [speaker]: { voice: narratorVoice } }}
          onFocus={() => {}}
        />
      ))}
    </PreviewProviders>,
  );

  return { createObjectUrl, finishPreview, pause, play, screen };
}

test("previews only the text selected in the live notes editor", async () => {
  const previewRequests: PreviewNarrationRequest[] = [];
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
    const editorRef = useRef<HTMLTextAreaElement | null>(null);
    return (
      <PreviewProviders>
        <label htmlFor="preview-editor">Narration text</label>
        <textarea id="preview-editor" ref={editorRef} defaultValue="Read only this phrase please" />
        <SectionPreviewButtons
          id="1-0"
          slideIndex={1}
          sectionIndex={0}
          slideNotes="Stale section text"
          section={{ speaker: "Narrator", text: "Stale section text" }}
          mappings={{ Narrator: { voice: narratorVoice } }}
          onFocus={() => {}}
          getTextarea={() => editorRef.current}
        />
      </PreviewProviders>
    );
  }

  const screen = await render(<PreviewHarness />);
  const editor = screen.getByRole("textbox", { name: "Narration text" });
  (editor.element() as HTMLTextAreaElement).setSelectionRange(5, 21);

  await screen.getByRole("button", { name: "Narrator" }).click();

  await vi.waitFor(() => {
    expect(previewRequests).toContainEqual(
      expect.objectContaining({
        text: "only this phrase",
        speakerChoice: { kind: "override", speaker: "Narrator" },
      }),
    );
  });
});

test("an effective preview derives its highlighted speaker from slide notes", async () => {
  const { previewRequests, screen } = await renderSpeakerChoicePreview({
    slideNotes: "[Narrator]\nFirst\n---\nInherited",
    section: { speaker: "", text: "Inherited" },
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
    slideNotes: "[Narrator]\nFirst\n---\nInherited",
    section: { speaker: "", text: "Inherited" },
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
  const slideNotes = "[Narrator]\nStored narration";
  const { previewRequests, screen } = await renderSpeakerChoicePreview({
    slideNotes,
    section: { speaker: "Narrator", text: "Stored narration" },
  });

  await screen.getByRole("button", { name: "Default" }).click();

  await vi.waitFor(() =>
    expect(previewRequests).toEqual([
      expect.objectContaining({
        notes: slideNotes,
        speakerChoice: { kind: "default" },
      }),
    ]),
  );
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
        slideIndex={1}
        sectionIndex={0}
        slideNotes="Delayed preview"
        section={{ speaker: "Narrator", text: "Delayed preview" }}
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
        slideIndex={1}
        sectionIndex={0}
        slideNotes="[Narrator]\nLocal narration"
        section={{ speaker: "Narrator", text: "Local narration" }}
        mappings={{ Narrator: { voice: narratorVoice } }}
        onFocus={() => {}}
      />
    </PreviewProviders>,
  );

  await screen.getByRole("button", { name: "Narrator" }).click();

  await vi.waitFor(() => expect(createObjectURL).toHaveBeenCalledOnce());
  expect((createObjectURL.mock.calls[0]![0] as Blob).type).toBe("audio/mpeg");
});
