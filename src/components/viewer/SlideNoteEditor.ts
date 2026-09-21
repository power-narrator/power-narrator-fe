import {
  formatNarrationSections,
  parseNarrationSections,
  type NarrationSection,
} from "../../../shared/narration/NarrationSections";
import type { Slide } from "../../types/electron";

export type SectionId = string;

export type EditorSection = NarrationSection & { id: SectionId };

/** A slide as the view sees it listed: everything but the sections it holds. */
export type SlideSummary = Omit<Slide, "sections">;

export interface TextRange {
  start: number;
  end: number;
}

/** Where the view should place focus and selection once the edit has rendered. */
export interface SelectionIntent extends TextRange {
  sectionId: SectionId;
}

export interface SsmlInsertion {
  startTag: string;
  /** Omitted for a self-closing tag, which is inserted at the caret. */
  endTag?: string;
  selection: TextRange;
}

export interface SsmlResult {
  editor: SlideNoteEditor;
  selection: SelectionIntent | undefined;
}

/**
 * A section no holder can change: the content a save submitted, and the saved
 * baselines completion reconciles it against, are read long after they were
 * taken, by callers that must not be able to rewrite them.
 */
export type ImmutableSection = Readonly<Omit<NarrationSection, "format">> & {
  readonly format?: Readonly<NonNullable<NarrationSection["format"]>>;
};

export interface SnapshotSlide {
  readonly index: number;
  readonly sections: readonly ImmutableSection[];
}

export interface SaveSubmission {
  editor: SlideNoteEditor;
  snapshot: SaveSnapshot;
}

type SavedSections = ReadonlyMap<number, readonly ImmutableSection[]>;

/** Exactly the structured content one persistence operation submitted. */
export class SaveSnapshot {
  readonly slides: readonly SnapshotSlide[];

  constructor(slides: readonly SnapshotSlide[]) {
    this.slides = Object.freeze(slides);
    Object.freeze(this);
  }
}

/**
 * The saved baselines each snapshot was submitted against, kept beside the
 * snapshot rather than in it: the author holds the snapshot while the operation
 * runs, and a baseline is editing state they have no business reading or moving.
 * A baseline is replaced only by a reload, a reclassification, or another
 * completed save, so one that is no longer the same has already moved past the
 * snapshot.
 */
const submittedAgainst = new WeakMap<SaveSnapshot, SavedSections>();

interface EditorSlide extends SlideSummary {
  sections: readonly EditorSection[];
}

interface HistorySnapshot {
  slides: readonly EditorSlide[];
  /** Which section was being edited, so undo returns the author to it. */
  activeSectionId: SectionId | undefined;
}

interface EditingState {
  slides: readonly EditorSlide[];
  /** Structured content each slide was last known to hold in PowerPoint. */
  savedSections: SavedSections;
  activeSlidePosition: number;
  /** The speaker mapping names bracketed lines are currently read against. */
  speakerNames: readonly string[];
  activeSectionId: SectionId | undefined;
  /** Identities a later section must not reuse, even after deletions. */
  mintedSectionCount: number;
  history: readonly HistorySnapshot[];
  historyIndex: number;
  /** When the author last typed, while that typing is not yet a checkpoint. */
  pendingTypingAt: number | undefined;
}

const TYPING_CHECKPOINT_PAUSE_MS = 800;

const FORMAT_KEYS = [
  "separatorBefore",
  "speakerPrefix",
  "speakerSuffix",
  "promptPrefix",
  "promptSuffix",
] as const;

const sameSection = (edited: NarrationSection, saved: NarrationSection) =>
  edited.text === saved.text &&
  edited.speaker === saved.speaker &&
  (edited.prompt || "") === (saved.prompt || "") &&
  FORMAT_KEYS.every((key) => (edited.format?.[key] || "") === (saved.format?.[key] || ""));

const sectionId = (number: number): SectionId => `section-${number}`;

function frozen(section: NarrationSection): ImmutableSection {
  Object.freeze(section.format);
  return Object.freeze(section);
}

const withoutIdentity = ({ id: _id, ...section }: EditorSection): ImmutableSection =>
  frozen(section);

/** Frozen because a baseline is evidence: what it recorded cannot be rewritten later. */
const baselineSections = (sections: readonly NarrationSection[]): readonly ImmutableSection[] =>
  Object.freeze(sections.map(frozen));

const baselineOf = (slides: readonly EditorSlide[]): SavedSections =>
  new Map(
    slides.map((slide) => [slide.index, baselineSections(slide.sections.map(withoutIdentity))]),
  );

const clampSlidePosition = (slides: readonly EditorSlide[], position: number): number =>
  Math.min(Math.max(position, 0), Math.max(slides.length - 1, 0));

function toEditorSlide({ sections, ...slide }: Slide, mint: () => SectionId): EditorSlide {
  return {
    ...slide,
    sections: sections.map((section) => ({ ...section, id: mint() })),
  };
}

/**
 * Freezes what the view is handed, so a projection cannot be edited in place
 * behind the editor's back. Already-frozen slides are left alone, which is
 * every slide an edit did not rebuild.
 */
function freeze(slides: readonly EditorSlide[]): readonly EditorSlide[] {
  if (Object.isFrozen(slides)) {
    return slides;
  }

  for (const slide of slides) {
    if (Object.isFrozen(slide)) {
      continue;
    }

    for (const section of slide.sections) {
      Object.freeze(section.format);
      Object.freeze(section);
    }
    Object.freeze(slide.sections);
    Object.freeze(slide);
  }

  return Object.freeze(slides);
}

/** A slide's sections are already immutable, so a snapshot only sheds their identities. */
function toSnapshotSlide(slide: EditorSlide): SnapshotSlide {
  return Object.freeze({
    index: slide.index,
    sections: Object.freeze(slide.sections.map(withoutIdentity)),
  });
}

const sameSpeakerNames = (current: readonly string[], next: readonly string[]) => {
  const known = new Set(current);
  const renamed = new Set(next);
  return known.size === renamed.size && [...renamed].every((name) => known.has(name));
};

/**
 * One editing session over a presentation's slide-note sections: what the author
 * has selected, what they have changed, what is undoable, and what is unsaved.
 * Every command answers with the session that command produced, leaving the one
 * it was asked of untouched.
 */
export class SlideNoteEditor {
  readonly #state: EditingState;
  #summaries: readonly SlideSummary[] | undefined;

  private constructor(state: EditingState) {
    this.#state = { ...state, slides: freeze(state.slides) };
  }

  /** Every slide is structured up front, so moving between them changes nothing. */
  static open(slides: readonly Slide[], knownSpeakers: Iterable<string>): SlideNoteEditor {
    let mintedSectionCount = 0;
    const editorSlides = slides.map((slide) =>
      toEditorSlide(slide, () => sectionId(mintedSectionCount++)),
    );
    const activeSectionId = editorSlides[0]?.sections[0]?.id;

    return new SlideNoteEditor({
      slides: editorSlides,
      savedSections: baselineOf(editorSlides),
      activeSlidePosition: 0,
      speakerNames: [...knownSpeakers],
      activeSectionId,
      mintedSectionCount,
      history: [{ slides: editorSlides, activeSectionId }],
      historyIndex: 0,
      pendingTypingAt: undefined,
    });
  }

  #with(changes: Partial<EditingState>): SlideNoteEditor {
    return new SlideNoteEditor({ ...this.#state, ...changes });
  }

  /**
   * Every slide as the view lists them, carrying no sections: the only sections
   * on show are the selected slide's. Built on first use because a view lists
   * slides on every render.
   */
  get slides(): readonly SlideSummary[] {
    this.#summaries ??= Object.freeze(
      this.#state.slides.map(({ sections: _sections, ...summary }) => Object.freeze(summary)),
    );

    return this.#summaries;
  }

  get activeSlidePosition(): number {
    return this.#state.activeSlidePosition;
  }

  get activeSlide(): SlideSummary | undefined {
    return this.slides[this.#state.activeSlidePosition];
  }

  get #activeSlide(): EditorSlide | undefined {
    return this.#state.slides[this.#state.activeSlidePosition];
  }

  /** The sections of the slide being edited; no other slide's are on show. */
  get sections(): readonly EditorSection[] {
    return this.#activeSlide?.sections ?? [];
  }

  get activeSectionId(): SectionId | undefined {
    return this.#state.activeSectionId;
  }

  get canUndo(): boolean {
    return this.#state.historyIndex > 0 || this.#state.pendingTypingAt !== undefined;
  }

  get canRedo(): boolean {
    return (
      this.#state.pendingTypingAt === undefined &&
      this.#state.historyIndex < this.#state.history.length - 1
    );
  }

  get hasUnsavedChanges(): boolean {
    return this.#state.slides.some((slide) => this.#slideIsDirty(slide));
  }

  isSlideDirty(slideNumber: number): boolean {
    const slide = this.#state.slides.find((candidate) => candidate.index === slideNumber);
    return slide !== undefined && this.#slideIsDirty(slide);
  }

  #slideIsDirty(slide: EditorSlide): boolean {
    const saved = this.#state.savedSections.get(slide.index);
    if (!saved) {
      return slide.sections.length > 0;
    }

    return (
      saved.length !== slide.sections.length ||
      slide.sections.some((section, position) => !sameSection(section, saved[position]!))
    );
  }

  selectSlide(position: number): SlideNoteEditor {
    const editor = this.finalizePendingTyping();
    const state = editor.#state;
    const activeSlidePosition = clampSlidePosition(state.slides, position);
    const activeSectionId = state.slides[activeSlidePosition]?.sections[0]?.id;
    if (activeSlidePosition === state.activeSlidePosition) {
      return editor.sections.some((section) => section.id === state.activeSectionId)
        ? editor
        : editor.#with({ activeSectionId });
    }

    return editor.#with({ activeSlidePosition, activeSectionId });
  }

  selectSection(id: SectionId): SlideNoteEditor {
    if (!this.sections.some((section) => section.id === id)) {
      return this;
    }

    return this.finalizePendingTyping().#with({ activeSectionId: id });
  }

  /**
   * Closes an open typing group, so the typing and whatever the author does next
   * remain separate undo steps. The view asks for this before the actions the
   * editor does not own: opening settings, and reload confirmation.
   */
  finalizePendingTyping(): SlideNoteEditor {
    return this.#state.pendingTypingAt === undefined ? this : this.#checkpoint();
  }

  /**
   * `returnTo` is the section that was being edited when the change began, which
   * a later command has usually already moved away from.
   */
  #checkpoint(returnTo: SectionId | undefined = this.#state.activeSectionId): SlideNoteEditor {
    const state = this.#state;
    const historyIndex = state.historyIndex + 1;
    const history = state.history.slice(0, historyIndex);
    history[state.historyIndex] = { ...history[state.historyIndex]!, activeSectionId: returnTo };

    return this.#with({
      history: [...history, { slides: state.slides, activeSectionId: state.activeSectionId }],
      historyIndex,
      pendingTypingAt: undefined,
    });
  }

  /** Typing joins the open group until the author pauses. */
  #typingEdit(change: (editor: SlideNoteEditor) => SlideNoteEditor): SlideNoteEditor {
    const typedAt = Date.now();
    const pendingTypingAt = this.#state.pendingTypingAt;
    const base =
      pendingTypingAt !== undefined && typedAt - pendingTypingAt >= TYPING_CHECKPOINT_PAUSE_MS
        ? this.#checkpoint()
        : this;
    const next = change(base);
    return next === base ? this : next.#with({ pendingTypingAt: typedAt });
  }

  #discreteEdit(change: (editor: SlideNoteEditor) => SlideNoteEditor): SlideNoteEditor {
    const finalized = this.finalizePendingTyping();
    const next = change(finalized);
    return next === finalized ? this : next.#checkpoint(finalized.#state.activeSectionId);
  }

  #slidePositionOf(id: SectionId): number {
    return this.#state.slides.findIndex((slide) =>
      slide.sections.some((section) => section.id === id),
    );
  }

  #withSlideSections(
    slidePosition: number,
    change: (sections: readonly EditorSection[]) => EditorSection[],
  ): SlideNoteEditor {
    const slide = this.#state.slides[slidePosition];
    if (!slide) {
      return this;
    }

    const slides = [...this.#state.slides];
    slides[slidePosition] = { ...slide, sections: change(slide.sections) };
    return this.#with({ slides });
  }

  /**
   * Edits one section in place. Untouched formatting metadata travels with the
   * section, so only the changed field is rewritten when notes are formatted.
   * An edit that changes nothing is not an edit, so it earns no undo step.
   */
  #editSection(id: SectionId, change: (section: EditorSection) => EditorSection): SlideNoteEditor {
    let changed = false;
    const edited = this.#withSlideSections(this.#slidePositionOf(id), (sections) =>
      sections.map((section) => {
        if (section.id !== id) {
          return section;
        }

        const updated = change(section);
        changed = !sameSection(updated, section);
        return changed ? updated : section;
      }),
    );

    return changed ? edited : this;
  }

  setSectionText(id: SectionId, text: string): SlideNoteEditor {
    return this.#typingEdit((typing) =>
      typing.#editSection(id, (section) => ({ ...section, text })),
    );
  }

  setSectionSpeaker(id: SectionId, speaker: string | null): SlideNoteEditor {
    return this.#discreteEdit((discrete) =>
      discrete.#editSection(id, (section) => ({ ...section, speaker: speaker || "" })),
    );
  }

  setSectionPrompt(id: SectionId, prompt: string | undefined): SlideNoteEditor {
    return this.#typingEdit((typing) =>
      typing.#editSection(id, ({ prompt: _prompt, ...section }) =>
        prompt ? { ...section, prompt } : section,
      ),
    );
  }

  /** A section carrying no formatting metadata is formatted canonically. */
  addSection(): SlideNoteEditor {
    return this.#discreteEdit((discrete) => discrete.#appendSection());
  }

  #appendSection(): SlideNoteEditor {
    const { activeSlidePosition, mintedSectionCount } = this.#state;
    if (!this.#activeSlide) {
      return this;
    }

    const added: EditorSection = { id: sectionId(mintedSectionCount), speaker: "", text: "" };
    const appended = this.#withSlideSections(activeSlidePosition, (sections) => [
      ...sections,
      added,
    ]);

    return appended.#with({
      activeSectionId: added.id,
      mintedSectionCount: mintedSectionCount + 1,
    });
  }

  deleteSection(id: SectionId): SlideNoteEditor {
    return this.#discreteEdit((discrete) => discrete.#removeSection(id));
  }

  #removeSection(id: SectionId): SlideNoteEditor {
    let nearest: EditorSection | undefined;
    const removed = this.#withSlideSections(this.#slidePositionOf(id), (sections) => {
      const position = sections.findIndex((section) => section.id === id);
      const remaining = sections.filter((section) => section.id !== id);
      nearest = remaining[position] ?? remaining.at(-1);
      return remaining;
    });

    return this.#state.activeSectionId === id
      ? removed.#with({ activeSectionId: nearest?.id })
      : removed;
  }

  undo(): SlideNoteEditor {
    const editor = this.finalizePendingTyping();
    const historyIndex = editor.#state.historyIndex;
    return historyIndex === 0 ? editor : editor.#restore(historyIndex - 1);
  }

  redo(): SlideNoteEditor {
    const editor = this.finalizePendingTyping();
    const { historyIndex, history } = editor.#state;
    return historyIndex >= history.length - 1 ? editor : editor.#restore(historyIndex + 1);
  }

  #restore(historyIndex: number): SlideNoteEditor {
    const state = this.#state;
    const snapshot = state.history[historyIndex]!;
    const sections = snapshot.slides[state.activeSlidePosition]?.sections ?? [];
    const stillPresent = (id: SectionId | undefined) =>
      sections.some((section) => section.id === id);
    const activeSectionId = stillPresent(state.activeSectionId)
      ? state.activeSectionId
      : stillPresent(snapshot.activeSectionId)
        ? snapshot.activeSectionId
        : sections[0]?.id;

    return this.#with({ slides: snapshot.slides, historyIndex, activeSectionId });
  }

  /**
   * Wraps the given selection of the active section, or inserts a self-closing
   * tag at its caret, and reports where the view should put focus afterwards.
   */
  insertSsml({ startTag, endTag = "", selection }: SsmlInsertion): SsmlResult {
    const id = this.#state.activeSectionId;
    const section = this.sections.find((candidate) => candidate.id === id);
    if (!id || !section) {
      return { editor: this, selection: undefined };
    }

    const text = section.text || "";
    const start = Math.min(Math.max(selection.start, 0), text.length);
    const end = Math.min(Math.max(selection.end, start), text.length);
    const tagged =
      text.slice(0, start) + startTag + text.slice(start, end) + endTag + text.slice(end);

    return {
      editor: this.#discreteEdit((discrete) =>
        discrete.#editSection(id, (current) => ({ ...current, text: tagged })),
      ),
      selection: { sectionId: id, start: start + startTag.length, end: end + startTag.length },
    };
  }

  /** Replaces one slide, leaving every other slide's content, dirty state, and history alone. */
  reloadSlide(reloaded: Slide): SlideNoteEditor {
    const position = this.#state.slides.findIndex((slide) => slide.index === reloaded.index);
    if (position === -1) {
      return this;
    }

    const editor = this.finalizePendingTyping();
    const state = editor.#state;
    let mintedSectionCount = state.mintedSectionCount;
    const replacement = toEditorSlide(reloaded, () => sectionId(mintedSectionCount++));
    const substitute = (slides: readonly EditorSlide[]): readonly EditorSlide[] =>
      slides.map((slide, at) => (at === position ? replacement : slide));
    const savedSections = new Map(state.savedSections);
    savedSections.set(
      replacement.index,
      baselineSections(replacement.sections.map(withoutIdentity)),
    );

    return editor.#with({
      slides: substitute(state.slides),
      savedSections,
      mintedSectionCount,
      // The reloaded slide is substituted throughout the history rather than the
      // history being dropped, so undo still reaches unsaved work on other slides
      // but can never restore what PowerPoint has just replaced.
      history: state.history.map((snapshot) => ({
        ...snapshot,
        slides: substitute(snapshot.slides),
      })),
      activeSectionId:
        position === state.activeSlidePosition
          ? replacement.sections[0]?.id
          : state.activeSectionId,
    });
  }

  /** Replaces the whole presentation, keeping the author on their slide when it survived. */
  reloadPresentation(reloaded: readonly Slide[]): SlideNoteEditor {
    const state = this.#state;
    let mintedSectionCount = state.mintedSectionCount;
    const mint = () => sectionId(mintedSectionCount++);
    const slides = reloaded.map((slide) => toEditorSlide(slide, mint));
    const activeIndex = this.#activeSlide?.index;
    const retained = slides.findIndex((slide) => slide.index === activeIndex);
    const activeSlidePosition =
      retained === -1 ? clampSlidePosition(slides, state.activeSlidePosition) : retained;
    const activeSectionId = slides[activeSlidePosition]?.sections[0]?.id;

    return this.#with({
      slides,
      savedSections: baselineOf(slides),
      activeSlidePosition,
      activeSectionId,
      mintedSectionCount,
      // Nothing of the replaced presentation survives to undo back to, which also
      // abandons any open typing group. A view finalizes pending typing before it
      // asks whether to discard, because a declined reload must keep it.
      history: [{ slides, activeSectionId }],
      historyIndex: 0,
      pendingTypingAt: undefined,
    });
  }

  /**
   * Mapping names decide whether a bracketed line is a speaker tag, so changing
   * them changes what existing content means. This is the one place an active
   * session serializes and reparses: current content, saved baselines, and every
   * history snapshot are reinterpreted together, so undo cannot restore sections
   * classified under obsolete names.
   */
  reclassifySpeakerTags(knownSpeakers: Iterable<string>): SlideNoteEditor {
    const speakerNames = [...knownSpeakers];
    if (sameSpeakerNames(this.#state.speakerNames, speakerNames)) {
      return this;
    }

    const editor = this.finalizePendingTyping();
    const state = editor.#state;
    let mintedSectionCount = state.mintedSectionCount;
    /**
     * One section at a time, so a section whose text the author gave a divider
     * line splits into sections of its own without displacing the identities of
     * the sections that follow it.
     */
    const reread = (section: NarrationSection): NarrationSection[] => {
      const [head, ...split] = parseNarrationSections(
        formatNarrationSections([section]),
        speakerNames,
      );
      const separatorBefore = section.format?.separatorBefore;
      return [
        separatorBefore === undefined
          ? head!
          : // Formatting a section alone omits the separator that preceded it.
            { ...head!, format: { ...head!.format, separatorBefore } },
        ...split,
      ];
    };
    const rereadSlide = (slide: EditorSlide): EditorSlide => ({
      ...slide,
      sections: slide.sections.flatMap((section) => {
        const [head, ...split] = reread(withoutIdentity(section));
        return [
          { ...head!, id: section.id },
          ...split.map((extra) => ({ ...extra, id: sectionId(mintedSectionCount++) })),
        ];
      }),
    });

    const slides = state.slides.map(rereadSlide);
    const sections = slides[state.activeSlidePosition]?.sections ?? [];

    return editor.#with({
      slides,
      speakerNames,
      savedSections: new Map(
        [...state.savedSections].map(([index, saved]) => [
          index,
          baselineSections(saved.flatMap(reread)),
        ]),
      ),
      history: state.history.map((snapshot) => ({
        ...snapshot,
        slides: snapshot.slides.map(rereadSlide),
      })),
      activeSectionId: sections.some((section) => section.id === state.activeSectionId)
        ? state.activeSectionId
        : sections[0]?.id,
      mintedSectionCount,
    });
  }

  /**
   * Takes the content of a persistence operation, finalizing pending typing so
   * the submitted content is an undo step of its own. The snapshot is frozen
   * because the author keeps editing while the operation runs: only this content
   * may later be reconciled as saved.
   */
  beginSave(slideNumbers?: readonly number[]): SaveSubmission {
    const editor = this.finalizePendingTyping();
    const submitted = editor.#state.slides.filter(
      (slide) => slideNumbers === undefined || slideNumbers.includes(slide.index),
    );
    const snapshot = new SaveSnapshot(submitted.map(toSnapshotSlide));
    submittedAgainst.set(
      snapshot,
      new Map(
        submitted.flatMap((slide) => {
          const saved = editor.#state.savedSections.get(slide.index);
          return saved ? [[slide.index, saved] as const] : [];
        }),
      ),
    );

    return { editor, snapshot };
  }

  /**
   * Advances the saved baseline of each submitted slide to the snapshot that was
   * committed, and no further. Edits made while the operation ran therefore stay
   * dirty, and a save that never succeeds leaves its content dirty for a retry.
   *
   * A slide whose baseline moved on while the operation ran keeps the newer one,
   * so a completed save can never reinstate content PowerPoint has since replaced.
   */
  saveSucceeded(snapshot: SaveSnapshot): SlideNoteEditor {
    const baselines = submittedAgainst.get(snapshot);
    if (!baselines) {
      return this;
    }

    const savedSections = new Map(this.#state.savedSections);
    for (const slide of snapshot.slides) {
      if (savedSections.get(slide.index) === baselines.get(slide.index)) {
        savedSections.set(slide.index, slide.sections);
      }
    }

    return this.#with({ savedSections });
  }
}
