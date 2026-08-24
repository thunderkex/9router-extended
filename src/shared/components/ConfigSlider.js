"use client";

import React from "react";
import PropTypes from "prop-types";

function getSliderLevelInfo(key, val) {
  if (key === "design_variance") {
    if (val <= 3) return { label: "Conservative / Minimal", color: "text-text-muted" };
    if (val <= 7) return { label: "Balanced & Anti-Slop (Default)", color: "text-primary" };
    return { label: "Bespoke & High Expression", color: "text-amber-500" };
  }
  if (key === "motion_intensity") {
    if (val <= 3) return { label: "Reduced Motion / Subtle", color: "text-text-muted" };
    if (val <= 7) return { label: "Smooth Transitions (Default)", color: "text-primary" };
    return { label: "Dynamic & Fluid Animations", color: "text-amber-500" };
  }
  if (val <= 3) return { label: "Low", color: "text-text-muted" };
  if (val <= 7) return { label: "Medium", color: "text-primary" };
  return { label: "High", color: "text-amber-500" };
}

export default function ConfigSlider({ label, configKey, value, min = 1, max = 10, onChange }) {
  const currentVal = value ?? 5;
  const percentage = Math.max(0, Math.min(100, ((currentVal - min) / (max - min)) * 100));
  const levelInfo = getSliderLevelInfo(configKey, currentVal);

  const presets = [
    { label: "Min", val: min },
    { label: "Low", val: Math.round(min + (max - min) * 0.25) },
    { label: "Default", val: Math.round(min + (max - min) * 0.5) },
    { label: "High", val: Math.round(min + (max - min) * 0.75) },
    { label: "Max", val: max },
  ];

  return (
    <div className="flex flex-col gap-2.5 p-3.5 rounded-xl bg-surface-2/70 border border-border/80 w-full">
      {/* Top Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm text-text-main">{label}</span>
          <span className={`text-[11px] font-medium ${levelInfo.color}`}>
            • {levelInfo.label}
          </span>
        </div>

        <div className="flex items-center gap-1 font-mono text-xs px-2.5 py-1 rounded-lg bg-primary/15 border border-primary/25 text-primary font-bold shadow-xs">
          <span>{currentVal}</span>
          <span className="opacity-60 font-normal">/ {max}</span>
        </div>
      </div>

      {/* Modern Slider Input */}
      <div className="relative py-1">
        <input
          type="range"
          min={min}
          max={max}
          value={currentVal}
          onChange={(e) => onChange(parseInt(e.target.value))}
          style={{
            background: `linear-gradient(to right, var(--color-primary, #E56A4A) 0%, var(--color-primary, #E56A4A) ${percentage}%, var(--color-surface-3, #383838) ${percentage}%, var(--color-surface-3, #383838) 100%)`,
          }}
          className="modern-range-slider"
        />
      </div>

      {/* Preset Quick Actions */}
      <div className="flex items-center justify-between gap-1 pt-0.5">
        {presets.map((preset) => (
          <button
            key={preset.val}
            type="button"
            onClick={() => onChange(preset.val)}
            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all cursor-pointer ${
              currentVal === preset.val
                ? "bg-primary text-white font-bold shadow-xs"
                : "bg-surface text-text-muted hover:text-text-main hover:bg-surface-3"
            }`}
          >
            {preset.label} ({preset.val})
          </button>
        ))}
      </div>
    </div>
  );
}

ConfigSlider.propTypes = {
  label: PropTypes.string.isRequired,
  configKey: PropTypes.string,
  value: PropTypes.number,
  min: PropTypes.number,
  max: PropTypes.number,
  onChange: PropTypes.func.isRequired,
};
