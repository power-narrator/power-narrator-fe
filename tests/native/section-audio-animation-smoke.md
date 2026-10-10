# Section audio identity and animation smoke check

Status: **pending**. Run against the user's rebuilt `electron/scripts/ppt-tools.ppam`, imported from the updated `ppt-tools.bas`, after restarting PowerPoint. Automated provider and narrated-save checks do not execute VBA or prove native persistence. The bundled add-in has not been rebuilt or verified as part of this source change.

Use a disposable three-slide presentation with one nonempty first note section on slides 1 and 2. Save a copy before each failure scenario. Keep slide 3 outside Save Slide's scope, with its own section audio and unrelated content, and record its names and animation settings for comparison.

## Insert without damaging same-named content

1. On slide 1, create a text box named exactly `ppt_audio_1` in the Selection Pane. Add a Fade animation with an On Click start and a 0.25-second delay. Confirm there is no section audio yet.
2. On slide 2, insert an unrelated video, also named exactly `ppt_audio_1`. Give it a play effect with a different start and delay, and record those values. Using the same name as a sound shape does not make a video app-owned section audio.
3. Load the presentation in Power Narrator. Both note sections should load unchecked despite the names. Enable Play Across Slides on slide 1 and use Save Slide. Confirm its text box and Fade remain, with the original start and delay, and that one sound shape named `ppt_audio_1` was inserted. Slides 2 and 3 should remain unchanged.
4. Save slide 2 with Play Across Slides disabled. Confirm the video and its original animation remain and the new sound shape is disabled. Check each sound's Playback ribbon checkbox by selecting the actual audio, using its icon/media type rather than its shared name.

## Replace and apply playback while preserving timing

1. In PowerPoint's Animation Pane, arrange slide 1's Fade before the section audio's play effect. Set the Fade to On Click after 0.25 seconds and the audio to With Previous after 1.5 seconds. Put another distinct animated shape after the audio. Record the effect order, start triggers, and delays for the whole slide. On slide 2, place the video's play effect before the sound's play effect and give them distinct starts and delays.
2. Enable slide 1 audio with a custom cross-slide span such as 7 in the play effect's settings. Reload Slide in the app and confirm the checkbox is checked.
3. Change the first note section's text and save it with Play Across Slides checked, forcing audio replacement. Confirm the Fade still targets the same text box; the video on slide 2 is untouched. Slide 1's replacement audio must occupy the prior audio position with the same With Previous start and 1.5-second delay. All other recorded animations must retain order, triggers, and delays. In PowerPoint, confirm Play Across Slides is enabled and its stop-after span is now 999.
4. Save slide 2 with changed text and Play Across Slides enabled. Confirm only its sound is replaced; the original video, video play effect, and recorded timing survive. Confirm the audio uses span 999 with PlayOnEntry enabled and PauseAnimation disabled.
5. Disable each audio through the app and save again. Confirm each sound's Play Across Slides checkbox is cleared and stop-after span is 0. The same animation order, triggers, and delays must survive this replacement too. Test a slideshow across adjacent slides to confirm disabled audio stops when leaving its slide.
6. Save, close, and reopen the deck in PowerPoint, then reload in Power Narrator. Check both the native checkbox and app values, and compare the recorded animation order, triggers, and delays again. Repeat with enabled audio to confirm both states persist.

## Ownership, scope, and ambiguity

1. Empty the note section on slide 1 and Save Slide. Its sound should be removed while the text box and Fade remain. Repeat on slide 2: its video and video animation must remain. Slide 3 must still match the recorded baseline. Repeat with a removed note section in a deck containing multiple note sections to cover obsolete audio cleanup while another section remains nonempty.
2. In a fresh disposable copy, create two actual sound shapes named `ppt_audio_1` on a slide. Load/reload must report duplicate section audio explicitly. Saving that slide must also fail explicitly instead of choosing either sound. Keep this distinct from a text box or video sharing the name, which must succeed.

Record the date, PowerPoint version, rebuilt add-in/source revision, and outcomes here or in the issue tracker. Until this procedure has been run against the rebuilt add-in, native insertion, replacement, animation preservation, and save/reopen persistence remain **pending**.
