"use client";

import React from "react";
import PropTypes from "prop-types";

function getSliderLevelInfo(key, val) {
  if (key === "ecc_auto_skill_routerConfidence") {
    if (val <= 0.25) return { label: "Aggressive / Broad Matching", color: "text-amber-500" };
    if (val <= 0.5) return { label: "Balanced (Default)", color: "text-primary" };
    return { label: "Strict / Exact Match", color: "text-text-muted" };
  }
  if (key === "ecc_auto_skill_routerMaxSkills") {
    if (val === 1) return { label: "Single Best Match", color: "text-primary" };
    return { label: `Top ${val} Skills`, color: "text-amber-500" };
  }
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

export default function ConfigSlider({ label, configKey, value, min = 1, max = 10, step = 1, onChange }) {
  const currentVal = value !== undefined ? Number(value) : min;
  const isDecimal = step < 1 || !Number.isInteger(min) || !Number.isInteger(max);
  const percentage = Math.max(0, Math.min(100, ((currentVal - min) / (max - min)) * 100));
  const levelInfo = getSliderLevelInfo(configKey, currentVal);

  const formatVal = (v) => {
    if (isDecimal) {
      const decimals = (step.toString().split(".")[1] || "").length || 2;
      return Number(v).toFixed(decimals);
    }
    return Number(v).toString();
  };

  const rawPresets = [
    { label: "Min", val: min },
    { label: "Low", val: min + (max - min) * 0.25 },
    { label: "Default", val: min + (max - min) * 0.5 },
    { label: "High", val: min + (max - min) * 0.75 },
    { label: "Max", val: max },
  ];

  const presets = rawPresets.map((p) => {
    let snappedVal = p.val;
    if (isDecimal) {
      snappedVal = Math.round(snappedVal / step) * step;
      snappedVal = Number(snappedVal.toFixed(4));
    } else {
      snappedVal = Math.round(snappedVal);
    }
    return {
      label: p.label,
      val: snappedVal,
      display: formatVal(snappedVal),
    };
  });

  const handleInputChange = (e) => {
    const raw = e.target.value;
    const num = isDecimal ? parseFloat(raw) : parseInt(raw, 10);
    if (!isNaN(num)) {
      onChange(num);
    }
  };

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
          <span>{formatVal(currentVal)}</span>
          <span className="opacity-60 font-normal">/ {formatVal(max)}</span>
        </div>
      </div>

      {/* Modern Slider Input */}
      <div className="relative py-1">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={currentVal}
          onChange={handleInputChange}
          style={{
            background: `linear-gradient(to right, var(--color-primary, #E56A4A) 0%, var(--color-primary, #E56A4A) ${percentage}%, var(--color-surface-3, #383838) ${percentage}%, var(--color-surface-3, #383838) 100%)`,
          }}
          className="modern-range-slider"
        />
      </div>

      {/* Preset Quick Actions */}
      <div className="flex items-center justify-between gap-1 pt-0.5">
        {presets.map((preset) => {
          const isSelected = Math.abs(currentVal - preset.val) < (step / 2 || 0.001);
          return (
            <button
              key={`${preset.label}-${preset.val}`}
              type="button"
              onClick={() => onChange(preset.val)}
              className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all cursor-pointer ${
                isSelected
                  ? "bg-primary text-white font-bold shadow-xs"
                  : "bg-surface text-text-muted hover:text-text-main hover:bg-surface-3"
              }`}
            >
              {preset.label} ({preset.display})
            </button>
          );
        })}
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
  step: PropTypes.number,
  onChange: PropTypes.func.isRequired,
};
