/**
 * `MemberAllergySection` component tests (M3-T6): the two behaviours this
 * ticket adds on top of the M3-T2 component it extracts unchanged
 * (BACKLOG.md Objective (f) `onSubmitEditing`; the new `showHeading` prop
 * S12 needs). Every gating/toggle behaviour itself is already covered by
 * `allergyGate.test.ts` (the pure logic) and `allergies-screen.test.ts` (S2
 * rendering it) — not re-tested here.
 */
import React from "react";
import { cleanup, fireEvent, render } from "@testing-library/react-native";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildInitialMemberDraft } from "./allergyGate";
import { MemberAllergySection } from "./MemberAllergySection";

afterEach(() => {
  cleanup();
});

const draft = buildInitialMemberDraft({ memberId: "member-maya", displayName: "Maya Chen" });

function noop(): void {}

describe("MemberAllergySection", () => {
  it("the custom-allergen input submits on the keyboard's return key (BACKLOG.md M3-T6 Objective (f))", () => {
    const onAddCustom = vi.fn();
    const result = render(
      React.createElement(MemberAllergySection, {
        draft,
        customInput: "kiwi",
        onToggleAllergen: noop,
        onSetSeverity: noop,
        onToggleNone: noop,
        onCustomInputChange: noop,
        onAddCustom,
      }),
    );
    fireEvent(
      result.getByLabelText("Add another allergen or ingredient for Maya Chen"),
      "submitEditing",
    );
    expect(onAddCustom).toHaveBeenCalledTimes(1);
  });

  it("showHeading defaults true: the member's name renders (S2's own usage)", () => {
    const result = render(
      React.createElement(MemberAllergySection, {
        draft,
        customInput: "",
        onToggleAllergen: noop,
        onSetSeverity: noop,
        onToggleNone: noop,
        onCustomInputChange: noop,
        onAddCustom: noop,
      }),
    );
    expect(result.getByText("Maya Chen")).toBeTruthy();
  });

  it("showHeading: false hides the member's name (S12's per-member edit, the row above it already shows it)", () => {
    const result = render(
      React.createElement(MemberAllergySection, {
        draft,
        customInput: "",
        showHeading: false,
        onToggleAllergen: noop,
        onSetSeverity: noop,
        onToggleNone: noop,
        onCustomInputChange: noop,
        onAddCustom: noop,
      }),
    );
    expect(result.queryByText("Maya Chen")).toBeNull();
  });
});
