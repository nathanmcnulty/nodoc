import type { ReactElement } from "react";

import styles from "./QualityMaturityBadge.module.css";

type QualityMaturity = {
  label: string;
  tone: string;
  description: string;
};

type QualityMaturityBadgeProps = {
  maturity?: QualityMaturity | null;
};

function getToneClassName(tone: string): string {
  switch (tone) {
    case "success":
      return styles.success;
    case "warning":
      return styles.warning;
    default:
      return styles.neutral;
  }
}

export default function QualityMaturityBadge({
  maturity,
}: QualityMaturityBadgeProps): ReactElement | null {
  if (!maturity) {
    return null;
  }

  return (
    <span
      className={`${styles.badge} ${getToneClassName(maturity.tone)}`}
      title={maturity.description}
    >
      {maturity.label}
    </span>
  );
}
