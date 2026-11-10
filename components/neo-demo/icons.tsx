"use client";

import { ArrowRight, ArrowUp, ArrowDown, ChartBar, ChartLine, Cube, Crown, Database, Eye, Heart, Users, ShoppingCart, Wallet, Lightning, Robot, Lightbulb, ClipboardText, MagnifyingGlass, Globe, Target, CheckCircle, WarningCircle, Flag, Question, ArrowsClockwise, X, CaretRight } from "@phosphor-icons/react";

const icons = { arrow: ArrowRight, up: ArrowUp, down: ArrowDown, chart: ChartBar, trend: ChartLine, cube: Cube, crown: Crown, database: Database, eye: Eye, heart: Heart, people: Users, cart: ShoppingCart, wallet: Wallet, lightning: Lightning, robot: Robot, bulb: Lightbulb, evidence: ClipboardText, search: MagnifyingGlass, market: Globe, target: Target, check: CheckCircle, warning: WarningCircle, flag: Flag, question: Question, reset: ArrowsClockwise, close: X, next: CaretRight };
export type IconName = keyof typeof icons;
export function NeoIcon({ name, size = 22, className = "", weight = "fill" }: { name: IconName; size?: number; className?: string; weight?: "fill" | "regular" | "bold" }) {
  const Icon = icons[name];
  return <Icon size={size} weight={weight} className={className} aria-hidden="true"/>;
}
