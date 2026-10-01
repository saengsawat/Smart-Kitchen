/**
 * S12 component tests, HTTP path (BACKLOG.md M3-T6), `app/profile.tsx`
 * against a real `HttpApiClient` with a mocked global `fetch` (never a real
 * network call) -- the counterpart to `profile-screen.test.ts`'s fixture
 * path, same file-split reasoning as `account-screen-http.test.ts` /
 * `account-screen.test.ts`.
 */
import React from "react";
import { cleanup, fireEvent, render } from "@testing-library/react-native";
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPending } from "../test-support/flush";
import { ToastProvider } from "../inventory/Toast";

// Forces the screen (which imports the module-level `apiClient` singleton
// directly) onto a real HttpApiClient for this file, same pattern as
// account-screen-http.test.ts / item-detail-screen.test.ts.
vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return { ...actual, apiClient: new actual.HttpApiClient("http://localhost:4000") };
});

let replaced: unknown[] = [];

vi.mock("expo-router", () => ({
  useRouter: () => ({
    push: () => {},
    replace: (href: unknown) => replaced.push(href),
    canGoBack: () => false,
    back: () => {},
  }),
}));

const originalFetch = globalThis.fetch;

afterEach(() => {
  cleanup();
  replaced = [];
  globalThis.fetch = originalFetch;
});

async function renderScreen(): Promise<ReturnType<typeof render>> {
  const { default: ProfileScreen } = await import("../../app/profile");
  const result = render(
    React.createElement(ToastProvider, null, React.createElement(ProfileScreen)),
  );
  await flushPending();
  return result;
}

const DEAN_IS_CALLER = {
  householdId: "hh-chen",
  name: "The Chens",
  members: [
    { memberId: "mem-dean", displayInitials: "DC", role: "owner", isCaller: true },
    { memberId: "mem-maya", displayInitials: "MC", role: "member", isCaller: false },
  ],
};

const MAYA_IS_CALLER = {
  ...DEAN_IS_CALLER,
  members: DEAN_IS_CALLER.members.map((m) => ({ ...m, isCaller: m.memberId === "mem-maya" })),
};

/** `GET /v1/households/me` always answers `household`; every other route the given handler decides. */
function fetchRouter(
  household: unknown,
  handler?: (url: string, init: RequestInit | undefined) => Response,
): typeof fetch {
  return ((url: string, init?: RequestInit) => {
    if (!init || init.method === undefined) {
      return Promise.resolve(new Response(JSON.stringify(household), { status: 200 }));
    }
    if (handler) {
      return Promise.resolve(handler(url, init));
    }
    return Promise.resolve(new Response(JSON.stringify({}), { status: 500 }));
  }) as typeof fetch;
}

describe("S12 · profile & household, HTTP path", () => {
  it("the card shows initials, role and household name -- never an email or a made-up name", async () => {
    globalThis.fetch = fetchRouter(DEAN_IS_CALLER);
    const result = await renderScreen();

    expect(result.getByText("owner · The Chens")).toBeTruthy();
    expect(result.queryByText(/@/)).toBeNull();
    expect(result.queryByText("Dean Chen")).toBeNull();
  });

  it("members render by initials (fixture shows names; HTTP shows initials, M2-T3)", async () => {
    globalThis.fetch = fetchRouter(DEAN_IS_CALLER);
    const result = await renderScreen();

    expect(result.getByLabelText(/^DC,/)).toBeTruthy();
    expect(result.getByLabelText(/^MC,/)).toBeTruthy();
  });

  it("editing MC's (Maya) allergies changes only her row, and only her memberId is sent (review round 1, F1)", async () => {
    globalThis.fetch = fetchRouter(DEAN_IS_CALLER);
    const result = await renderScreen();
    const { apiClient } = await import("../api/client");
    const saveSpy = vi.spyOn(apiClient, "saveMemberRestrictions");

    fireEvent.press(result.getByLabelText(/^MC,/));
    fireEvent.press(result.getByLabelText("wheat"));
    fireEvent.press(result.getByLabelText("Save allergies for MC"));
    await flushPending();

    // The rendered rows would look right even if the wrong id were sent to
    // the port, same reasoning as profile-screen.test.ts's fixture-path
    // pin: assert the actual call, then re-read the port itself.
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy.mock.calls[0]?.[0]).toBe("mem-maya");

    const state = await apiClient.getOnboardingState();
    const dean = state.household?.members.find((m) => m.memberId === "mem-dean");
    const maya = state.household?.members.find((m) => m.memberId === "mem-maya");
    expect(dean?.restrictions).toEqual([]);
    expect(dean?.noneConfirmed).toBe(false);
    expect(maya?.restrictions.map((r) => r.label)).toEqual(["wheat"]);
    expect(maya?.noneConfirmed).toBe(false);
  });

  it("the owner sees Invite; the confirm sheet, Get new code, shows the new code once", async () => {
    globalThis.fetch = fetchRouter(DEAN_IS_CALLER, (url, init) => {
      if (url.endsWith("/v1/households/me/join-code") && init?.method === "POST") {
        return new Response(
          JSON.stringify({ joinCode: { code: "WXYZ-999", issuedAt: "2026-09-30T00:00:00.000Z" } }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({}), { status: 500 });
    });
    const result = await renderScreen();

    fireEvent.press(result.getByLabelText("Invite"));
    expect(
      result.getByText(
        "Get a new join code? The current code stops working. Share the new one with the person you're inviting.",
      ),
    ).toBeTruthy();

    fireEvent.press(result.getByLabelText("Get new code"));
    await flushPending();

    expect(result.getByText("Your join code: WXYZ-999. Save it to invite others.")).toBeTruthy();
    // The confirm sheet itself is gone once the code is shown.
    expect(result.queryByLabelText("Get new code")).toBeNull();
  });

  it("review round 1, F6: tapping Invite again after a rotation reopens the confirm sheet, not a dead tap", async () => {
    globalThis.fetch = fetchRouter(DEAN_IS_CALLER, (url, init) => {
      if (url.endsWith("/v1/households/me/join-code") && init?.method === "POST") {
        return new Response(
          JSON.stringify({ joinCode: { code: "WXYZ-999", issuedAt: "2026-09-30T00:00:00.000Z" } }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({}), { status: 500 });
    });
    const result = await renderScreen();

    fireEvent.press(result.getByLabelText("Invite"));
    fireEvent.press(result.getByLabelText("Get new code"));
    await flushPending();
    expect(result.getByText("Your join code: WXYZ-999. Save it to invite others.")).toBeTruthy();

    fireEvent.press(result.getByLabelText("Invite"));

    expect(
      result.getByText(
        "Get a new join code? The current code stops working. Share the new one with the person you're inviting.",
      ),
    ).toBeTruthy();
    expect(result.queryByText("Your join code: WXYZ-999. Save it to invite others.")).toBeNull();
  });

  it("Cancel on the confirm sheet never calls rotate", async () => {
    let rotateCalled = false;
    globalThis.fetch = fetchRouter(DEAN_IS_CALLER, (url) => {
      if (url.endsWith("/v1/households/me/join-code")) {
        rotateCalled = true;
      }
      return new Response(JSON.stringify({}), { status: 500 });
    });
    const result = await renderScreen();

    fireEvent.press(result.getByLabelText("Invite"));
    fireEvent.press(result.getByLabelText("Cancel"));
    await flushPending();

    expect(rotateCalled).toBe(false);
    expect(result.queryByText(/Get a new join code/)).toBeNull();
  });

  it("a 403 NOT_OWNER on rotate (defence in depth) renders the exact §8 string, never the server message", async () => {
    globalThis.fetch = fetchRouter(DEAN_IS_CALLER, (url, init) => {
      if (url.endsWith("/v1/households/me/join-code") && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            error: {
              code: "NOT_OWNER",
              message: "this exact sentence must never reach the screen",
              correlationId: "c1",
            },
          }),
          { status: 403 },
        );
      }
      return new Response(JSON.stringify({}), { status: 500 });
    });
    const result = await renderScreen();

    fireEvent.press(result.getByLabelText("Invite"));
    fireEvent.press(result.getByLabelText("Get new code"));
    await flushPending();

    expect(result.getByText("Only the household owner can do that.")).toBeTruthy();
    expect(result.queryByText("this exact sentence must never reach the screen")).toBeNull();
  });

  it("a member (not owner) sees the ask-the-owner line and no Invite", async () => {
    globalThis.fetch = fetchRouter(MAYA_IS_CALLER);
    const result = await renderScreen();

    expect(result.getByText("Ask the household owner for the join code.")).toBeTruthy();
    expect(result.queryByLabelText("Invite")).toBeNull();
  });

  it("Sign out clears the cached caller identity and lands on S1", async () => {
    globalThis.fetch = fetchRouter(DEAN_IS_CALLER);
    const result = await renderScreen();
    const { apiClient, hasHouseholdCallerActions } = await import("../api/client");
    if (!hasHouseholdCallerActions(apiClient)) {
      throw new Error("expected the HTTP client's caller actions to be present");
    }
    expect(apiClient.getCallerSummary()).not.toBeNull();

    fireEvent.press(result.getByLabelText("Sign out"));
    await flushPending();

    expect(replaced).toEqual(["/onboarding/account"]);
    expect(apiClient.getCallerSummary()).toBeNull();
  });

  it("a rejected read shows the §8 read fallback with Try again, same as S1/S2", async () => {
    globalThis.fetch = () => Promise.reject(new Error("network down"));
    const result = await renderScreen();

    expect(result.getByText("Couldn't load your household.")).toBeTruthy();
    expect(
      result.getByText(
        "Something went wrong loading that. Try again, and tell us if it keeps happening.",
      ),
    ).toBeTruthy();
  });
});
