import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RichDialogueText } from "./RichDialogueText";

describe("RichDialogueText", () => {
  it("renders *emphasis*, **strong**, and `code` as real elements", () => {
    const { container } = render(<RichDialogueText text="Rooms are *two gold* a night — see the **innkeeper** for a `key`." />);
    expect(container.querySelector("em")).toHaveTextContent("two gold");
    expect(container.querySelector("strong")).toHaveTextContent("innkeeper");
    expect(container.querySelector("code")).toHaveTextContent("key");
    expect(container.innerHTML).not.toContain("*");
  });

  it("renders an allowlisted-scheme link as a real anchor with a safe target", () => {
    render(<RichDialogueText text="Visit [our shop](https://example.com/shop) for supplies." />);
    const link = screen.getByRole("link", { name: "our shop" });
    expect(link).toHaveAttribute("href", "https://example.com/shop");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("degrades a rejected link scheme to its own text and never emits an anchor or a script", () => {
    const { container } = render(<RichDialogueText text="Click [here](javascript:alert(1)) now." />);
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container).toHaveTextContent("Click here now.");
  });

  it("never renders raw markup as HTML — plain text stays plain text", () => {
    const { container } = render(<RichDialogueText text="<script>alert(1)</script>" />);
    expect(container.querySelector("script")).toBeNull();
    expect(container).toHaveTextContent("<script>alert(1)</script>");
  });

  it("renders blank-line-separated paragraphs with a line break between them", () => {
    const { container } = render(<RichDialogueText text={"First line.\n\nSecond line."} />);
    expect(container.querySelectorAll("br")).toHaveLength(1);
    expect(container).toHaveTextContent("First line.Second line.");
  });
});
