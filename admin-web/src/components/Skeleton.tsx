/** Placeholder rows shown while a list loads — a shape to rest on, not a word. */
export function SkeletonRows({ n = 4 }: { n?: number }) {
  return (
    <div className="skel-rows" aria-hidden>
      {Array.from({ length: n }).map((_, i) => (
        <div className="skel-row" key={i}>
          <div className="skel-dot shimmer" />
          <div className="skel-lines">
            <div className="skel-line shimmer" />
            <div className="skel-line short shimmer" />
          </div>
        </div>
      ))}
    </div>
  );
}
