import { MantineProvider } from "@mantine/core";
import { useRef } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import type { PreviewNarrationRequest } from "../../../shared/types/narration";
import type { Voice } from "../../../shared/types/tts";
import { AudioProvider } from "../../context/AudioContext";
import { SectionPreviewButtons } from "./SectionPreviewButtons";

const narratorVoice: Voice = {
  name: "narrator-test-voice",
  languageCodes: ["en-US"],
  ssmlGender: "FEMALE",
  provider: "gcp",
};

afterEach(() => {
  vi.restoreAllMocks();
});

test("previews only the text selected in the live notes editor", async () => {
  const previewRequests: PreviewNarrationRequest[] = [];
  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: {
      prepareNarrationPreview: async (request: PreviewNarrationRequest) => {
        previewRequests.push(request);
        return new Uint8Array([1, 2, 3]);
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
