import { describe, expect, it } from "vitest";
import { sessionOverlayView } from "./session-overlay";
import type { SessionPanelState } from "./session-panel";

const base: SessionPanelState = {
  phase: "idle",
  role: null,
  participants: 0,
  hostConnected: false,
  inviteLink: null,
  message: "",
};

describe("session overlay", () => {
  it("stays hidden while editing is open", () => {
    expect(sessionOverlayView(base)).toBeNull();
    expect(
      sessionOverlayView({
        ...base,
        phase: "connected",
        role: "guest",
        hostConnected: true,
      }),
    ).toBeNull();
    expect(
      sessionOverlayView({ ...base, phase: "connected", role: "host" }),
    ).toBeNull();
    expect(
      sessionOverlayView({ ...base, phase: "error", message: "No room" }),
    ).toBeNull();
  });

  it("covers joining, reconnecting and a missing host", () => {
    expect(
      sessionOverlayView({ ...base, phase: "connecting", role: "guest" }),
    ).toMatchObject({ title: "Joining session", busy: true, retry: false });
    expect(
      sessionOverlayView({ ...base, phase: "reconnecting", role: "host" }),
    ).toMatchObject({ title: "Reconnecting to session", busy: true });
    expect(
      sessionOverlayView({ ...base, phase: "connected", role: "guest" }),
    ).toMatchObject({ title: "Waiting for the host", leave: "Leave session" });
  });

  it("offers a way out when the room fails or ends", () => {
    expect(
      sessionOverlayView({
        ...base,
        phase: "error",
        role: "guest",
        message: "Could not join this session.",
      }),
    ).toMatchObject({
      message: "Could not join this session.",
      busy: false,
      retry: true,
    });
    expect(
      sessionOverlayView({ ...base, phase: "ended", role: "guest" }),
    ).toMatchObject({
      title: "Session ended",
      retry: false,
      leave: "Continue solo",
    });
  });
});
