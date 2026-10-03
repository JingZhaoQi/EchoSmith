import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ResizeHandle } from "./ResizeHandle";

describe("ResizeHandle", () => {
  it("reports pointer x while dragging, even outside the handle, until the mouse is released", () => {
    const onDrag = vi.fn();
    render(<ResizeHandle label="resize" value={300} onDrag={onDrag} onStep={vi.fn()} onReset={vi.fn()} />);
    fireEvent.mouseDown(screen.getByRole("separator"), { clientX: 300 });
    fireEvent.mouseMove(window, { clientX: 420 });
    fireEvent.mouseUp(window);
    fireEvent.mouseMove(window, { clientX: 500 });
    expect(onDrag).toHaveBeenCalledTimes(1);
    expect(onDrag).toHaveBeenCalledWith(420);
  });

  it("supports arrow keys and double-click reset", () => {
    const onStep = vi.fn();
    const onReset = vi.fn();
    render(<ResizeHandle label="resize" value={50} onDrag={vi.fn()} onStep={onStep} onReset={onReset} />);
    const handle = screen.getByRole("separator");
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    fireEvent.doubleClick(handle);
    expect(onStep.mock.calls).toEqual([[-1], [1]]);
    expect(onReset).toHaveBeenCalled();
  });
});
