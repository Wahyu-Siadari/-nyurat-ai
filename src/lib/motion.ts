import type { Transition } from "motion/react";

type MotionTarget = {
  opacity?: number | number[];
  y?: number;
  scale?: number;
  scaleX?: number | number[];
};

type MotionPreset = {
  initial: MotionTarget;
  animate: MotionTarget;
  transition: Transition;
};

const ease = [0.22, 1, 0.36, 1] as const;
const immediate = { duration: 0 };

const presets = {
  stage: {
    initial: { opacity: 0, y: 6 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.3, ease },
  },
  success: {
    initial: { opacity: 0, y: -5 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.3, ease },
  },
  board: {
    initial: { opacity: 0.3, y: 8, scale: 0.99 },
    animate: { opacity: 1, y: 0, scale: 1 },
    transition: { duration: 0.45, ease },
  },
  dialog: {
    initial: { opacity: 0, y: 12, scale: 0.98 },
    animate: { opacity: 1, y: 0, scale: 1 },
    transition: { duration: 0.25, ease },
  },
  writing: {
    initial: { scaleX: 0 },
    animate: { scaleX: [0, 0, 1, 1] },
    transition: { duration: 2, times: [0, 0.1, 0.7, 1], repeat: Infinity, ease: "easeInOut" },
  },
  skeleton: {
    initial: { opacity: 1 },
    animate: { opacity: [1, 0.55, 1] },
    transition: { duration: 1.5, repeat: Infinity, ease: "easeInOut" },
  },
} satisfies Record<string, MotionPreset>;

type PresetName = keyof typeof presets;

export function motionPreset(name: PresetName, reducedMotion: boolean | null) {
  if (reducedMotion === false) return presets[name];
  const animate = name === "writing" ? { scaleX: 1 } : name === "skeleton" ? { opacity: 1 } : presets[name].animate;
  return { initial: false as const, animate, transition: immediate };
}

export function visibilityMotion(name: "dialog" | "stage", visible: boolean, reducedMotion: boolean | null) {
  const preset = motionPreset(name, reducedMotion);
  return {
    initial: presets[name].animate,
    animate: !visible && reducedMotion === false ? presets[name].initial : preset.animate,
    transition: visible ? preset.transition : immediate,
  };
}
