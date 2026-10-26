import Image from "next/image";
import { cn } from "@/lib/utils";

const DASHBOARD_MARK = {
  height: 42,
  width: 37,
} as const;

type NotebookLogoMarkProps = {
  width: number;
  className?: string;
};

export function NotebookLogoMark({ width, className }: NotebookLogoMarkProps) {
  const height = width * (DASHBOARD_MARK.height / DASHBOARD_MARK.width);

  return (
    <Image
      src="/images/knowhere/logo-mark.svg"
      alt=""
      aria-hidden
      className={cn("dark:invert", className)}
      width={width}
      height={height}
      style={{ height: "auto" }}
    />
  );
}
