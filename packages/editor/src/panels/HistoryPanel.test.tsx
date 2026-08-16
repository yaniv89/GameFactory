import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { HistoryPanel } from "./HistoryPanel";

const revisions = [
  { id: 12, label: undefined, isCheckpoint: false, createdAt: "2026-08-16T12:34:00Z", isCurrent: true },
  { id: 11, label: "Added the cave entrance", isCheckpoint: false, createdAt: "2026-08-16T11:02:00Z", isCurrent: false },
  { id: 8, label: "Before the pack swap", isCheckpoint: true, createdAt: "2026-08-15T09:15:00Z", isCurrent: false },
];

describe("HistoryPanel", () => {
  it("shows the empty-state copy and fires onSaveNow", async () => {
    const onSaveNow = vi.fn();
    render(<HistoryPanel state="empty" onSaveNow={onSaveNow} />);
    expect(screen.getByText("No saved versions yet")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save now" }));
    expect(onSaveNow).toHaveBeenCalledOnce();
  });

  it("lists revisions with their label, a fallback label, and a checkpoint badge, when populated", () => {
    render(<HistoryPanel state="populated" revisions={revisions} />);
    expect(screen.getByText("Revision 12")).toBeInTheDocument();
    expect(screen.getByText("Added the cave entrance")).toBeInTheDocument();
    expect(screen.getByText("Before the pack swap")).toBeInTheDocument();
    expect(screen.getByText("Checkpoint")).toBeInTheDocument();
  });

  it("disables Restore for the current revision but not for others", () => {
    render(<HistoryPanel state="populated" revisions={revisions} />);
    const rows = screen.getAllByRole("button", { name: /Restore/ });
    expect(rows[0]).toBeDisabled(); // revision 12, isCurrent
    expect(rows[1]).toBeEnabled();
    expect(rows[2]).toBeEnabled();
  });

  it("calls onRestore with the clicked revision's id", async () => {
    const onRestore = vi.fn();
    render(<HistoryPanel state="populated" revisions={revisions} onRestore={onRestore} />);
    const rows = screen.getAllByRole("button", { name: /Restore/ });
    await userEvent.click(rows[1]!);
    expect(onRestore).toHaveBeenCalledWith(11);
  });

  it("shows a pending label on the row being restored and disables every Restore button meanwhile", () => {
    render(<HistoryPanel state="populated" revisions={revisions} restoringId={8} />);
    expect(screen.getByRole("button", { name: "Restoring…" })).toBeInTheDocument();
    for (const button of screen.getAllByRole("button", { name: /Restore/ })) {
      expect(button).toBeDisabled();
    }
  });

  it("shows a Load more button only when hasMore is true, and fires onLoadMore", async () => {
    const onLoadMore = vi.fn();
    const { rerender } = render(<HistoryPanel state="populated" revisions={revisions} />);
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();

    rerender(<HistoryPanel state="populated" revisions={revisions} hasMore onLoadMore={onLoadMore} />);
    await userEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(onLoadMore).toHaveBeenCalledOnce();
  });

  it("fires onRetry from the error state", async () => {
    const onRetry = vi.fn();
    render(<HistoryPanel state="error" onRetry={onRetry} />);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
