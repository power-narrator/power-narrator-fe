import { MantineProvider } from "@mantine/core";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import type { NarrationSection } from "../../../shared/narration/NarrationSections";
import type { SpeakerMapping, Voice } from "../../../shared/types/tts";
import { AudioProvider } from "../../context/AudioContext";
import { NotesSectionList } from "./NotesSectionList";
import { NarrationPreviewProvider } from "./useNarrationPreview";

const promptableVoice: Voice = {
  provider: "gcp",
  voiceId: "Narrator",
  model: "gemini-2.5-flash-tts",
  languageCode: "en-US",
  supportsPrompt: true,
};

const mappings: Record<string, SpeakerMapping> = {
  Alice: { voice: promptableVoice },
  Bob: { voice: promptableVoice },
};

const sections: NarrationSection[] = [
  { speaker: "Alice", text: "First narration" },
  { speaker: "", text: "Second section" },
];

async function renderSections() {
  const handlers = {
    onFocusSection: vi.fn<(index: number) => void>(),
    onSpeakerChange: vi.fn<(index: number, speaker: string | null) => void>(),
    onSectionTextChange: vi.fn<(index: number, value: string) => void>(),
    onSectionPromptChange: vi.fn<(index: number, prompt: string | undefined) => void>(),
    onDeleteSection: vi.fn<(index: number) => void>(),
    onAddSection: vi.fn<() => void>(),
  };
  const screen = await render(
    <MantineProvider>
      <AudioProvider>
        <NarrationPreviewProvider>
          <NotesSectionList
            sections={sections}
            mappings={mappings}
            slideIndex={3}
            slideNotes={"[Alice]\nFirst narration\n---\nSecond section"}
            assignTextareaRef={() => {}}
            getTextarea={() => null}
            {...handlers}
          />
        </NarrationPreviewProvider>
      </AudioProvider>
    </MantineProvider>,
  );

  return { screen, handlers };
}

test("names each section's controls after the section they act on", async () => {
  const { screen } = await renderSections();

  await expect
    .element(screen.getByRole("textbox", { name: "Slide 3 section 1 notes" }))
    .toHaveValue("First narration");
  await expect
    .element(screen.getByRole("textbox", { name: "Slide 3 section 2 notes" }))
    .toHaveValue("Second section");
  await expect
    .element(screen.getByRole("button", { name: "Remove slide 3 section 1" }))
    .toBeInTheDocument();
  await expect
    .element(screen.getByRole("button", { name: "Remove slide 3 section 2" }))
    .toBeInTheDocument();
});

test("shows the chosen speaker and offers the inherited one as a placeholder", async () => {
  const { screen } = await renderSections();

  await expect
    .element(screen.getByRole("combobox", { name: "Speaker for slide 3 section 1" }))
    .toHaveValue("Alice");
  await expect
    .element(screen.getByRole("combobox", { name: "Speaker for slide 3 section 2" }))
    .toHaveAttribute("placeholder", "Speaker (Alice)");
});

test("reports a speaker choice for the edited section", async () => {
  const { screen, handlers } = await renderSections();

  await screen.getByRole("combobox", { name: "Speaker for slide 3 section 2" }).click();
  await screen.getByRole("option", { name: "Bob" }).click();

  expect(handlers.onSpeakerChange).toHaveBeenCalledWith(1, "Bob");
});

test("reports deletion and addition of sections", async () => {
  const { screen, handlers } = await renderSections();

  await screen.getByRole("button", { name: "Remove slide 3 section 2" }).click();
  await screen.getByRole("button", { name: "Add Section" }).click();

  expect(handlers.onDeleteSection).toHaveBeenCalledWith(1);
  expect(handlers.onAddSection).toHaveBeenCalled();
});

test("reports inline prompt edits for the edited section", async () => {
  const { screen, handlers } = await renderSections();

  await screen.getByRole("button", { name: "Prompt for slide 3 section 2" }).click();
  await screen.getByRole("textbox", { name: "Prompt for slide 3 section 2" }).fill("calm");

  expect(handlers.onSectionPromptChange).toHaveBeenLastCalledWith(1, "calm");
});
