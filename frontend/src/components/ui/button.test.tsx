import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Button } from "./button";

describe("Button press feedback", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps visual pressed feedback briefly after a fast click", () => {
    vi.useFakeTimers();
    render(<Button>反馈</Button>);

    const button = screen.getByRole("button", { name: "反馈" });

    fireEvent.pointerDown(button);
    expect(button).toHaveAttribute("data-pressing", "true");

    fireEvent.pointerUp(button);
    expect(button).toHaveAttribute("data-pressing", "true");

    act(() => vi.advanceTimersByTime(139));
    expect(button).toHaveAttribute("data-pressing", "true");

    act(() => vi.advanceTimersByTime(1));
    expect(button).not.toHaveAttribute("data-pressing");
  });

  it("does not show pressed feedback when disabled", () => {
    render(<Button disabled>反馈</Button>);

    const button = screen.getByRole("button", { name: "反馈" });
    fireEvent.pointerDown(button);

    expect(button).not.toHaveAttribute("data-pressing");
  });
});
