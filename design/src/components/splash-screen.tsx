import { LogoMark } from "@/components/brand/logo-mark";

function LoadingArc() {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      className="zoop-spinner w-[7.7cqw] shrink-0"
      aria-hidden="true"
    >
      <circle
        cx="16"
        cy="16"
        r="13.2"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray="76 24"
        pathLength="100"
      />
    </svg>
  );
}

export function SplashScreen() {
  return (
    <main className="min-h-dvh w-full bg-zoop">
      <section
        aria-label="NearZoop splash screen"
        className="relative mx-auto flex h-dvh w-full max-w-[430px] flex-col overflow-hidden bg-zoop [container-type:size]"
      >
        <div className="flex min-h-0 flex-1 flex-col px-[6.5cqw] pb-[6.4cqw] pt-[30cqh]">
          <div className="flex flex-col items-start">
            <LogoMark className="ml-[1.5cqw] w-[27.2cqw] shrink-0" />

            <h1 className="mt-[2.9cqw] text-[15.8cqw] font-black leading-[0.93] tracking-[-0.048em] text-white">
              Near
              <br />
              Zoop
            </h1>

            <p className="mt-[4.7cqw] text-[4.45cqw] font-bold leading-[1.2] tracking-[-0.015em] text-white">
              Offers in your para, right now.
            </p>
          </div>

          <div
            role="status"
            className="mt-auto flex items-center gap-[3.2cqw] text-white"
          >
            <LoadingArc />
            <p className="font-mono text-[2.45cqw] font-medium uppercase leading-none tracking-[0.15em]">
              Restoring Gariahat · 2 km
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
