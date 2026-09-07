import { afterEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { AudioProvider } from "./AudioContext";
import { useAudio } from "./useAudio";

function PlaybackControls() {
  const { play } = useAudio();
  return (
    <>
      <button onClick={() => play("first", "blob:first")}>Play first</button>
      <button onClick={() => play("second", "blob:second")}>Play second</button>
    </>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
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
