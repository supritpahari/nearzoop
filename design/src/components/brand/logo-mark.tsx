import type { SVGProps } from "react";

export const TILE_PATH =
  "M64 8C99 2 160 5 194 13C219 19 234 36 238 63C243 102 242 157 233 189C227 215 208 230 180 234C142 240 87 238 55 227C28 218 12 198 9 167C6 128 8 71 19 43C26 22 42 12 64 8Z";

export const Z_PATH =
  "M86 67L175 58L169 93L117 147L170 138L165 177L73 186L84 147L135 97L86 103Z";

type LogoMarkProps = SVGProps<SVGSVGElement> & {
  title?: string;
};

/**
 * The NearZoop mark: a hand-drawn black tile with a golden offset print
 * and an italic Z cut out of it.
 */
export function LogoMark({
  className,
  title = "NearZoop",
  ...props
}: LogoMarkProps) {
  return (
    <svg
      viewBox="0 0 260 270"
      fill="none"
      role="img"
      aria-label={title}
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      {...props}
    >
      <path d={TILE_PATH} fill="#FFC93B" transform="translate(11 20)" />
      <path d={TILE_PATH} fill="#1C1B19" />
      <path
        d={Z_PATH}
        fill="#FFC93B"
        stroke="#FFC93B"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
