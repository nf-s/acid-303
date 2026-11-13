import { z } from "zod";

/** Grain is the original techno studio; Fluff voices the same project for melodic dance music. */
export const projectModeSchema = z.enum(["grain", "fluff"]);
export type ProjectMode = z.infer<typeof projectModeSchema>;

export const PROJECT_MODES: ReadonlyArray<{ id: ProjectMode; label: string }> =
  [
    { id: "grain", label: "Grain" },
    { id: "fluff", label: "Fluff" },
  ];

export interface ModeSounds {
  kick: readonly string[];
  snare: readonly string[];
  hat: readonly string[];
  clap: readonly string[];
  rim: readonly string[];
  bass: readonly string[];
  keys: readonly string[];
  arp: readonly string[];
  pad: readonly string[];
}

/** Fluff reuses every sound slot, so saved sound numbers stay valid in both modes. */
export const FLUFF_SOUNDS: ModeSounds = {
  kick: ["Click", "Round", "Deep", "Tight", "Acoustic", "Boom", "Lo-fi"],
  snare: ["House", "Rimshot", "Garage", "Dusty", "Roll", "Ghost", "Room"],
  hat: [
    "Closed",
    "Open",
    "Shaker",
    "Tick",
    "Ride",
    "Offbeat",
    "Dusty",
    "Sizzle",
  ],
  clap: ["House", "Tight", "Hall", "Snap", "Dusty", "Layered", "Soft"],
  rim: ["Rim", "Tom", "Conga", "Tamb", "Blip", "Crash", "Sweep"],
  bass: [
    "Sub",
    "Offbeat",
    "Rolling",
    "Pluck",
    "Long",
    "Reese",
    "Organ",
    "FM",
    "Growl",
    "Warm",
    "Garage",
  ],
  keys: [
    "Supersaw",
    "Pluck",
    "Bell",
    "Piano",
    "Organ",
    "Square",
    "Soft",
    "Voice",
  ],
  arp: ["Pluck", "Super", "Glass", "Keys", "Pulse", "Dream", "Poly", "Mallet"],
  pad: ["Super", "Air", "Choir", "Glass", "Tape", "Warm", "Phase", "Organ"],
};

export interface ModeLabels {
  title: string;
  description: string;
  themeColor: string;
  bass: string;
  keys: string;
  rim: string;
  drive: string;
  driveName: string;
  echo: string;
  echoName: string;
  spaceLeft: string;
  spaceRight: string;
  echoLeft: string;
  echoRight: string;
}

export const MODE_LABELS: Record<ProjectMode, ModeLabels> = {
  grain: {
    title: "Grain — Techno sequencer",
    description:
      "A drum, acid bass and percussion texture sequencer with pattern-driven visuals.",
    themeColor: "#202020",
    bass: "Acid bass",
    keys: "Texture",
    rim: "Rimshot",
    drive: "Crunch",
    driveName: "Crunch distortion",
    echo: "Dub echo",
    echoName: "Dub echo",
    spaceLeft: "Room",
    spaceRight: "Wash",
    echoLeft: "Short",
    echoRight: "Dub",
  },
  fluff: {
    title: "Fluff — Melodic dance sequencer",
    description:
      "A trance, progressive house and melodic breaks sequencer with pattern-driven visuals.",
    themeColor: "#eef1f5",
    bass: "Bass",
    keys: "Lead",
    rim: "Perc",
    drive: "Pump",
    driveName: "Sidechain pump",
    echo: "Ping-pong",
    echoName: "Ping-pong echo",
    spaceLeft: "Plate",
    spaceRight: "Hall",
    echoLeft: "1/8",
    echoRight: "Dotted",
  },
};
