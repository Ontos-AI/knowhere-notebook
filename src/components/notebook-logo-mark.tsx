import Image from "next/image";

// Base dimensions from the tablet-sized sidebar brand mark
const BASE = {
  containerWidth: 28,
  containerHeight: 25.46,
  markWidth: 14.97,
  markHeight: 19.78,
  secondaryLeft: 13.03,
  secondaryTop: 5.68,
} as const;

type NotebookLogoMarkProps = {
  width: number;
  className?: string;
};

export function NotebookLogoMark({ width, className }: NotebookLogoMarkProps) {
  const scale = width / BASE.containerWidth;
  const containerHeight = BASE.containerHeight * scale;
  const markWidth = BASE.markWidth * scale;
  const markHeight = BASE.markHeight * scale;
  const secondaryLeft = BASE.secondaryLeft * scale;
  const secondaryTop = BASE.secondaryTop * scale;

  return (
    <div
      className={className}
      style={{ position: "relative", width, height: containerHeight }}
    >
      <Image
        src="/images/logo-mark-primary.svg"
        alt=""
        aria-hidden
        width={markWidth}
        height={markHeight}
        className="absolute block"
        style={{ left: 0, top: 0 }}
      />
      <Image
        src="/images/logo-mark-secondary.svg"
        alt=""
        aria-hidden
        width={markWidth}
        height={markHeight}
        className="absolute block"
        style={{
          left: secondaryLeft,
          top: secondaryTop,
          transform: "rotate(180deg)",
        }}
      />
    </div>
  );
}
