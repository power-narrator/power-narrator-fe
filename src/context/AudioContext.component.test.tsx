import { afterEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { AudioProvider } from "./AudioContext";
import { useAudio } from "./useAudio";

function PlaybackControls() {
  const { play, stop } = useAudio();
  return (
    <>
      <button onClick={() => play("first", "blob:first")}>Play first</button>
      <button onClick={() => play("second", "blob:second")}>Play second</button>
      <button onClick={stop}>Stop</button>
    </>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

async function renderPlayback() {
  const audioElements: HTMLAudioElement[] = [];
  const NativeAudio = window.Audio;
  vi.spyOn(window, "Audio").mockImplementation(function (...args) {
    const audio = new NativeAudio(...args);
    audioElements.push(audio);
    return audio;
  });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  const revokeObjectUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  const screen = await render(
    <AudioProvider>
      <PlaybackControls />
    </AudioProvider>,
  );

  /** Earlier elements had their listeners removed, so the newest is the live one. */
  const activeAudio = () => audioElements[audioElements.length - 1];

  return { activeAudio, revokeObjectUrl, screen };
}

test("releases the preview URL when playback is stopped", async () => {
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  const { revokeObjectUrl, screen } = await renderPlayback();

  await screen.getByRole("button", { name: "Play first" }).click();
  await screen.getByRole("button", { name: "Stop" }).click();

  expect(revokeObjectUrl).toHaveBeenCalledWith("blob:first");
});

test("releases the preview URL when playback ends", async () => {
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  const { activeAudio, revokeObjectUrl, screen } = await renderPlayback();

  await screen.getByRole("button", { name: "Play first" }).click();
  activeAudio()?.dispatchEvent(new Event("ended"));

  expect(revokeObjectUrl).toHaveBeenCalledWith("blob:first");
});

test("releases the preview URL when playback fails to start", async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockRejectedValue(new Error("audio failed"));
  const { revokeObjectUrl, screen } = await renderPlayback();

  await screen.getByRole("button", { name: "Play first" }).click();

  await vi.waitFor(() => expect(revokeObjectUrl).toHaveBeenCalledWith("blob:first"));
});

test("releases the previous preview URL when playback is replaced", async () => {
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  const { revokeObjectUrl, screen } = await renderPlayback();

  await screen.getByRole("button", { name: "Play first" }).click();
  expect(revokeObjectUrl).not.toHaveBeenCalled();

  await screen.getByRole("button", { name: "Play second" }).click();

  expect(revokeObjectUrl).toHaveBeenCalledWith("blob:first");
});

test("releases the preview URL when the provider is disposed", async () => {
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  const { revokeObjectUrl, screen } = await renderPlayback();

  await screen.getByRole("button", { name: "Play second" }).click();
  await screen.unmount();

  expect(revokeObjectUrl).toHaveBeenLastCalledWith("blob:second");
});
