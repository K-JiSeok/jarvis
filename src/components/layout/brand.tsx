import Link from "next/link";

export function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2">
      <span className="bg-primary text-primary-foreground flex size-7 items-center justify-center rounded-md text-xs font-bold">
        J
      </span>
      <span className="text-sm font-semibold tracking-tight">JARVIS</span>
    </Link>
  );
}
