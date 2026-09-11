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

test("releases the preview URL when playback is stopped, completed, or fails", async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const play = vi
    .spyOn(HTMLMediaElement.prototype, "play")
    .mockResolvedValueOnce()
    .mockResolvedValueOnce()
    .mockRejectedValueOnce(new Error("audio failed"));
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  const revokeObjectUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  const screen = await render(
    <AudioProvider>
      <PlaybackControls />
    </AudioProvider>,
  );

  await screen.getByRole("button", { name: "Play first" }).click();
  await screen.getByRole("button", { name: "Stop" }).click();
  expect(revokeObjectUrl).toHaveBeenCalledWith("blob:first");

  await screen.getByRole("button", { name: "Play second" }).click();
  (play.mock.instances[1] as HTMLMediaElement).dispatchEvent(new Event("ended"));
  expect(revokeObjectUrl).toHaveBeenCalledWith("blob:second");

  await screen.getByRole("button", { name: "Play first" }).click();
  await vi.waitFor(() => expect(play).toHaveBeenCalledTimes(3));
  await vi.waitFor(() => expect(revokeObjectUrl).toHaveBeenCalledWith("blob:first"));
});

test("releases preview URLs when playback is replaced and disposed", async () => {
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  const revokeObjectUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  const screen = await render(
    <AudioProvider>
      <PlaybackControls />
    </AudioProvider>,
  );

  await screen.getByRole("button", { name: "Play first" }).click();
  expect(revokeObjectUrl).not.toHaveBeenCalled();

  await screen.getByRole("button", { name: "Play second" }).click();
  expect(revokeObjectUrl).toHaveBeenCalledWith("blob:first");

  await screen.unmount();
  expect(revokeObjectUrl).toHaveBeenLastCalledWith("blob:second");
});
