# Hand-built deck

`hand-built-deck.pptx` was built by hand in PowerPoint for Mac's own UI, following this recipe. It is
the ground truth for reading the Play Across Slides checkbox, the source of the supported and
unsupported audio setups that the native load, replace and refused-save cases need, and it has a
clean slide for saving new section audio. It is the only fixture deck for native cases, and the
end-to-end tests copy it when they only need a real file.

`tests/native/handBuiltDeck.test.ts` checks, through the saved-presentation inspector, that the deck
holds what this recipe says: slides and notes, section audio, other media, `Box` and `Button`, and
which effects target which shapes with their triggers. It cannot check the checkboxes, which only
PowerPoint can read.

To change the deck, rebuild or edit it in PowerPoint's UI by this recipe, update the recipe and the
fixture test with it, and never let the app save audio into it: its shapes and animations must come
from PowerPoint's UI, not VBA, AppleScript or the app.

## Before you start

Make four short, distinct audio clips, with clip 2 the longest. The checked-in deck uses MP3s made
by the app; only the files were taken from it, and they were inserted by hand as described below.
Clips made with `say` work as well:

```sh
mkdir -p ~/Desktop/deck-clips && cd ~/Desktop/deck-clips
say -o clip1.m4a --data-format=aac "Section one"
say -o clip2.m4a --data-format=aac "Section two, a little longer than one"
say -o clip3.m4a --data-format=aac "Section three"
say -o music.m4a --data-format=aac "Not section audio"
```

Create a new blank presentation (16:9, Office theme) with five slides, using the Title Only layout.

How to do the common steps:

- **Insert audio:** Insert > Audio > Audio from File.
- **Rename a shape:** Arrange > Selection Pane, double-click the name, type the exact name, press
  Return. Names are case-sensitive and have no leading zeros.
- **Play Across Slides and volume:** these are on the Playback tab with the audio selected.
- **Animations:** open the Animation Pane from the Animations tab.

When inserting audio, PowerPoint usually adds one Play effect for it. Where a step says "no
animation", delete it in the Animation Pane.

## Slide 1: Load

- **Title:** `Load`.
- **Notes**, typed exactly as two lines:
  ```
  First line of slide one.
  Café — naïve “quotes” 日本語
  ```
- **`ppt_audio_1`** from clip 1: keep its Play effect. Tick **Play Across Slides**.
- **`ppt_audio_2`** from clip 2: keep its Play effect. Leave **Play Across Slides** unticked.
- **`ppt_audio_3`** from clip 3:
  1. Tick **Play Across Slides**.
  2. Then delete its Play effect in the Animation Pane, so it has no animation at all. In the
     checked-in deck the tick stayed set after the effect was deleted; a cleared tick is fine too.

## Slide 2: Replace main sequence

- **Title:** `Replace main`.
- **Notes:** `Slide two notes.`
- **A rectangle** named `Box`, with no text and a **Fade** entrance effect.
- **`ppt_audio_1`** from clip 1:
  1. Leave Play Across Slides unticked and set **Volume** to **Low**.
  2. Add a **Pause** and a **Stop** media effect (Animations > Add Animation, under Media).
  3. In the Animation Pane, put these in the order `ppt_audio_1` Play, `Box` Fade, `ppt_audio_1`
     Pause, `ppt_audio_1` Stop.
  4. Set the Play to **Start: After Previous**. Leave the other three on their defaults.
- **`ppt_audio_2`** from clip 2: keep its Play effect, then tick **Play Across Slides** and set
  **Volume** to **Mute**.
- **`ppt_audio_3`** from clip 3: keep its Play effect and leave the box unticked. This is the
  obsolete section that the replace case removes.
- **`ppt_audio_01`** from the music clip: keep its Play effect. The leading zero means it is _not_
  section audio, although its name looks like it is. Every save must leave it alone. Type the name
  exactly, with the zero.
- **Final order.** Once everything is inserted, arrange the Animation Pane so the main sequence is
  exactly these seven effects, top to bottom:
  1. `ppt_audio_1` Play
  2. `Box` Fade
  3. `ppt_audio_1` Pause
  4. `ppt_audio_1` Stop
  5. `ppt_audio_3` Play
  6. `ppt_audio_01` Play
  7. `ppt_audio_2` Play

  `ppt_audio_2` comes last, after the obsolete section and the audio that isn't section audio, so
  the replace case shows whether its Play keeps its place behind both.

## Slide 3: Replace click triggers

- **Title:** `Replace triggers`.
- **Notes:** `Slide three notes.`
- **A rounded rectangle** named `Button` with the text `Play`.
- **`ppt_audio_1`** from clip 1:
  1. Tick **Play Across Slides**.
  2. Select its Play effect and choose Animations > Trigger > On Click of > `Button`.
  3. In the Animation Pane, the `Button` trigger group must contain only this one Play effect, and
     no main-sequence effect may remain for `ppt_audio_1`.
- **`ppt_audio_2`** from clip 2:
  1. Leave **Play Across Slides** unticked.
  2. Set its Play effect's trigger to On Click of > `ppt_audio_2`, which is itself.
  3. That trigger group must contain only this Play effect.

## Slide 4: Refused save

- **Title:** `Refused`.
- **Notes:** `Slide four notes.`
- **`ppt_audio_1`** from clip 1: keep its Play effect, leave the box unticked, and on the Playback
  tab set **Fade In** to `01.00`.

## Slide 5: Clean

- **Title:** `Clean`.
- **Notes:** `Slide five notes.`
- Nothing else: no audio, no other shapes and no animation. Saving new section audio and the failure
  part-way through both start from this slide.

## Save and check

1. Save as **PowerPoint Presentation (.pptx)** to `tests/fixtures/hand-built-deck.pptx`.
2. Close the deck, reopen it and check that:
   - on slide 1, `ppt_audio_1` is ticked, `ppt_audio_2` is unticked, and `ppt_audio_3` has no
     animation;
   - on slide 2, `ppt_audio_2` is ticked;
   - on slide 3, `ppt_audio_1` is ticked;
   - slide 5 has only its title and no animation;
   - every name in the Selection Pane matches exactly.
3. Close it without saving again.
4. Run `pnpm exec vitest run --project unit tests/native/handBuiltDeck.test.ts`.
