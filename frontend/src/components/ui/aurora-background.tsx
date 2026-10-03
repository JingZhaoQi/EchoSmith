// Aurora Background component from Bit UI
// https://reactbits.dev/ts-tailwind/Backgrounds/Aurora
import React, { ReactNode } from "react";

interface AuroraBackgroundProps {
  children?: ReactNode;
  className?: string;
}

export const AuroraBackground: React.FC<AuroraBackgroundProps> = ({
  children,
  className = "",
}) => {
  return (
    <div className={`relative overflow-hidden ${className}`}>
      <div className="absolute top-0 right-0 bottom-0 left-0 app-material-bg" />
      <div className="absolute top-0 right-0 bottom-0 left-0 opacity-[0.34] dark:opacity-[0.18]"
        style={{
          backgroundImage:
            "linear-gradient(90deg, rgba(255,255,255,0.36) 0, rgba(255,255,255,0) 1px), linear-gradient(0deg, rgba(255,255,255,0.26) 0, rgba(255,255,255,0) 1px)",
          backgroundSize: "48px 48px",
        }}
      />

      {/* Content */}
      <div className="relative z-10 h-full">{children}</div>
    </div>
  );
};
