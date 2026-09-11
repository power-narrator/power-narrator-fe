import { MantineProvider } from "@mantine/core";
import { useRef } from "react";
import { afterEach, expect, test, vi, type MockInstance } from "vitest";
import { render } from "vitest-browser-react";
import type {
  NarrationPreviewResult,
  PreviewNarrationRequest,
} from "../../../shared/types/narration";
import type { Voice } from "../../../shared/types/tts";
import { AudioProvider } from "../../context/AudioContext";
import { SectionPreviewButtons } from "./SectionPreviewButtons";
import { NarrationPreviewProvider } from "./useNarrationPreview";

const narratorVoice: Voice = {
  name: "narrator-test-voice",
  languageCodes: ["en-US"],
  ssmlGender: "FEMALE",
  provider: "gcp",
};

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, "electronAPI");
});

function playedMediaTypes(createObjectUrl: MockInstance<typeof URL.createObjectURL>) {
  return createObjectUrl.mock.calls.map(([source]) => (source as Blob).type);
}

test("previews only the text selected in the live notes editor", async () => {
  const previewRequests: PreviewNarrationRequest[] = [];
  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: {
      prepareNarrationPreview: async (request: PreviewNarrationRequest) => {
        previewRequests.push(request);
        return { audio: new Uint8Array([1, 2, 3]), mediaType: "audio/mpeg" };
      },
    } as unknown as typeof window.electronAPI,
  });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);

  function PreviewHarness() {
    const editorRef = useRef<HTMLTextAreaElement | null>(null);
    return (
      <MantineProvider>
        <AudioProvider>
          <NarrationPreviewProvider>
            <label htmlFor="preview-editor">Narration text</label>
            <textarea
              id="preview-editor"
              ref={editorRef}
              defaultValue="Read only this phrase please"
            />
            <SectionPreviewButtons
              id="1-0"
              slideIndex={1}
              sectionIndex={0}
              slideNotes="Stale section text"
              section={{ speaker: "Narrator", text: "Stale section text" }}
              effectiveSpeaker="Narrator"
              mappings={{ Narrator: narratorVoice }}
              onFocus={() => undefined}
              getTextarea={() => editorRef.current}
            />
          </NarrationPreviewProvider>
        </AudioProvider>
      </MantineProvider>
    );
  }

  const screen = await render(<PreviewHarness />);
  const editor = screen.getByRole("textbox", { name: "Narration text" });
  (editor.element() as HTMLTextAreaElement).setSelectionRange(5, 21);

  await screen.getByRole("button", { name: "Narrator" }).click();

  await vi.waitFor(() => {
    expect(previewRequests).toContainEqual(
      expect.objectContaining({ text: "only this phrase", previewSpeaker: "Narrator" }),
    );
  });
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
    } as unknown as typeof window.electronAPI,
  });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  const createObjectUrl = vi.spyOn(URL, "createObjectURL");
  const screen = await render(
    <MantineProvider>
      <AudioProvider>
        <NarrationPreviewProvider>
          <SectionPreviewButtons
            id="1-0"
            slideIndex={1}
            sectionIndex={0}
            slideNotes="Delayed preview"
            section={{ speaker: "Narrator", text: "Delayed preview" }}
            effectiveSpeaker="Narrator"
            mappings={{ Narrator: narratorVoice }}
            onFocus={() => undefined}
          />
        </NarrationPreviewProvider>
      </AudioProvider>
    </MantineProvider>,
  );

  await screen.getByRole("button", { name: "Narrator" }).click();
  await screen.getByRole("button", { name: "Narrator" }).click();
  const suppressed = finishPreview;
  suppressed?.({ audio: new Uint8Array([1, 2, 3]), mediaType: "audio/suppressed" });

  // A later preview that does play gives the suppressed result somewhere to have shown up first.
  await screen.getByRole("button", { name: "Narrator" }).click();
  await vi.waitFor(() => expect(finishPreview).not.toBe(suppressed));
  finishPreview?.({ audio: new Uint8Array([4, 5, 6]), mediaType: "audio/accepted" });

  await vi.waitFor(() => expect(playedMediaTypes(createObjectUrl)).toContain("audio/accepted"));
  expect(playedMediaTypes(createObjectUrl)).toEqual(["audio/accepted"]);
});

test("a newer section preview suppresses an older section's late result", async () => {
  const finishPreview = new Map<number, (preview: NarrationPreviewResult) => void>();
  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: {
      prepareNarrationPreview: ({ sectionIndex }: PreviewNarrationRequest) =>
        new Promise<NarrationPreviewResult>((resolve) => finishPreview.set(sectionIndex, resolve)),
    } as unknown as typeof window.electronAPI,
  });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  const createObjectUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview");
  const screen = await render(
    <MantineProvider>
      <AudioProvider>
        <NarrationPreviewProvider>
          <SectionPreviewButtons
            id="1-0"
            slideIndex={1}
            sectionIndex={0}
            slideNotes="First section"
            section={{ speaker: "First", text: "First section" }}
            effectiveSpeaker="First"
            mappings={{ First: narratorVoice }}
            onFocus={() => undefined}
          />
          <SectionPreviewButtons
            id="1-1"
            slideIndex={1}
            sectionIndex={1}
            slideNotes="Second section"
            section={{ speaker: "Second", text: "Second section" }}
            effectiveSpeaker="Second"
            mappings={{ Second: narratorVoice }}
            onFocus={() => undefined}
          />
        </NarrationPreviewProvider>
      </AudioProvider>
    </MantineProvider>,
  );

  await screen.getByRole("button", { name: "First" }).click();
  await screen.getByRole("button", { name: "Second" }).click();
  finishPreview.get(1)?.({ audio: new Uint8Array([2]), mediaType: "audio/newer" });
  await vi.waitFor(() => expect(playedMediaTypes(createObjectUrl)).toEqual(["audio/newer"]));
  finishPreview.get(0)?.({ audio: new Uint8Array([1]), mediaType: "audio/superseded" });

  // A later preview that does play gives the superseded result somewhere to have shown up first.
  finishPreview.delete(0);
  await screen.getByRole("button", { name: "First" }).click();
  await vi.waitFor(() => expect(finishPreview.has(0)).toBe(true));
  finishPreview.get(0)?.({ audio: new Uint8Array([3]), mediaType: "audio/accepted" });

  await vi.waitFor(() => expect(playedMediaTypes(createObjectUrl)).toContain("audio/accepted"));
  expect(playedMediaTypes(createObjectUrl)).toEqual(["audio/newer", "audio/accepted"]);
});

test("active playback remains stoppable while another section generates", async () => {
  const finishPreview = new Map<number, (preview: NarrationPreviewResult) => void>();
  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: {
      prepareNarrationPreview: ({ sectionIndex }: PreviewNarrationRequest) =>
        new Promise<NarrationPreviewResult>((resolve) => finishPreview.set(sectionIndex, resolve)),
    } as unknown as typeof window.electronAPI,
  });
  const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview");
  const screen = await render(
    <MantineProvider>
      <AudioProvider>
        <NarrationPreviewProvider>
          <SectionPreviewButtons
            id="1-0"
            slideIndex={1}
            sectionIndex={0}
            slideNotes="First section"
            section={{ speaker: "First", text: "First section" }}
            effectiveSpeaker="First"
            mappings={{ First: narratorVoice }}
            onFocus={() => undefined}
          />
          <SectionPreviewButtons
            id="1-1"
            slideIndex={1}
            sectionIndex={1}
            slideNotes="Second section"
            section={{ speaker: "Second", text: "Second section" }}
            effectiveSpeaker="Second"
            mappings={{ Second: narratorVoice }}
            onFocus={() => undefined}
          />
        </NarrationPreviewProvider>
      </AudioProvider>
    </MantineProvider>,
  );

  await screen.getByRole("button", { name: "First" }).click();
  finishPreview.get(0)?.({ audio: new Uint8Array([1]), mediaType: "audio/mpeg" });
  await vi.waitFor(() => expect(play).toHaveBeenCalledOnce());
  await screen.getByRole("button", { name: "Second" }).click();
  await screen.getByRole("button", { name: "First" }).click();
  expect(pause).toHaveBeenCalled();

  finishPreview.get(1)?.({ audio: new Uint8Array([2]), mediaType: "audio/mpeg" });
  await vi.waitFor(() => expect(play).toHaveBeenCalledTimes(2));
});

test("plays back preview audio as the media type the provider returned", async () => {
  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: {
      prepareNarrationPreview: async () => ({
        audio: new Uint8Array([1, 2, 3]),
        mediaType: "audio/wav",
      }),
    } as unknown as typeof window.electronAPI,
  });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview");
  const screen = await render(
    <MantineProvider>
      <AudioProvider>
        <NarrationPreviewProvider>
          <SectionPreviewButtons
            id="1-0"
            slideIndex={1}
            sectionIndex={0}
            slideNotes="[Narrator]\nLocal narration"
            section={{ speaker: "Narrator", text: "Local narration" }}
            effectiveSpeaker="Narrator"
            mappings={{ Narrator: narratorVoice }}
            onFocus={() => undefined}
          />
        </NarrationPreviewProvider>
      </AudioProvider>
    </MantineProvider>,
  );

  await screen.getByRole("button", { name: "Narrator" }).click();

  await vi.waitFor(() => expect(createObjectURL).toHaveBeenCalledOnce());
  expect((createObjectURL.mock.calls[0]![0] as Blob).type).toBe("audio/wav");
});
