import { describe, expect, it } from "vitest";
import {
  INITIAL_OPERATION_STATE,
  reduceOperation,
  type OperationState,
} from "./useViewerOperation";

const running: OperationState = { owner: "saveSlide", running: true, status: "Saving..." };

describe("reduceOperation", () => {
  it("takes ownership when an operation starts", () => {
    expect(
      reduceOperation(INITIAL_OPERATION_STATE, {
        type: "started",
        owner: "saveSlide",
        status: "Saving...",
      }),
    ).toEqual(running);
  });

  it("lets a new operation take ownership from a finished one", () => {
    const finished = reduceOperation(running, { type: "finished", owner: "saveSlide" });

    expect(
      reduceOperation(finished, {
        type: "started",
        owner: "reloadSlide",
        status: "Reloading...",
      }),
    ).toEqual({ owner: "reloadSlide", running: true, status: "Reloading..." });
  });

  it("updates the status of the owning operation", () => {
    expect(
      reduceOperation(running, { type: "status", owner: "saveSlide", status: "Synthesizing..." }),
    ).toEqual({ owner: "saveSlide", running: true, status: "Synthesizing..." });
  });

  it("stops running while retaining the reported outcome", () => {
    expect(reduceOperation(running, { type: "finished", owner: "saveSlide" })).toEqual({
      owner: "saveSlide",
      running: false,
      status: "Saving...",
    });
  });

  it("returns to the initial state when the owner clears its status", () => {
    expect(reduceOperation(running, { type: "cleared", owner: "saveSlide" })).toEqual(
      INITIAL_OPERATION_STATE,
    );
  });

  it.each(["status", "finished", "cleared"] as const)(
    "ignores a %s action from an operation that is not the owner",
    (type) => {
      expect(reduceOperation(running, { type, owner: "reloadSlide", status: "Reloading..." })).toBe(
        running,
      );
    },
  );
});
