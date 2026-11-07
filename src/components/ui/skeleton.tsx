"use client";

import { motion, useReducedMotion } from "motion/react";
import { motionPreset } from "../../lib/motion";
import { cn } from "../../lib/utils";

export function Skeleton({ className }: { className?: string }) {
  const reducedMotion = useReducedMotion();
  return (
    <motion.div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn("rounded-md bg-[var(--selected)]", className)}
      {...motionPreset("skeleton", reducedMotion)}
    />
  );
}
