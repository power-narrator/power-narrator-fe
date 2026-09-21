import { toSlideIndex } from "../../../shared/slides/slideCoordinates";
import { MantineProvider } from "@mantine/core";
import { useState } from "react";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import type { SpeakerMapping, Voice } from "../../../shared/types/tts";
import { AudioProvider } from "../../context/AudioContext";
import { NotesSectionList } from "./NotesSectionList";
import type { EditorSection, SectionId } from "./SlideNoteEditor";
import { NarrationPreviewProvider } from "./useNarrationPreview";
import { useSectionTextareas } from "./useSectionTextareas";

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

const sections: EditorSection[] = [
  { id: "section-0", speaker: "Alice", text: "First narration" },
  { id: "section-1", speaker: "", text: "Second section" },
];

type SectionHandlers = ReturnType<typeof sectionHandlers>;

function sectionHandlers() {
  return {
    onFocusSection: vi.fn<(id: SectionId) => void>(),
    onSpeakerChange: vi.fn<(id: SectionId, speaker: string | null) => void>(),
    onSectionTextChange: vi.fn<(id: SectionId, value: string) => void>(),
    onSectionPromptChange: vi.fn<(id: SectionId, prompt: string | undefined) => void>(),
    onDeleteSection: vi.fn<(id: SectionId) => void>(),
    onAddSection: vi.fn<() => void>(),
  };
}

/** Deletion is applied here so stable identities are observable through the view. */
function SectionsHarness({
  initialSections,
  handlers,
}: {
  initialSections: EditorSection[];
  handlers: SectionHandlers;
}) {
  const [shown, setShown] = useState(initialSections);
  const textareas = useSectionTextareas();

  return (
    <NotesSectionList
      {...handlers}
      sections={shown}
      mappings={mappings}
      slideIndex={toSlideIndex(2)}
      textareas={textareas}
      onDeleteSection={(id) => {
        handlers.onDeleteSection(id);
        setShown((current) => current.filter((section) => section.id !== id));
      }}
    />
  );
}

async function renderSections(initialSections = sections) {
  const handlers = sectionHandlers();
  const screen = await render(
    <MantineProvider>
      <AudioProvider>
        <NarrationPreviewProvider>
          <SectionsHarness initialSections={initialSections} handlers={handlers} />
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

  expect(handlers.onSpeakerChange).toHaveBeenCalledWith("section-1", "Bob");
});

test("reports deletion and addition of sections", async () => {
  const { screen, handlers } = await renderSections();

  await screen.getByRole("button", { name: "Remove slide 3 section 2" }).click();
  await screen.getByRole("button", { name: "Add Section" }).click();

  expect(handlers.onDeleteSection).toHaveBeenCalledWith("section-1");
  expect(handlers.onAddSection).toHaveBeenCalled();
});

test("reports inline prompt edits for the edited section", async () => {
  const { screen, handlers } = await renderSections();

  await screen.getByRole("button", { name: "Prompt for slide 3 section 2" }).click();
  await screen.getByRole("textbox", { name: "Prompt for slide 3 section 2" }).fill("calm");

  expect(handlers.onSectionPromptChange).toHaveBeenLastCalledWith("section-1", "calm");
});

test("keeps section-local state with its own section when an earlier one is deleted", async () => {
  const { screen } = await renderSections([
    { id: "section-0", speaker: "Alice", text: "First narration" },
    { id: "section-1", speaker: "Bob", text: "Second section" },
  ]);

  await screen.getByRole("button", { name: "Prompt for slide 3 section 1" }).click();
  await expect
    .element(screen.getByRole("textbox", { name: "Prompt for slide 3 section 1" }))
    .toBeVisible();
  await screen.getByRole("button", { name: "Remove slide 3 section 1" }).click();

  // The survivor now renders first, but the opened prompt belonged to the deleted section.
  await expect
    .element(screen.getByRole("textbox", { name: "Slide 3 section 1 notes" }))
    .toHaveValue("Second section");
  await expect
    .element(screen.getByRole("textbox", { name: "Prompt for slide 3 section 1" }))
    .not.toBeInTheDocument();
});
