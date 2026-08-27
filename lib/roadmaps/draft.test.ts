import { describe, it, expect } from "vitest";
import { mergeDerived, suggestion } from "./draft";

const draft = (over: Partial<Parameters<typeof mergeDerived>[0]> = {}) => ({
  title: "",
  description: "",
  audience: "",
  topics: [] as string[],
  ...over,
});

const derived = {
  title: "Neural Networks from Scratch",
  description: "Build one.",
  topics: ["Deep learning"],
};

describe("mergeDerived", () => {
  it("fills every field the owner left blank", () => {
    expect(mergeDerived(draft(), derived)).toEqual({
      title: "Neural Networks from Scratch",
      description: "Build one.",
      audience: "",
      topics: ["Deep learning"],
    });
  });

  // The whole point of the sheet: it corrects nothing the owner already wrote.
  it("keeps a title the owner wrote", () => {
    const prev = draft({ title: "Karpathy YT Course" });
    expect(mergeDerived(prev, derived).title).toBe("Karpathy YT Course");
  });

  // Whitespace is not a name. A field holding only spaces is blank, and the
  // derived value takes it — otherwise a stray space suppresses the fill forever.
  it("treats a whitespace-only field as blank", () => {
    expect(mergeDerived(draft({ title: "   " }), derived).title).toBe(
      "Neural Networks from Scratch",
    );
    expect(mergeDerived(draft({ description: "  " }), derived).description).toBe("Build one.");
  });

  // Kept verbatim, not trimmed: trimming here would edit the owner's text behind
  // their back while the field is still on screen.
  it("keeps a written title exactly as written", () => {
    expect(mergeDerived(draft({ title: "  Karpathy  " }), derived).title).toBe("  Karpathy  ");
  });

  it("keeps topics the owner picked and takes the derived ones otherwise", () => {
    expect(mergeDerived(draft({ topics: ["Math"] }), derived).topics).toEqual(["Math"]);
    expect(mergeDerived(draft(), derived).topics).toEqual(["Deep learning"]);
  });

  // The derive never sees the audience — only the owner knows who it is for —
  // so the merge has nothing to offer and must pass it through untouched.
  it("never touches the audience", () => {
    expect(mergeDerived(draft({ audience: "Assumes Python" }), derived).audience).toBe(
      "Assumes Python",
    );
  });

  it("does not mutate the previous draft", () => {
    const prev = draft({ title: "Kept" });
    mergeDerived(prev, derived);
    expect(prev).toEqual(draft({ title: "Kept" }));
  });
});

describe("suggestion", () => {
  // Offered only when the merge refused the derived title — i.e. the owner had
  // already named the course. On a blank title the merge applied it, so there is
  // nothing left to suggest.
  it("offers the derived title when the owner's title was kept", () => {
    expect(suggestion("Karpathy YT Course", "Neural Networks from Scratch")).toBe(
      "Neural Networks from Scratch",
    );
  });

  it("offers nothing when the course opened unnamed", () => {
    expect(suggestion("", "Neural Networks from Scratch")).toBeNull();
    expect(suggestion("   ", "Neural Networks from Scratch")).toBeNull();
  });

  it("offers nothing when the derive returned no title", () => {
    expect(suggestion("Karpathy YT Course", "")).toBeNull();
    expect(suggestion("Karpathy YT Course", "  ")).toBeNull();
  });

  // Compared trimmed on both sides: a suggestion that differs only in whitespace
  // reads as identical to the field above it, and offering it looks broken.
  it("offers nothing when the titles differ only in whitespace", () => {
    expect(suggestion("Karpathy YT Course", "  Karpathy YT Course  ")).toBeNull();
    expect(suggestion("  Karpathy YT Course  ", "Karpathy YT Course")).toBeNull();
  });

  // Returned untrimmed: what is offered is exactly what the "Use this" button
  // writes into the field, so the two cannot disagree.
  it("returns the derived title verbatim", () => {
    expect(suggestion("Karpathy", "  Neural Networks  ")).toBe("  Neural Networks  ");
  });
});
