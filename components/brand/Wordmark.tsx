import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * The Sendzz wordmark, with its lettering in ink on a light page and in cream on a dark one.
 * Both files are tiny SVGs; the one for the other mode is simply not displayed.
 */
export function Wordmark({
  width,
  height,
  priority,
  className,
}: {
  width: number;
  height: number;
  priority?: boolean;
  className?: string;
}) {
  return (
    <>
      <Image src="/landing/logo.svg" alt="Sendzz" width={width} height={height} priority={priority} className={cn("dark:hidden", className)} />
      <Image
        src="/landing/logo-dark.svg"
        alt="Sendzz"
        width={width}
        height={height}
        priority={priority}
        className={cn("hidden dark:block", className)}
      />
    </>
  );
}
