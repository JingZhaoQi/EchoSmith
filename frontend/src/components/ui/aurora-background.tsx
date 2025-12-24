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
    <div className={`relative min-h-screen overflow-hidden ${className}`}>
      {/* macOS-style clean background */}
      <div className="absolute inset-0 bg-gradient-to-br from-gray-50 via-white to-gray-100/50 dark:from-zinc-900 dark:via-black dark:to-zinc-950" />

      {/* Subtle accent gradients - very minimal */}
      <div className="absolute inset-0 overflow-hidden">
        {/* Light mode: barely visible accent */}
        <div className="dark:hidden">
          <div
            className="absolute top-0 right-0 w-[800px] h-[800px] opacity-[0.03]"
            style={{
              background: `radial-gradient(circle, rgba(99, 102, 241, 0.4), transparent 70%)`,
              filter: "blur(100px)",
            }}
          />
        </div>

        {/* Dark mode: subtle purple glow */}
        <div className="hidden dark:block">
          <div
            className="absolute top-0 right-0 w-[800px] h-[800px] opacity-10"
            style={{
              background: `radial-gradient(circle, rgba(139, 92, 246, 0.3), transparent 70%)`,
              filter: "blur(100px)",
            }}
          />
        </div>
      </div>

      {/* Content */}
      <div className="relative z-10">{children}</div>

      <style>{`
        @keyframes aurora {
          0%, 100% {
            transform: translate(0, 0) rotate(0deg) scale(1);
          }
          33% {
            transform: translate(30px, -30px) rotate(120deg) scale(1.1);
          }
          66% {
            transform: translate(-20px, 20px) rotate(240deg) scale(0.9);
          }
        }

        @keyframes aurora-alt {
          0%, 100% {
            transform: translate(0, 0) rotate(0deg) scale(1);
          }
          33% {
            transform: translate(-30px, 30px) rotate(-120deg) scale(1.1);
          }
          66% {
            transform: translate(20px, -20px) rotate(-240deg) scale(0.9);
          }
        }
      `}</style>
    </div>
  );
};
