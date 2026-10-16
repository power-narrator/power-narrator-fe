# Mac PowerPoint audio: API research

What we found about changing Play Across Slides and copying audio animations with VBA on Mac PowerPoint 16.105.3 (build 0201), tested on 2026-10-16. The decision built on these findings is [ADR 0006](../adr/0006-play-across-slides-is-a-boolean.md).

Every finding comes from automating PowerPoint itself, then saving, reopening and comparing the saved presentation. The XML was only read for comparison, never edited. The findings describe what happened in the tested presentations; other PowerPoint versions or animation setups may differ. What was not tested is listed under [Evidence limits](#evidence-limits).

## Summary

- Setting playback through `StopAfterSlides`, by any API, damages unrelated animations on the slide.
- Clicking the Ribbon checkbox with `ExecuteMso "MediaClipPlayAcrossSlides"` changes playback without that damage, and `GetPressedMso` reads it. Both need an active editing window in Normal view with the audio selected.
- `PickupAnimation` / `ApplyAnimation` copy an audio's animations, including its playback setting, onto a replacement. Effect order, volume, mute and geometry must be restored separately. A Play started by clicking another shape must be rebuilt.
- Changing the checkbox changes the stored Play duration, which moves later After Previous animations. See [Saved Play duration](#saved-play-duration).
- The checkbox is the only reliable reading of the setting; numeric getters and legacy flags disagree with it.

Terms used below:

- **Helper**: a hidden presentation created with `Presentations.Add(msoFalse)`.
- **Painting**: copying animations with `PickupAnimation` / `ApplyAnimation`.
- **Enclosing condition**: the start delay stored on the group that contains an effect, rather than on the effect itself.

## Alternatives investigated

| Approach                                                                   | Result                                                                                                                                                                                                    |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Assigning the effect's `PlaySettings.StopAfterSlides`                      | Any real change, in either direction, damaged unrelated ink replay, fade animations and some triggers, even when assigned before moving effects. Reassigning the current value did no harm.               |
| Legacy `Shape.AnimationSettings.PlaySettings`, including creating playback | Same damage.                                                                                                                                                                                              |
| AppleScript effect and legacy setters                                      | Same damage.                                                                                                                                                                                              |
| Replacing the whole `PlaySettings` object                                  | Not possible: `EffectInformation.PlaySettings` is read-only.                                                                                                                                              |
| `Set existingEffect.Shape = replacement`                                   | Runtime error 438; an effect cannot be moved to another shape.                                                                                                                                            |
| Configure audio on a temporary slide, then copy/paste or paint it back     | Unrelated effects and playback survived, but the presentation temporarily gained a slide.                                                                                                                 |
| Configure audio in a helper, then paint it back                            | No extra slide and unrelated effects survived, but the setter still reset the helper audio's own settings and could drop its effects or triggers.                                                         |
| Copy existing animations by painting                                       | Kept the existing playback and custom effects without any setter. See [Animation-copying findings](#animation-copying-findings).                                                                          |
| Rebuild effects after configuring a helper                                 | Worked for the tested Play/Pause/Stop, self-click and external-button setups, with small saved timing differences. See [Restoration findings](#restoration-and-trigger-api-findings).                     |
| `ExecuteMso "MediaClipPlayAcrossSlides"`                                   | Changed playback both ways, survived reopening, and kept unrelated effects and more audio settings than the numeric setter. Changes some stored timing. See [Ribbon findings](#ribbon-checkbox-findings). |

## Animation-copying findings

`PickupAnimation` copies a shape's animations and `ApplyAnimation` pastes them onto another shape. The old audio's settings came across without restoring any timing afterwards.

| What                                  | Result                                                                                                                                                                                                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Playback and main-sequence effects    | The playback setting, delays, repeats, repeat duration, rewind and Play/Pause/Stop order survived copying and reopening. The playback setting travels with the animation, so copying cannot change it.                                                       |
| Self-click Play                       | After the old audio was deleted and the presentation reopened, the trigger pointed at the replacement, and custom timing survived.                                                                                                                           |
| Position among other shapes' effects  | Successful runs put effects back with `MoveTo`. Whether `ApplyAnimation` alone keeps their position is unknown.                                                                                                                                              |
| Volume, mute and geometry             | Successful runs copied these separately. Whether `ApplyAnimation` copies them is unknown.                                                                                                                                                                    |
| Plain replacement with no delay       | One enclosing condition went from 0 to 1 ms, although per-effect VBA timing looked unchanged and saving alone kept 0. Copying is not exact at the level of the saved timing tree.                                                                            |
| Play started by another shape's click | Copying moved the button's Play into the main sequence. Rebuilding it on the target slide works (see [Restoration findings](#restoration-and-trigger-api-findings)). Shape references still resolved, so checking references alone does not reveal the loss. |

A fractional repeat count was already rounded while preparing the test presentation, so copying fractional values is untested.

Copying animations into a helper before changing `StopAfterSlides` does not protect them. The setter still reset the helper's delay and repeat duration to zero, the repeat count to its default and rewind to off, and could drop Pause/Stop effects. When a self-click effect vanished, `ApplyAnimation` could fail with Invalid request. The loss happened inside the helper, before anything was copied back.

## Restoration and trigger API findings

These cover rebuilding an audio's own effects after a helper setter reset them, which is separate from copying unchanged animations.

| API or approach                                                          | Result                                                                                                                                                                                             |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Main Play `Timing` setters                                               | Restored lost custom timing. Restoring it in the helper did not always keep enclosing conditions once moved into a differently grouped target sequence.                                            |
| Order of `MoveTo` and `Timing`                                           | Moving first and then restoring `Timing` fixed an enclosing-condition mismatch that the reverse order left.                                                                                        |
| Behavior duration                                                        | `Timing` alone did not restore every behavior duration. Also restoring the behavior duration fixed a self-click command difference.                                                                |
| Re-adding Pause/Stop after setting playback                              | Kept the playback setting; no whole-animation copy was needed.                                                                                                                                     |
| Setting a MediaPlay effect's `Timing.TriggerShape` to a button           | Invalid request. A `Set` assignment gave runtime error 438.                                                                                                                                        |
| `AddTriggerEffect`                                                       | Missing from the Mac type library; a late-bound call gave runtime error 438.                                                                                                                       |
| Making an existing main Play self-click via `TriggerType`/`TriggerShape` | Invalid request. Adding a separate click-triggered Play after configuring the main Play worked.                                                                                                    |
| External trigger on an Appear effect, then `EffectType` = MediaPlay      | Works on the target slide: the button and Play command are kept, and references survive deleting the old audio and reopening. Done in a helper and painted back, the Play lost its click sequence. |

Most rebuilt cases matched the original saved state exactly. The rest kept a 1 ms enclosing-condition shift, or stored an explicit zero repeat duration on mixed main/click effects. Whether those differences play identically in a slideshow is untested.

## Ribbon checkbox findings

The control is `MediaClipPlayAcrossSlides`. `Application.CommandBars.ExecuteMso` clicks it and `GetPressedMso` reads it. Five guessed identifiers returned error 5 because they were wrong, not because CommandBars was unavailable.

The calls need an active editing window in Normal view with the audio selected; switching to the Playback tab is unnecessary. They read global UI state, so with nothing or a non-audio shape selected, the disabled control can report False. A hidden presentation has no window and cannot be used. `GetEnabledMso` and `GetVisibleMso` report availability separately from the checked state, and an invalid identifier gives error 5.

Toggles survived reopening, and kept unrelated ink/fade effects, other media, geometry, references and slide structure. Custom Play/Pause/Stop, self-click and external-button setups survived toggling existing audio. Replacing audio and then toggling was later verified through the add-in's save path.

Toggling also changed these stored values:

| Stored value          | Change                                                                       |
| --------------------- | ---------------------------------------------------------------------------- |
| Play command duration | 3888 → 1 ms or 5016 → 1 ms (see [Saved Play duration](#saved-play-duration)) |
| Enclosing delay       | 5016 → 5000 ms                                                               |
| Enclosing conditions  | Shifts of 1–2 ms                                                             |

These are animation timing values, not the audio file's length. When the checkbox already matched and was not clicked, the saved state stayed exactly the same. Reading the checkbox, even many times in a row, changed nothing. Normal and Slide Sorter view were restored afterwards; text selections, multiple selections, other window layouts and slideshow mode are untested.

### Saved Play duration

PowerPoint stores a duration on each audio Play command. Later After Previous animations in the same sequence start after it, so their stored delays move by the same amount. In one tested slide, a 2304 ms clip moved the following delays from 375 to 2679 ms and from 1623 to 3927 ms.

| Action                                           | Stored Play duration | Later After Previous animations |
| ------------------------------------------------ | -------------------- | ------------------------------- |
| Checking the box, by hand or with `ExecuteMso`   | 1 ms                 | Start right after the Play      |
| Unchecking the box by hand                       | Unchanged            | Move by at most 1 ms            |
| Adding or replacing audio that ends up unchecked | The clip length      | Wait for the clip to finish     |

Checking by hand and checking through the add-in saved identical timing, apart from the replaced audio's shape ids. PowerPoint does not remember the clip length once the box is checked: a Play stored at 2304 ms, checked by hand (1 ms) and then unchecked by hand stayed at 1 ms. The add-in always replaces section audio on save, so every unchecked section gets the clip length, as PowerPoint gives any newly animated audio that does not play across slides. This is intended, even though it differs from unchecking by hand. Audio that an earlier add-in stored at 1 ms while unchecked gets the clip length the next time it is saved.

## Playback-state API findings

| API or state                                  | Result                                                                                                                                                       |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `StopAfterSlides` getter                      | For unchecked audio, one object path returned 83 and another returned 0. Holding a typed reference did not reliably fix it.                                  |
| Checked box versus slide limit                | The box was checked with several finite slide limits as well as PowerPoint's default. Checked does not mean unlimited playback or automatic start.           |
| `PlayOnEntry=False`                           | Removed the Play timing. The box stayed checked until reopening, then showed unchecked. Setting it through a helper gave Invalid request in another attempt. |
| `PauseAnimation=True` with `PlayOnEntry=True` | The box stayed checked. The getter returned -1 straight away and 0 after reopening, with the saved state unchanged.                                          |
| Click-only Play                               | Stayed checked after reopening while reporting `PlayOnEntry=0` and `PauseAnimation=-1`.                                                                      |

The flags and the checkbox do not map onto each other across animation setups. A checked box also does not prove a valid Play effect still exists.

## Other command routes examined

| Route                                                   | Outcome                                                                                                                                |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Play in Background                                      | Also starts the audio automatically, so it does more than the checkbox. Its effect on other animations was not compared.               |
| `ActivateTabMso`                                        | Belongs to `IRibbonUI`, not CommandBars, and is reachable only through a customUI onLoad callback. Untested.                           |
| `CommandBars.FindControl` / `CommandBarControl.Execute` | Would work only if the checkbox were exposed in that collection, which was not shown. A workbook Policy ID is not a usable control ID. |
| Accessibility automation                                | Its effect on other animations was not compared.                                                                                       |

## Evidence limits

The comparisons covered the saved timing tree, shape and timing references, media properties, geometry, unrelated effects and presentation structure. Per-effect VBA timing alone missed some enclosing-condition changes.

Untested:

- other effects on the audio, shared triggers, and other shapes' effects triggered by the audio;
- stacking order, trims, bookmarks, fades, and replacement media shorter than the original;
- slideshow playback. Attempts started media and advanced slides, but reading the first slide's player afterwards failed with AppleScript error -1700 whether or not the box was checked. Whether audio is actually heard across slides, how slides look, and whether custom triggers fire are unverified.

## Published API references

Microsoft's [Mac supported identifier list](https://learn.microsoft.com/en-us/office/vba/office-mac/idmsopowerpointmac) includes `MediaClipPlayAcrossSlides`. The [official Fluent identifier repository](https://github.com/OfficeDev/office-fluent-ui-command-identifiers/tree/b230a0df45036b2d5e8b49ebf368b3f90ada8d63) lists it as a checkbox in the Office 2016 and Microsoft 365 Current Channel PowerPoint workbooks at that revision. These listings do not guarantee every installed build behaves the same.

[ExecuteMso](https://learn.microsoft.com/en-us/office/vba/api/office.commandbars.executemso) is documented for buttons, toggle buttons and split buttons, and [GetPressedMso](https://learn.microsoft.com/en-us/office/vba/api/office.commandbars.getpressedmso) for toggle buttons; their use on this checkbox rests on the native tests above. [GetEnabledMso](https://learn.microsoft.com/en-us/office/vba/api/office.commandbars.getenabledmso) and [GetVisibleMso](https://learn.microsoft.com/en-us/office/vba/api/office.commandbars.getvisiblemso) report availability.

The [StopAfterSlides reference](https://learn.microsoft.com/en-us/office/vba/api/powerpoint.playsettings.stopafterslides) describes a writable slide limit and makes no promise about other animations. [EffectInformation.PlaySettings](https://learn.microsoft.com/en-us/office/vba/api/powerpoint.effectinformation.playsettings) is read-only. The [Play in Background instructions](https://support.microsoft.com/en-us/powerpoint/play-music-across-multiple-slides-in-your-slide-show-in-powerpoint) describe its wider behavior.
