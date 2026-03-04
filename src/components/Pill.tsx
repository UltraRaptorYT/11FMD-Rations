import * as React from "react";

type PillSize = "sm" | "md";

export type PillProps = {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  color?: string;
  disabled?: boolean;
  size?: PillSize;
  className?: string;
};

export default function Pill({
  active,
  onClick,
  children,
  color,
  disabled = false,
  size = "md",
  className,
}: PillProps) {
  const sizeClasses =
    size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-1.5 text-sm";

  const resolvedColor = color ?? "#c8a97e";

  const handleClick: React.MouseEventHandler<HTMLButtonElement> = (e) => {
    if (disabled) {
      e.preventDefault();
      return;
    }
    onClick();
  };

  const style: React.CSSProperties = active
    ? {
        backgroundColor: resolvedColor,
        borderColor: resolvedColor,
        boxShadow: `0 2px 12px ${resolvedColor}44`,
      }
    : {
        borderColor: "#3a3a3a",
        color: "#999",
      };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      className={`${sizeClasses} rounded-full font-medium transition-all duration-200 border ${
        active
          ? "text-white shadow-md scale-[1.02]"
          : "bg-transparent opacity-60 hover:opacity-90"
      } ${disabled ? "opacity-30 cursor-not-allowed" : "cursor-pointer"} ${
        className ?? ""
      }`}
      style={style}
    >
      {children}
    </button>
  );
}
