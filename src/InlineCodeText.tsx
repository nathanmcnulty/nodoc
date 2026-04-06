import { Fragment, type ReactElement } from "react";

type InlineCodeTextProps = {
  text: string;
};

export default function InlineCodeText({ text }: InlineCodeTextProps): ReactElement {
  const parts = text.split(/(`[^`]+`)/g).filter(Boolean);

  return (
    <>
      {parts.map((part, index) =>
        part.startsWith("`") && part.endsWith("`") ? (
          <code key={index}>{part.slice(1, -1)}</code>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
}
