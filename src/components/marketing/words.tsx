/** A headline split into words so each can stand up in turn as it scrolls in (CSS `.kinetic-word`). Screen readers
 *  get the sentence once, not word by word. */
export function Words({ text }: { text: string }) {
  const words = text.split(" ");
  return (
    <>
      <span className="sr-only">{text}</span>
      <span aria-hidden>
        {words.map((w, i) => (
          <span key={i} className="kinetic-word" style={{ "--i": i } as React.CSSProperties}>
            {w}
            {i < words.length - 1 ? " " : ""}
          </span>
        ))}
      </span>
    </>
  );
}
